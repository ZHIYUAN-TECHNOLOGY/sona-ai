/**
 * The retrieval eval with the real embedder: the hashed stub against EmbeddingGemma on Workers AI (the same model
 * and prompts as the Worker's AI binding, over the REST API), in English, Malay and Chinese, plus a question's
 * embedding latency. Synthetic corpus in an in-memory database; no reranker, so the numbers are the embedder's.
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... bun src/eval-live.ts   (from packages/retrieval)
 * The token needs Workers AI access. Alchemy's Cloudflare login has it (`values.access` in
 * ~/.alchemy/profiles/default/cloudflare.json, fresh for an hour after any alchemy command).
 */
import { workersEmbedder, type WorkersAi } from "@sona-ai/api/workers-models";
import { createTestDb } from "@sona-ai/db/testing";

import { EVAL_SETS, evaluate } from "./eval";
import { stubEmbedder, type Embedder } from "./retrieval";

const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
if (!account || !token) {
  console.error("Usage: CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... bun src/eval-live.ts");
  process.exit(1);
}

/** Workers AI over its REST API, shaped like the Worker's binding. */
const rest: WorkersAi = {
  async run(model, input, options) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input), signal: options?.signal,
    });
    const body = await res.json() as { success?: boolean; result?: unknown };
    if (!body.success) throw new Error(`Workers AI answered ${res.status}`);
    return body.result;
  },
};
const gemma = workersEmbedder(rest);

// A failed embedding would quietly fall back to keywords and flatter nothing, so check the model answers first.
const times: number[] = [];
for (const question of EVAL_SETS.en.slice(0, 5)) {
  const t = performance.now();
  await gemma([question.question], "query");
  times.push(performance.now() - t);
}
console.log(`EmbeddingGemma query embedding from here: ${times.map(ms => Math.round(ms)).join(", ")} ms`);

for (const [name, embedder] of [["stub", stubEmbedder], ["EmbeddingGemma", gemma]] as [string, Embedder][]) {
  const cells: string[] = [];
  for (const [language, questions] of Object.entries(EVAL_SETS)) {
    const hit = async (k: number) => (await evaluate(await createTestDb(), embedder, undefined, k, questions)).hitAtK.toFixed(2);
    cells.push(`${language} hit@5 ${await hit(5)}, hit@1 ${await hit(1)}`);
  }
  console.log(`${name.padEnd(14)} ${cells.join(" · ")}`);
}

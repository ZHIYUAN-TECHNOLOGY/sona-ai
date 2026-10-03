import { provenance } from "@sona-ai/db/schema/clinical";
import { and, desc, eq, isNull, ne } from "drizzle-orm";

import type { Context } from "./context";
import type { Origin } from "./models";

/**
 * A model's answer is paid for once: asked again with the same visit (or none), kind and input, the answer stored in
 * provenance comes back, still naming the model that wrote it. Otherwise `ask` runs and its answer is logged with the
 * input's key (SHA-256 of its JSON), as every AI output is. A fixture is never reused, so a model that was off or
 * starting is asked again.
 */
export async function answerOnce<T extends Origin>(db: Context["db"], encounterId: string | null, kind: string, input: unknown, ask: () => Promise<T>, sourceIds: (answer: T) => string[]): Promise<T> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input)));
  const inputKey = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
  const [stored] = await db.select({ output: provenance.output, model: provenance.model }).from(provenance)
    .where(and(encounterId ? eq(provenance.encounterId, encounterId) : isNull(provenance.encounterId), eq(provenance.kind, kind), eq(provenance.inputKey, inputKey), ne(provenance.model, "fixture")))
    .orderBy(desc(provenance.createdAt)).limit(1);
  if (stored) return { ...(stored.output as object), source: "model", model: stored.model } as T;
  const answer = await ask();
  const { source: _, model: __, waking: ___, ...output } = answer as T & { model?: string; waking?: number };
  await db.insert(provenance).values({ id: crypto.randomUUID(), encounterId, kind, output, sourceIds: sourceIds(answer), model: answer.source === "model" ? answer.model : "fixture", approvedBy: null, inputKey });
  return answer;
}

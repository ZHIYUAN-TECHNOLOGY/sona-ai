/**
 * Live check of the SageMaker fetcher against a real endpoint (packages/infra/aws/brain/test.sh brings box ① up and
 * runs this before it takes the endpoint down). Synthetic questions only. Temporary credentials do:
 *   CREDS=$(aws configure export-credentials --profile sona --format process) bun src/sagemaker-live.ts   (from packages/api)
 */
import { BRAIN_MODEL, basetenModels, boxes } from "./baseten-models";
import { hosted } from "./sagemaker";
import { deltas } from "./sse";

const c = JSON.parse(process.env.CREDS!) as { AccessKeyId: string; SecretAccessKey: string; SessionToken?: string };
const baseten = { ...hosted({ BASETEN_API_KEY: "unused-here", SAGEMAKER_ENDPOINTS: "brain=sona-brain",
  AWS_ACCESS_KEY_ID: c.AccessKeyId, AWS_SECRET_ACCESS_KEY: c.SecretAccessKey, AWS_SESSION_TOKEN: c.SessionToken })!, timeoutMs: 60_000 };
const { chat, send } = boxes(baseten);

let t = Date.now();
console.log("chat:", await chat("brain", BRAIN_MODEL, null, "Can I take paracetamol on an empty stomach? Two short sentences.", 80), `(${((Date.now() - t) / 1000).toFixed(1)} s)`);

t = Date.now();
const body = JSON.stringify({ model: BRAIN_MODEL, stream: true, temperature: 0, max_tokens: 80,
  messages: [{ role: "user", content: "Bolehkah saya makan paracetamol semasa perut kosong? Dua ayat pendek." }] });
const res = await send("brain", "/v1/chat/completions", body, "application/json");
let first = 0, parts = 0, said = "";
for await (const piece of deltas(res.body!)) { first ||= Date.now() - t; parts++; said += piece; }
console.log(`stream: first words ${(first / 1000).toFixed(1)} s, ${parts} pieces, ${((Date.now() - t) / 1000).toFixed(1)} s in all:`, said);

t = Date.now();
const turn = await basetenModels(baseten).draftReply({ language: "ms", label: "worse", message: "Demam saya datang balik malam tadi.", patientName: "Amelia" } as never).catch(e => String(e));
console.log("a model method (draftReply):", JSON.stringify(turn).slice(0, 260), `(${((Date.now() - t) / 1000).toFixed(1)} s)`);

/**
 * Live check of the Baseten adapter against the real boxes (wakes them; each is billed until 5 idle minutes
 * pass). Synthetic data only: Amelia's demo record, the user's fictional recorded line and the app's normal film.
 *   BASETEN_API_KEY=... bun src/baseten-live.ts   (from packages/api; wake the boxes first, see packages/infra/baseten)
 */
import { DEMO_PATIENTS } from "@sona-ai/domain/demo-patients";
import { STUDIES } from "@sona-ai/domain/evidence";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

import { basetenModels, basetenReranker } from "./baseten-models";

const baseten = { apiKey: process.env.BASETEN_API_KEY!, timeoutMs: 60_000 };
const models = basetenModels(baseten);
const amelia = { ...DEMO_PATIENTS[0]!, time: "09:00" };

async function timed<T>(label: string, run: () => Promise<T>) {
  const t = Date.now();
  const out = await run();
  console.log(`${label} ${((Date.now() - t) / 1000).toFixed(1)}s`, JSON.stringify(out));
}

await timed("transcribe", () => models.transcribe({ audio: readFileSync(`${homedir()}/zyt/data/sona-asr/real_voice/01.wav`) }));
await timed("briefing", () => models.briefing({ patient: amelia }));
await timed("evidence", () => models.synthesiseEvidence({
  question: "Should I give corticosteroids to a young adult with non-severe community-acquired pneumonia?", thread: [],
  sources: STUDIES.slice(0, 3).map((s, i) => ({ n: i + 1, design: s.kind, year: s.year, title: s.title, text: s.finding })),
}));
await timed("check-in reply", () => models.classifyReply({ text: "Demam datang balik malam tadi, batuk makin teruk", language: "ms" }));
await timed("inbox", () => models.triageMessage({ text: "Boleh saya tukar appointment ke minggu depan?" }));
await timed("plan answer", () => models.answerFromPlan({ question: "Bila saya kena makan amoxicillin?", plan: "Medicines: amoxicillin 500 mg three times a day after food for 5 days. Follow-up: clinic in 7 days.", language: "ms" }));
await timed("x-ray", () => models.xrayRead({ image: readFileSync(new URL("../../../apps/native/features/imaging/assets/normal-pa-chest.jpg", import.meta.url).pathname), contentType: "image/jpeg" }));
await timed("rerank", () => basetenReranker(baseten)("steroid untuk pneumonia", ["Corticosteroids are not recommended routinely in adults with non-severe community-acquired pneumonia.", "Paracetamol 500 mg to 1 g every 4 to 6 hours."]));

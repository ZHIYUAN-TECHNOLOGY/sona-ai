import { expect, test } from "bun:test";

import { ASR_MODEL, BOXES, BRAIN_MODEL, XRAY_MODEL, basetenModels, basetenReranker } from "./baseten-models";
import { stubModels } from "./models";

type Call = { url: string; init: RequestInit };

/** A fake Baseten: answers per box and route, records every call. A thrown answer is a box that is down. */
function fake(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/wake")) return new Response(null, { status: 202 });
    const key = Object.keys(answers).find(k => url.includes(k));
    const answer = key === undefined ? undefined : answers[key];
    if (answer instanceof Error) throw answer;
    if (answer === undefined) return new Response("no", { status: 503 });
    return Response.json(answer);
  }) as typeof fetch;
  return { fetcher, calls, wakes: () => calls.filter(c => c.url.endsWith("/wake")).map(c => c.url) };
}
const chatReply = (content: string) => ({ choices: [{ message: { content } }] });
const box = (name: keyof typeof BOXES) => `model-${BOXES[name]}.api.baseten.co`;
const patient = { ...{} as Parameters<typeof stubModels.briefing>[0]["patient"], age: 34, sex: "F", complaint: "Cough and fever for 3 days.", history: [], family: "", social: "", allergies: "Penicillin — rash", medicines: [], vitals: [], sources: [], incomplete: false };

test("speech goes to the ASR box as a WAV upload with the served model name, and the words come back trimmed", async () => {
  const { fetcher, calls } = fake({ [`${box("voice")}/environments/production/sync/v1/audio/transcriptions`]: { text: " Doktor, saya batuk sampai 睡不着. " } });
  const heard = await basetenModels({ apiKey: "k", fetcher }).transcribe({ audio: new TextEncoder().encode("RIFF") });
  expect(heard).toEqual({ text: "Doktor, saya batuk sampai 睡不着.", source: "model", model: ASR_MODEL });
  const form = calls[0]!.init.body as FormData;
  expect(form.get("model")).toBe(ASR_MODEL);
  expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Api-Key k");
});

test("a box that is down or asleep is woken for next time, and the stub answers, labelled fixture", async () => {
  const { fetcher, wakes } = fake({ [box("voice")]: new Error("timed out") });
  expect(await basetenModels({ apiKey: "k", fetcher }).transcribe({ audio: new Uint8Array(4) })).toEqual({ text: "", source: "fixture" });
  expect(wakes()).toEqual([`https://${box("voice")}/environments/production/wake`]);
});

test("the evidence answer asks Gemma with numbered sources and keeps only well-formed claims", async () => {
  const { fetcher, calls } = fake({ [box("brain")]: chatReply('```json\n{"claims":[{"text":"A guideline recommends against routine steroids.","cites":[1]},{"text":"no cites"}],"followUps":["What about severe cases?"]}\n```') });
  const read = await basetenModels({ apiKey: "k", fetcher }).synthesiseEvidence({ question: "Steroids in pneumonia?", thread: [], sources: [{ n: 1, design: "Guideline", year: 2019, title: "ATS/IDSA CAP", text: "Do not routinely use corticosteroids." }] });
  expect(read).toEqual({ claims: [{ text: "A guideline recommends against routine steroids.", cites: [1] }], followUps: ["What about severe cases?"], source: "model", model: BRAIN_MODEL });
  const body = JSON.parse(calls[0]!.init.body as string);
  expect(body.model).toBe(BRAIN_MODEL);
  expect(body.messages[1].content).toContain("[1] (Guideline, 2019) ATS/IDSA CAP");
});

test("a brief always names a recorded allergy, even when Gemma leaves it out", async () => {
  const { fetcher } = fake({ [box("brain")]: chatReply('{"lines":["Three days of cough and fever."]}') });
  const brief = await basetenModels({ apiKey: "k", fetcher }).briefing({ patient });
  expect(brief).toEqual({ lines: ["Three days of cough and fever.", "Allergy recorded: Penicillin."], source: "model", model: BRAIN_MODEL });
});

test("check-in replies go to Gemma through the shared readers, with the rule's urgent words as a floor", async () => {
  const { fetcher } = fake({ [box("brain")]: chatReply('{"label":"worse","symptom":"chest discomfort"}') });
  const models = basetenModels({ apiKey: "k", fetcher });
  expect(await models.classifyReply({ text: "sakit dada sikit", language: "ms" })).toEqual({ label: "urgent", symptom: "chest discomfort", source: "model", model: BRAIN_MODEL });
});

test("an X-ray goes to MedGemma as an image; a plain-sentence reply is kept, and the read is never validated", async () => {
  const { fetcher, calls } = fake({ [box("xray")]: chatReply("The heart size is normal and the lungs are clear.") });
  const read = await basetenModels({ apiKey: "k", fetcher }).xrayRead({ image: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });
  expect(read).toEqual({ findings: ["The heart size is normal and the lungs are clear."], validated: false, source: "model", model: XRAY_MODEL });
  const body = JSON.parse(calls[0]!.init.body as string);
  expect(body.messages[0].content[0].image_url.url).toBe(`data:image/jpeg;base64,${btoa("\x01\x02\x03")}`);
});

test("the reranker scores passages in box ②, and keeps the hybrid order when the box is asleep", async () => {
  const up = fake({ [box("voice")]: { scores: [0.1, 0.9] } });
  expect(await basetenReranker({ apiKey: "k", fetcher: up.fetcher })("steroid", ["a", "b"])).toEqual([0.1, 0.9]);
  const down = fake({});
  expect(await basetenReranker({ apiKey: "k", fetcher: down.fetcher })("steroid", ["a", "b", "c"])).toEqual([-0, -1, -2]);
  expect(down.wakes()).toHaveLength(1);
});

test("methods without a hosted model yet stay on the stub", async () => {
  const { fetcher, calls } = fake({});
  expect((await basetenModels({ apiKey: "k", fetcher }).draftReply({ text: "Bila appointment?", label: "admin", patientFirstName: "Amelia", language: "en" })).source).toBe("fixture");
  expect(calls).toHaveLength(0);
});

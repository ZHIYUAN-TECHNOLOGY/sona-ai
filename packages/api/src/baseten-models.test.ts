import { CODES, EMPTY_CLAIM, appealByRules, noteFor } from "@sona-ai/domain/claim";
import { DEMO_PATIENTS } from "@sona-ai/domain/demo-patients";
import { draftByRules } from "@sona-ai/domain/messages";
import { WARD_FIXTURE, huddle } from "@sona-ai/domain/ward";
import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";

import { ASR_MODEL, BOXES, BRAIN_MODEL, COLD_START_MIN, VOICE_MODEL, XRAY_MODEL, basetenModels, basetenReranker, boxState } from "./baseten-models";
import { stubModels, type Models } from "./models";

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
    // A function answers for itself (a streamed reply, say).
    if (typeof answer === "function") return (answer as (url: string, init: RequestInit) => Response)(url, init);
    if (answer === undefined) return new Response("no", { status: 503 });
    if (answer instanceof Uint8Array) return new Response(answer, { headers: { "content-type": "audio/wav" } });
    return Response.json(answer);
  }) as typeof fetch;
  return { fetcher, calls, wakes: () => calls.filter(c => c.url.endsWith("/wake")).map(c => c.url) };
}
const chatReply = (content: string) => ({ choices: [{ message: { content } }] });
const box = (name: keyof typeof BOXES) => `model-${BOXES[name]}.api.baseten.co`;
// Each test starts knowing nothing about the boxes (the adapter keeps what it learns for the isolate), in real time.
beforeEach(() => boxState.clear());
afterEach(() => setSystemTime());
const patient = { ...{} as Parameters<typeof stubModels.briefing>[0]["patient"], age: 34, sex: "F", complaint: "Cough and fever for 3 days.", history: [], family: "", social: "", allergies: "Penicillin — rash", medicines: [], vitals: [], sources: [], incomplete: false };

test("speech goes to the ASR box as a WAV upload with the served model name, and the words come back trimmed", async () => {
  const { fetcher, calls } = fake({ [box("voice")]: { text: " Doktor, saya batuk sampai 睡不着. " } });
  const heard = await basetenModels({ apiKey: "k", fetcher }).transcribe({ audio: new TextEncoder().encode("RIFF") });
  expect(heard).toEqual({ text: "Doktor, saya batuk sampai 睡不着.", source: "model", model: ASR_MODEL });
  const upload = calls.at(-1)!;
  expect(upload.url).toBe(`https://${box("voice")}/environments/production/sync/v1/audio/transcriptions`);
  expect((upload.init.body as FormData).get("model")).toBe(ASR_MODEL);
  expect((upload.init.headers as Record<string, string>).Authorization).toBe("Api-Key k");
});

test("Sona's voice: the text goes to box ② as JSON and the WAV comes back as base64; asleep, the phone reads it", async () => {
  const wav = new Uint8Array(64).fill(7);
  const { fetcher, calls } = fake({ [box("voice")]: wav });
  const said = await basetenModels({ apiKey: "k", fetcher }).speak({ text: "Ambil ubat ini selepas makan." });
  expect(said).toEqual({ audio: btoa(String.fromCharCode(...wav)), source: "model", model: VOICE_MODEL });
  const asked = calls.at(-1)!;
  expect(asked.url).toBe(`https://${box("voice")}/environments/production/sync/v1/tts`);
  expect(JSON.parse(asked.init.body as string)).toEqual({ text: "Ambil ubat ini selepas makan." });
  boxState.clear();
  const asleep = await basetenModels({ apiKey: "k", fetcher: fake({}).fetcher }).speak({ text: "Ambil ubat ini." });
  expect(asleep).toEqual({ source: "fixture", waking: COLD_START_MIN.voice });
});

test("a cold box is not waited for: a 2.5 s health check, a wake, and the stub at once with the minutes until the model is ready", async () => {
  // A cold box holds every request open until it is up; here, until the caller gives up.
  const urls: string[] = [];
  const fetcher = ((url: string, init: RequestInit) => {
    urls.push(url);
    if (url.endsWith("/wake")) return Promise.resolve(new Response(null, { status: 202 }));
    return new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
  }) as typeof fetch;
  const asked = Date.now();
  const brief = await basetenModels({ apiKey: "k", fetcher }).briefing({ patient });
  expect(Date.now() - asked).toBeLessThan(4000);
  expect(brief).toEqual({ ...await stubModels.briefing({ patient }), waking: COLD_START_MIN.brain });
  // The chat endpoint is never called.
  expect(urls).toEqual([`https://${box("brain")}/environments/production/sync/health`, `https://${box("brain")}/environments/production/wake`]);
});

test("while a box is starting, its health is checked at most once a minute: the calls in between get the stub at once", async () => {
  const t0 = Date.parse("2026-10-01T09:00:00+08:00");
  const urls: string[] = [];
  const fetcher = ((url: string, init: RequestInit) => {
    urls.push(url.split("/").at(-1)!);
    if (url.endsWith("/wake")) return Promise.resolve(new Response(null, { status: 202 }));
    return new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
  }) as typeof fetch;
  const models = basetenModels({ apiKey: "k", fetcher });
  setSystemTime(new Date(t0));
  await models.briefing({ patient }); // cold: one health check, then the wake
  setSystemTime(new Date(t0 + 30_000));
  const asked = performance.now();
  expect(await models.briefing({ patient })).toMatchObject({ source: "fixture", waking: COLD_START_MIN.brain });
  expect(performance.now() - asked).toBeLessThan(500); // no second 2.5 s health check inside the minute
  setSystemTime(new Date(t0 + 61_000));
  await models.briefing({ patient }); // a minute on: checked again
  expect(urls.filter(u => u === "health")).toHaveLength(2);
}, 10_000); // two real 2.5 s health checks (the abort timers run on real time)

test("a box whose health check says 200 is called as before, then trusted for 4 minutes without one", async () => {
  const t0 = Date.parse("2026-10-01T09:00:00+08:00");
  const { fetcher, calls } = fake({ [box("brain")]: chatReply('{"lines":["Three days of cough and fever."]}') });
  const models = basetenModels({ apiKey: "k", fetcher });
  for (const minute of [0, 3.9, 8]) { // the answer at 3.9 is 4.1 minutes old at 8
    setSystemTime(new Date(t0 + minute * 60_000));
    expect(await models.briefing({ patient })).toMatchObject({ source: "model", model: BRAIN_MODEL });
  }
  expect(calls.map(c => `${c.init.method ?? "GET"} ${c.url.split("/").at(-1)}`)).toEqual(["GET health", "POST completions", "POST completions", "GET health", "POST completions"]);
  expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Api-Key k");
});

test("the minutes count down from the box's measured cold start and never go below 1; an answer clears them, and a lapsed wake starts over", async () => {
  const t0 = Date.parse("2026-10-01T09:00:00+08:00");
  const cold = basetenModels({ apiKey: "k", fetcher: fake({ [box("voice")]: new Error("starting") }).fetcher });
  const minutesAt = async (minute: number) => {
    setSystemTime(new Date(t0 + minute * 60_000));
    const heard = await cold.transcribe({ audio: new Uint8Array(4) });
    expect(heard).toMatchObject({ text: "", source: "fixture" });
    return (heard as { waking?: number }).waking;
  };
  expect(await minutesAt(0)).toBe(30);
  expect(await minutesAt(10)).toBe(20);
  expect(await minutesAt(29.5)).toBe(1);
  expect(await minutesAt(34)).toBe(1); // late, still "about 1 min"
  expect(await minutesAt(36)).toBe(30); // past the cold start and the 5 idle minutes: it woke and slept again unseen
  setSystemTime(new Date(t0 + 40 * 60_000));
  const up = basetenModels({ apiKey: "k", fetcher: fake({ [box("voice")]: { text: "Doktor" } }).fetcher });
  expect(await up.transcribe({ audio: new Uint8Array(4) })).toEqual({ text: "Doktor", source: "model", model: ASR_MODEL });
  // It answered, so going cold again (past its 4 trusted minutes) counts from then, not from minute 36.
  expect(await minutesAt(50)).toBe(30);
});

test("the evidence answer asks Gemma with numbered sources and keeps only well-formed claims", async () => {
  const { fetcher, calls } = fake({ [box("brain")]: chatReply('```json\n{"claims":[{"text":"A guideline recommends against routine steroids.","cites":[1]},{"text":"no cites"}],"followUps":["What about severe cases?"]}\n```') });
  const read = await basetenModels({ apiKey: "k", fetcher }).synthesiseEvidence({ question: "Steroids in pneumonia?", thread: [], sources: [{ n: 1, design: "Guideline", year: 2019, title: "ATS/IDSA CAP", text: "Do not routinely use corticosteroids." }] });
  expect(read).toEqual({ claims: [{ text: "A guideline recommends against routine steroids.", cites: [1] }], followUps: ["What about severe cases?"], source: "model", model: BRAIN_MODEL });
  const body = JSON.parse(calls.at(-1)!.init.body as string);
  expect(body.model).toBe(BRAIN_MODEL);
  expect(body.messages[1].content).toContain("[1] (Guideline, 2019) ATS/IDSA CAP");
  // Room for a whole answer: four claims with their copied sentences.
  expect(body.max_tokens).toBe(2000);
});

test("asked with a patient's record, the record is a numbered source the model answers questions about them from, and it asks for a separate part about this patient; without one, neither", async () => {
  const reply = '{"claims":[{"text":"A guideline recommends against routine steroids.","cites":[1]}],"forPatient":[{"text":"Her recorded asthma is a reason she may already be on steroids [1].","cites":[],"fact":"Asthma since childhood"},{"text":"no fact","cites":[1]}],"followUps":[]}';
  const { fetcher, calls } = fake({ [box("brain")]: chatReply(reply) });
  const input = { question: "Steroids in pneumonia?", thread: [], sources: [{ n: 1, design: "Guideline", year: 2019, title: "ATS/IDSA CAP", text: "Do not routinely use corticosteroids." }] };
  // The route sends the record as a numbered source, and again as `patient` for the points it checks against it.
  const record = "Age 42, female.\nHistory: Asthma since childhood";
  const read = await basetenModels({ apiKey: "k", fetcher }).synthesiseEvidence({ ...input, sources: [...input.sources, { n: 2, design: "Patient record", title: "Patient record", text: record }], patient: record });
  // A point's citation is read as a claim's is (here from its own sentence); one with no fact is no point.
  expect(read).toMatchObject({ claims: [{ cites: [1] }], patientPoints: [{ text: "Her recorded asthma is a reason she may already be on steroids.", cites: [1], fact: "Asthma since childhood" }] });
  const [system, user] = JSON.parse(calls.at(-1)!.init.body as string).messages;
  expect(system.content).toContain('"forPatient"');
  expect(system.content).toContain('A question about the patient (brief me');
  // Once, as its numbered source: never repeated after the sources.
  expect(user.content).toEndWith("[2] (Patient record) Patient record\nAge 42, female.\nHistory: Asthma since childhood");
  expect(user.content.split("Asthma since childhood").length).toBe(2);
  await basetenModels({ apiKey: "k", fetcher }).synthesiseEvidence(input);
  const [bare, asked] = JSON.parse(calls.at(-1)!.init.body as string).messages;
  expect(bare.content).not.toContain("forPatient");
  expect(bare.content).toContain("Never state a fact about a patient that no source holds.");
  expect(asked.content).not.toContain("Patient record");
});

// Two PubMed studies as the route sends them (journal and PMID with each), then a library passage.
const evidenceSources = [
  { n: 1, design: "Guideline", year: 2019, title: "ATS/IDSA CAP", text: "Do not routinely use corticosteroids.", from: "Am J Respir Crit Care Med", pmid: "31573350" },
  { n: 2, design: "Trial", year: 2015, title: "Prednisone in CAP", text: "Prednisone 50 mg daily shortened time to stability.", from: "Lancet", pmid: "25608756" },
  { n: 3, design: "Library", year: 2024, title: "Ward protocol", text: "Check glucose daily on steroids." },
];
const evidenceInput = { question: "Steroids in pneumonia?", thread: [], sources: evidenceSources };

test("a citation is read however Gemma writes it, but a claim is only ever kept with sources that were in the prompt", async () => {
  const claims = [
    { text: "A guideline advises against routine steroids [1].", cites: "[1]" },
    { text: "A trial found earlier stability.", cites: ["[1][2]"] },
    { text: "High blood sugar was more common (2).", cites: [] },
    { text: "The trial gave prednisone 50 mg daily [PMID: 25608756]", quotes: [{ n: "25608756", text: "Prednisone 50 mg daily shortened time to stability." }, { n: 9, text: "From nowhere." }] },
    { text: "The effect was clear [95% CI 1.2 to 3.4].", cites: "1, 2" },
    { text: "The protocol checks glucose.", cites: [["Source 3 (2024)"]] },
    { text: "Cites only what was never retrieved.", cites: [7, "PMID 99999999"] },
    { text: "Cites nothing at all." },
  ];
  const { fetcher, calls } = fake({ [box("brain")]: chatReply(JSON.stringify({ bottomLine: "Not routinely.", claims })) });
  const read = await basetenModels({ apiKey: "k", fetcher }).synthesiseEvidence(evidenceInput);
  expect(read.source).toBe("model");
  expect(read.claims.map(c => [c.text, c.cites])).toEqual([
    ["A guideline advises against routine steroids.", [1]],
    ["A trial found earlier stability.", [1, 2]],
    ["High blood sugar was more common.", [2]],
    ["The trial gave prednisone 50 mg daily", [2]],
    ["The effect was clear [95% CI 1.2 to 3.4].", [1, 2]],
    ["The protocol checks glucose.", [3]],
  ]);
  // A quote's source is read the same way, and one from a source not in the prompt is not passed on.
  expect(read.claims[3]!.quotes).toEqual([{ n: 2, text: "Prednisone 50 mg daily shortened time to stability." }]);
  // Each study goes to Gemma with its design, year, journal and PMID.
  expect(JSON.parse(calls.at(-1)!.init.body as string).messages[1].content).toContain("[2] (Trial, 2015, Lancet, PMID 25608756) Prednisone in CAP\nPrednisone 50 mg daily");
});

test("sources go in whole, best first, while the prompt has room: the first that does not fit ends on a sentence, later ones are left out and cannot be cited", async () => {
  const long = Array.from({ length: 2500 }, (_, i) => `Sentence ${i} of a very long guideline section.`).join(" ");
  const sources = [evidenceSources[0]!, { ...evidenceSources[1]!, text: long }, evidenceSources[2]!];
  const reply = { claims: [{ text: "A guideline advises against routine steroids.", cites: [1] }, { text: "The protocol checks glucose.", cites: [3] }] };
  const { fetcher, calls } = fake({ [box("brain")]: chatReply(JSON.stringify(reply)) });
  const read = await basetenModels({ apiKey: "k", fetcher }).synthesiseEvidence({ ...evidenceInput, sources });
  const body = JSON.parse(calls.at(-1)!.init.body as string);
  const prompt: string = body.messages[1].content;
  // 16,384 tokens of context, less the answer's 2,000 and the template's 384, at 3 characters a token.
  expect(body.messages[0].content.length + prompt.length).toBeLessThanOrEqual(42_000);
  expect(prompt.length).toBeGreaterThan(30_000);
  expect(prompt).toContain("Do not routinely use corticosteroids.");
  expect(prompt).toMatch(/Sentence \d+ of a very long guideline section\.$/);
  expect(prompt).not.toContain("Ward protocol");
  expect(read.claims.map(c => c.cites)).toEqual([[1]]);
});

test("an evidence answer cut off at the length limit is never read as complete: its finished claims are kept and it says so; with none finished, the model did not answer", async () => {
  const cut = '{"bottomLine":"Not routinely.","claims":[{"text":"A guideline advises against routine steroids.","cites":[1]},{"text":"A trial found ear';
  const reply = (content: string) => ({ choices: [{ finish_reason: "length", message: { content } }] });
  const models = (content: string) => basetenModels({ apiKey: "k", fetcher: fake({ [box("brain")]: reply(content) }).fetcher });
  expect(await models(cut).synthesiseEvidence(evidenceInput)).toEqual({ bottomLine: "Not routinely.", claims: [{ text: "A guideline advises against routine steroids.", cites: [1] }], followUps: [], cutShort: true, source: "model", model: BRAIN_MODEL });
  expect(await models(cut.slice(0, 60)).synthesiseEvidence(evidenceInput)).toMatchObject({ source: "fixture" });
  // The same when it streams: the stream just ends, its JSON never closed.
  const encoder = new TextEncoder();
  const streamed = (content: string, finish_reason: string) => (url: string) => url.endsWith("/health") ? new Response("ok") : new Response(new ReadableStream({ start(c) {
    for (const piece of content.match(/[\s\S]{1,9}/g)!) c.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`));
    c.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason }] })}\n\ndata: [DONE]\n\n`)); c.close();
  } }), { headers: { "content-type": "text/event-stream" } });
  const whole = async (content: string, finish_reason: string) => {
    const run = basetenModels({ apiKey: "k", fetcher: fake({ [box("brain")]: streamed(content, finish_reason) }).fetcher }).streamEvidence!(evidenceInput);
    let next = await run.next();
    for (; !next.done; next = await run.next());
    return next.value;
  };
  const kept = await whole(cut, "length");
  expect(kept).toMatchObject({ bottomLine: "Not routinely.", claims: [{ cites: [1] }], cutShort: true, source: "model" });
  expect(kept.claims).toHaveLength(1);
  // The stream's finish reason is read as the whole call's is: an answer whose JSON closed is cut short only when the stream says "length".
  const closed = '{"bottomLine":"Not routinely.","claims":[{"text":"A guideline advises against routine steroids.","cites":[1]}]}';
  expect((await whole(closed, "length")).cutShort).toBe(true);
  expect("cutShort" in await whole(closed, "stop")).toBe(false);
});

test("a brief always names a recorded allergy, even when Gemma leaves it out", async () => {
  const { fetcher } = fake({ [box("brain")]: chatReply('{"lines":["Three days of cough and fever."]}') });
  const brief = await basetenModels({ apiKey: "k", fetcher }).briefing({ patient });
  expect(brief).toEqual({ lines: ["Three days of cough and fever.", "Allergy recorded: Penicillin."], source: "model", model: BRAIN_MODEL });
});

test("check-in replies go to Gemma through the shared readers, with the rule's urgent words as a floor", async () => {
  const { fetcher } = fake({ [box("brain")]: chatReply('{"label":"worse","symptom":"chest discomfort"}') });
  const models = basetenModels({ apiKey: "k", fetcher });
  expect(await models.classifyReply({ text: "sakit dada sikit", language: "ms" })).toEqual({ label: "urgent", symptom: "chest discomfort", source: "model", model: BRAIN_MODEL, decidedBy: "rules" });
});

test("an X-ray goes to MedGemma as an image; a plain-sentence reply is kept, and the read is never validated", async () => {
  const { fetcher, calls } = fake({ [box("xray")]: chatReply("The heart size is normal and the lungs are clear.") });
  const read = await basetenModels({ apiKey: "k", fetcher }).xrayRead({ image: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });
  expect(read).toEqual({ findings: ["The heart size is normal and the lungs are clear."], validated: false, source: "model", model: XRAY_MODEL });
  const body = JSON.parse(calls.at(-1)!.init.body as string);
  expect(body.messages[0].content[0].image_url.url).toBe(`data:image/jpeg;base64,${btoa("\x01\x02\x03")}`);
});

test("the reranker scores passages in box ②; asleep, it says so (the search keeps its own order and reports it) and the box is woken", async () => {
  const up = fake({ [box("voice")]: { scores: [0.1, 0.9] } });
  expect(await basetenReranker({ apiKey: "k", fetcher: up.fetcher })("steroid", ["a", "b"])).toEqual([0.1, 0.9]);
  // Scores for the wrong number of passages rank nothing.
  await expect(basetenReranker({ apiKey: "k", fetcher: up.fetcher })("steroid", ["a", "b", "c"])).rejects.toThrow("no scores");
  boxState.clear(); // asleep, not just failing after it answered
  const down = fake({});
  await expect(basetenReranker({ apiKey: "k", fetcher: down.fetcher })("steroid", ["a", "b", "c"])).rejects.toThrow("starting");
  expect(down.wakes()).toHaveLength(1);
});

test("with every box cold, each hosted reader answers its stub at once and says when its own model should be ready", async () => {
  const { fetcher } = fake({});
  const models = basetenModels({ apiKey: "k", fetcher });
  const photo = { image: new Uint8Array(1), contentType: "image/png" };
  expect(await models.briefing({ patient })).toMatchObject({ source: "fixture", waking: COLD_START_MIN.brain });
  expect(await models.xrayRead(photo)).toMatchObject({ source: "fixture", waking: COLD_START_MIN.xray });
  expect(await models.readMedicinePhoto(photo)).toMatchObject({ source: "fixture", waking: COLD_START_MIN.xray });
  expect(await models.deidentify({ text: "Amelia is better.", known: { names: ["Amelia Tan"] } })).toMatchObject({ source: "fixture", waking: COLD_START_MIN.pii });
});

test("the image readers go to MedGemma in box ③ with the photo, and while it starts the sample says when to expect it", async () => {
  const { fetcher, calls } = fake({ [box("xray")]: chatReply('Amlodipine 5 mg", "name": "Amlodipine", "dose": "5 mg"}') });
  const photo = { image: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" };
  expect(await basetenModels({ apiKey: "k", fetcher }).readMedicinePhoto(photo)).toEqual({ name: "Amlodipine", dose: "5 mg", source: "model", model: XRAY_MODEL });
  const body = JSON.parse(calls.at(-1)!.init.body as string);
  expect(calls.at(-1)!.url).toBe(`https://${box("xray")}/environments/production/sync/v1/chat/completions`);
  expect([body.model, body.messages[0].content[0].image_url.url, body.messages[1], body.continue_final_message]).toEqual([XRAY_MODEL, `data:image/jpeg;base64,${btoa("\x01\x02\x03")}`, { role: "assistant", content: '{"printed": "' }, true]);
  boxState.clear();
  const cold = basetenModels({ apiKey: "k", fetcher: fake({}).fetcher });
  expect(await cold.readMedicinePhoto(photo)).toEqual({ ...await stubModels.readMedicinePhoto(photo), waking: COLD_START_MIN.xray });
  const note = { ...photo, patient: { name: "[NAME]", knownMedicines: [] } };
  expect(await cold.readHandwrittenNote(note)).toEqual({ ...await stubModels.readHandwrittenNote(note), waking: COLD_START_MIN.xray });
  expect(await cold.incidentalFindings({ patientId: "SYN-1042", ...photo })).toMatchObject({ source: "fixture", waking: COLD_START_MIN.xray });
});

/*
 * The drafting methods: AI proposes, rules verify. Each gets a happy path, an unreadable reply and replies
 * that break its rule; the last two must come back as the stub's own answer, labelled fixture.
 */
const gemma = (reply: string) => basetenModels({ apiKey: "k", fetcher: fake({ [box("brain")]: chatReply(reply) }).fetcher });
const amelia = { ...DEMO_PATIENTS[0]!, time: "09:00" };
const fromModel = { source: "model", model: BRAIN_MODEL };

test("the visit summary is the model's words with the rules' changes; a number the visit never gave falls back to the fixture", async () => {
  const visit = { sections: [{ id: "s1", text: "Chest infection. Start amoxicillin 500 mg." }], prescriptions: [{ name: "Amoxicillin", detail: "500 mg", change: "new" as const }], followUps: [] };
  expect(await gemma(JSON.stringify({ summary: "You have a chest infection. Take amoxicillin 500 mg." })).draftVisitSummary(visit))
    .toEqual({ text: "You have a chest infection. Take amoxicillin 500 mg.", whatChanged: ["Started Amoxicillin"], ...fromModel } as never);
  expect((await gemma(JSON.stringify({ summary: "Take amoxicillin 250 mg." })).draftVisitSummary(visit)).source).toBe("fixture");
});

test("reasoning keeps only possibilities citing a record source it was given, one per line, in the model's order", async () => {
  const read = await gemma(JSON.stringify({ possibilities: [
    { title: "Pneumonia", why: "Five days of cough with a temperature of 38.1 °C.", sources: ["history", "vitals"] },
    { title: "Asthma: flare", why: "Childhood asthma is recorded.", sources: ["history", "xray"] },
    { title: "Viral bronchitis", why: "Cough alone.", sources: ["nowhere"] },
  ] })).reasoning({ patient: amelia, question: "What could explain this?" });
  expect(read).toEqual({ answer: "Pneumonia: Five days of cough with a temperature of 38.1 °C.\nAsthma flare: Childhood asthma is recorded.", sourceIds: ["history", "vitals"], ...fromModel });
  const stub = await stubModels.reasoning({ patient: amelia, question: "Why?" });
  // The model answered, and the checks kept none of it: the sample answers, marked `withheld`, so the card can say that
  // and not that the model was silent.
  expect(await gemma("Probably pneumonia.").reasoning({ patient: amelia, question: "Why?" })).toEqual({ ...stub, withheld: true });
  // A number the record lacks, or no record source: nothing left.
  expect(await gemma(JSON.stringify({ possibilities: [
    { title: "Sepsis", why: "A lactate of 4.2 points to it.", sources: ["vitals"] },
    { title: "Pneumonia", why: "Most likely, given the cough.", sources: ["xray"] },
  ] })).reasoning({ patient: amelia, question: "Why?" })).toEqual({ ...stub, withheld: true });
  // A model that never answered is not `withheld`.
  const silent = basetenModels({ apiKey: "k", fetcher: fake({ [box("brain")]: () => new Response("down", { status: 500 }) }).fetcher });
  expect(await silent.reasoning({ patient: amelia, question: "Why?" })).not.toHaveProperty("withheld");
});

test("reasoning (9 Oct) ranks by likelihood with brief reasons: 'most likely' and 'less likely' are kept as written", async () => {
  const read = await gemma(JSON.stringify({ possibilities: [
    { title: "Community-acquired pneumonia", why: "Most likely: five days of cough with a temperature of 38.1 °C.", sources: ["history", "vitals"] },
    { title: "Asthma flare", why: "Less likely, though childhood asthma is recorded.", sources: ["history"] },
  ] })).reasoning({ patient: amelia, question: "What is the most likely cause?" });
  expect(read).toEqual({ answer: "Community-acquired pneumonia: Most likely: five days of cough with a temperature of 38.1 °C.\nAsthma flare: Less likely, though childhood asthma is recorded.", sourceIds: ["history", "vitals"], ...fromModel });
  // Ranked or not, a number the record lacks still drops it.
  expect(await gemma(JSON.stringify({ possibilities: [{ title: "Pneumonia", why: "Most likely, with a CRP of 180.", sources: ["history"] }] })).reasoning({ patient: amelia, question: "Why?" })).toMatchObject({ source: "fixture", withheld: true });
});

test("reasoning on a sparse record reasons from what is recorded and ends with what the record lacks, under the same checks", async () => {
  const daniel = { ...DEMO_PATIENTS[1]!, time: "09:30" };
  const reply = JSON.stringify({ possibilities: [
    { title: "Heart failure", why: "Breathlessness on exertion at 57 is recorded, with nothing yet to weigh against it.", sources: ["history"] },
    { title: "COPD", why: "Breathlessness on exertion; the smoking history is not documented.", sources: ["history"] },
  ], missing: ["Onset and duration", "Observations", "The most likely cause", "A lactate of 4.2"] });
  const read = await gemma(reply).reasoning({ patient: daniel, question: "What possibilities should I consider?" });
  expect(read).toMatchObject({ source: "model", sourceIds: ["history"] });
  expect(read.answer.split("\n")).toEqual([
    "Heart failure: Breathlessness on exertion at 57 is recorded, with nothing yet to weigh against it.",
    "COPD: Breathlessness on exertion; the smoking history is not documented.",
    "Not in the record: Onset and duration; Observations; The most likely cause",
  ]);
  // A whole record's answer is its possibilities only: the app lists each line as one.
  expect((await gemma(reply.replace(/57/g, "42")).reasoning({ patient: amelia, question: "Why?" })).answer).not.toContain("Not in the record");
});

test("the huddle brief is Gemma's words over the rule's numbers; a number the rule did not count brings the rule back", async () => {
  const facts = huddle(WARD_FIXTURE, {});
  expect(facts[0]).toBe("1 ready to go, 2 fit but blocked, about 8 bed-hours waiting.");
  const lines = ["One is ready to go and two are fit but blocked, about 8 bed-hours.", "Start with Bed 2: the final guarantee letter and the urine culture.", "Four blockers still need an owner."];
  expect(await gemma(JSON.stringify({ lines })).huddleBrief({ beds: WARD_FIXTURE, owners: {} })).toEqual({ lines, ...fromModel });
  const rule = { lines: facts, source: "fixture" };
  expect(await gemma(JSON.stringify({ lines: ["3 fit to go.", "Start with Bed 14.", "4 have no owner."] })).huddleBrief({ beds: WARD_FIXTURE, owners: {} })).toEqual(rule);
  expect(await gemma(JSON.stringify({ lines: lines.slice(0, 2) })).huddleBrief({ beds: WARD_FIXTURE, owners: {} })).toEqual(rule);
  expect(await gemma("{not json").huddleBrief({ beds: WARD_FIXTURE, owners: {} })).toEqual(rule);
});

test("a drafted reply may answer anything (the nurse checks it), but never promises a time, leaves out 999 when urgent or switches language", async () => {
  const plan = { medicines: [{ name: "Azithromycin", line: "Take 500 mg once a day for 2 more days" }], nextVisit: "Clinic review, 14 Oct" };
  const ask: Parameters<Models["draftReply"]>[0] = { text: "Can I stop the azithromycin?", label: "clinical", patientFirstName: "Amelia", plan, language: "en" };
  // No content limit: quoting the plan, general advice, or what a symptom may mean all reach the nurse as drafts.
  for (const text of [
    "Hi Amelia, your plan says: Take 500 mg once a day for 2 more days. A nurse can talk it through with you.",
    "Hi Amelia, it sounds like a chest infection is settling. Finish the course unless your doctor says otherwise.",
  ]) expect(await gemma(JSON.stringify({ text })).draftReply(ask)).toEqual({ text, ...fromModel });
  // Up to 600 characters (9 Oct; 280 before), never over.
  const long = `Hi Amelia, ${"finish the azithromycin course as your plan says and keep drinking fluids. ".repeat(7)}`.trim();
  expect(long.length).toBeGreaterThan(500);
  expect(long.length).toBeLessThanOrEqual(600);
  expect(await gemma(JSON.stringify({ text: long })).draftReply(ask)).toEqual({ text: long, ...fromModel });
  const broken: [string, typeof ask][] = [
    [`${long} ${long}`, ask],
    ["Hi Amelia, a nurse will call you within the hour.", ask],
    ["Hi Amelia, rest and drink water.", { ...ask, label: "urgent" }],
    ["Hi Amelia, a nurse can talk it through with you.", { ...ask, language: "zh" }],
    ["not json", ask],
  ];
  for (const [text, input] of broken) expect(await gemma(text === "not json" ? text : JSON.stringify({ text })).draftReply(input)).toEqual({ text: draftByRules(input), source: "fixture" });
});

test("codes come only from the candidates, each citing a sentence that states it; the kind is checked too", async () => {
  const sentences = noteFor(EMPTY_CLAIM);
  const { fetcher, calls } = fake({ [box("brain")]: chatReply(JSON.stringify({ codes: [
    { code: "J18.1", kind: "Principal", evidence: "diagnosis" }, // lobar is not stated
    { code: "J18.9", kind: "Principal", evidence: "diagnosis" },
    { code: "J45.9", kind: "Principal", evidence: "asthma" }, // a second Principal becomes Secondary
    { code: "J15.9", kind: "Secondary", evidence: "diagnosis" }, // not a candidate
    { code: "Z88.0", kind: "Secondary", evidence: "presenting" }, // that sentence does not state it
    { code: "87.44", kind: "Secondary", evidence: "xray" }, // the rule's procedure stays a procedure
  ] })) });
  const read = await basetenModels({ apiKey: "k", fetcher }).suggestCodes({ sentences, candidates: [{ code: "J18.1", label: "Lobar pneumonia, unspecified" }, { code: "J18.9", label: "Pneumonia, unspecified" }] });
  expect(read).toEqual({ codes: [
    { code: "J18.9", label: "Pneumonia, unspecified organism", kind: "Principal", evidence: "diagnosis" },
    { code: "J45.9", label: "Asthma, unspecified", kind: "Secondary", evidence: "asthma" },
    { code: "87.44", label: "Routine chest X-ray", kind: "Procedure", evidence: "xray" },
  ], ...fromModel });
  expect(JSON.parse(calls.at(-1)!.init.body as string).messages[1].content).toContain("J18.1 Lobar pneumonia, unspecified");
  // Negated or someone else's: nothing stated, so the rules answer.
  const denied = [{ id: "a", text: "No pneumonia on the chest film." }, { id: "b", text: "Mother has asthma." }];
  const rules = await stubModels.suggestCodes({ sentences: denied });
  expect(await gemma(JSON.stringify({ codes: [{ code: "J18.9", kind: "Principal", evidence: "a" }, { code: "J45.9", kind: "Secondary", evidence: "b" }] })).suggestCodes({ sentences: denied })).toEqual(rules);
  expect(await gemma("J18.9").suggestCodes({ sentences })).toEqual(await stubModels.suggestCodes({ sentences }));
});

test("an appeal quotes only the codes, sentences and numbers it was given", async () => {
  const input = { denialReason: "Documentation incomplete: organism / severity not stated", denialCode: "DOC" as const, codes: CODES, sentences: noteFor({ ...EMPTY_CLAIM, organismConfirmed: true }), patient: { name: "Amelia Tan" } };
  const letter = {
    opening: "We ask the insurer to review its denial for Amelia Tan (“organism / severity not stated”).",
    points: [{ claim: "The note says the organism was not identified, which J18.9 codes.", evidence: "organism" }, { claim: "Severity is recorded as CURB-65 0.", evidence: "diagnosis" }],
    closing: "We ask that the denial be withdrawn.",
  };
  expect(await gemma(JSON.stringify(letter)).draftAppeal(input)).toEqual({ letter: { ...letter, points: letter.points.map(p => ({ claim: p.claim, evidenceSentenceId: p.evidence })) }, ...fromModel });
  const rules = { letter: appealByRules(input), source: "fixture" };
  for (const bad of [
    { ...letter, points: [{ claim: "Severity is documented.", evidence: "nowhere" }] },
    { ...letter, points: [{ claim: "J15.9 applies.", evidence: "diagnosis" }] },
    { ...letter, points: [{ claim: "CURB-65 was 2.", evidence: "diagnosis" }] },
    { ...letter, opening: "The note says “sputum grew pneumococcus”." },
  ]) expect(await gemma(JSON.stringify(bad)).draftAppeal(input)).toEqual(rules);
  expect(await gemma("Dear insurer").draftAppeal(input)).toEqual(rules);
});

test("a discharge draft lists exactly the take-home medicines, in the leaflet's language, with the record's numbers only", async () => {
  // Amelia's plan: azithromycin, paracetamol and cetirizine go home; nebulised salbutamol stopped.
  const draft = {
    diagnosis: "Community-acquired pneumonia on background asthma.", course: "Cough for five days and fever; observed on the ward.",
    plan: "Oral azithromycin 2 more days, paracetamol as needed, cetirizine as before; clinic review.",
    full: "Admitted with five days of cough and fever. Treated with azithromycin. Going home on azithromycin 500 mg daily for 2 more days.",
    leaflet: "您因肺部感染接受了治疗。请每天服用一次阿奇霉素，再服2天。如呼吸更困难，请立即回院。",
    medicines: ["Azithromycin", "Paracetamol", "cetirizine"],
  };
  const { diagnosis, course, plan, full, leaflet } = draft;
  expect(await gemma(JSON.stringify(draft)).draftDischarge({ patient: amelia, language: "zh" })).toEqual({ summary: full, leaflet, lines: { diagnosis, course, plan }, ...fromModel });
  const authored = await stubModels.draftDischarge({ patient: amelia, language: "zh" });
  for (const bad of [
    { ...draft, medicines: ["Azithromycin", "Paracetamol"] },
    { ...draft, plan: "Nebulised salbutamol 4-hourly at home." },
    { ...draft, course: "36 h observation, afebrile." },
    { ...draft, leaflet: "Anda dirawat kerana jangkitan paru-paru. Makan azithromycin selama 2 hari lagi." }, // Malay, but Chinese was asked for
  ]) expect(await gemma(JSON.stringify(bad)).draftDischarge({ patient: amelia, language: "zh" })).toEqual(authored);
  expect(await gemma("Discharge summary: ...").draftDischarge({ patient: amelia, language: "zh" })).toEqual(authored);
});

test("a cited sentence counts whether Gemma writes its bare id or '[id] the sentence' (as it does live)", async () => {
  const { citedSentence } = await import("./baseten-models");
  const sentences = [{ id: "diagnosis", text: "Community-acquired pneumonia, CURB-65 0." }, { id: "xray", text: "Chest film: right lower zone consolidation." }];
  expect(citedSentence("diagnosis", sentences)?.id).toBe("diagnosis");
  expect(citedSentence("[diagnosis] Community-acquired pneumonia, CURB-65 0.", sentences)?.id).toBe("diagnosis");
  expect(citedSentence("[xray]", sentences)?.id).toBe("xray");
  expect(citedSentence("[organism] not in the note", sentences)).toBeUndefined();
});

test("the evidence answer streams: its bottom line, then each claim as it closes, then the whole answer; a box that is down gives the whole answer", async () => {
  const written = JSON.stringify({ bottomLine: "Not routinely.", claims: [{ text: "Guideline says no.", cites: [1], topic: "evidence" }, { text: "Trial found harm.", cites: [2], topic: "harms" }], followUps: ["When?"] });
  const encoder = new TextEncoder();
  // Gemma's reply as vLLM streams it: server-sent events of a few characters each.
  const streamed = (url: string) => url.endsWith("/health") ? new Response("ok") : new Response(new ReadableStream({ start(c) {
    for (const piece of written.match(/[\s\S]{1,7}/g)!) c.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`));
    c.enqueue(encoder.encode("data: [DONE]\n\n")); c.close();
  } }), { headers: { "content-type": "text/event-stream" } });
  const input = { question: "Steroids?", thread: [], sources: [{ n: 1, design: "Guideline", title: "G", text: "x" }, { n: 2, design: "Trial", title: "T", text: "y" }] };
  const run = basetenModels({ apiKey: "k", fetcher: fake({ [box("brain")]: streamed }).fetcher }).streamEvidence!(input);
  const parts = [];
  let next = await run.next();
  for (; !next.done; next = await run.next()) parts.push(next.value);
  expect(parts).toEqual([{ bottomLine: "Not routinely." }, { claim: { text: "Guideline says no.", cites: [1], topic: "evidence" } }, { claim: { text: "Trial found harm.", cites: [2], topic: "harms" } }]);
  expect(next.value).toMatchObject({ bottomLine: "Not routinely.", followUps: ["When?"], ...fromModel });
  boxState.clear();
  const down = await basetenModels({ apiKey: "k", fetcher: fake({}).fetcher }).streamEvidence!(input).next();
  expect(down.done && down.value).toMatchObject({ source: "fixture", waking: COLD_START_MIN.brain });
});

test("a code whose evidence quotes the note's words, not the sentence id, is kept when one sentence holds the quote", async () => {
  const { citedSentence } = await import("./baseten-models");
  const sentences = [{ id: "subjective", text: "Cough for five days, fever since yesterday. Wheeze at night." }, { id: "plan", text: "Chest film today." }];
  expect(citedSentence("Cough for five days, fever since yesterday.", sentences)?.id).toBe("subjective");
  expect(citedSentence("[plan] Chest film today.", sentences)?.id).toBe("plan");
  expect(citedSentence("Something the note never says at all", sentences)).toBeUndefined();
  // A sentence cited by its place in the list (Gemma, 6 Oct: "evidence": "5" for the note's fifth part).
  expect(citedSentence("2", sentences)?.id).toBe("plan");
  expect(citedSentence("9", sentences)).toBeUndefined();
});

test("a condition the doctor names in other words than the WHO label is coded when the model copies those words, never a negated or made-up one", async () => {
  const sentences = [{ id: "assessment", text: "Acute pyelonephritis, uncomplicated; no pneumonia." }];
  const candidates = [{ code: "N10", label: "Acute tubulo-interstitial nephritis" }, { code: "J18.9", label: "Pneumonia, unspecified" }, { code: "N17.9", label: "Acute renal failure, unspecified" }];
  const fetcher = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ codes: [
    { code: "N10", kind: "Principal", evidence: "assessment", stated: "Acute pyelonephritis" },
    { code: "J18.9", kind: "Secondary", evidence: "assessment", stated: "pneumonia" }, // negated
    { code: "N17.9", kind: "Secondary", evidence: "assessment", stated: "renal failure" }, // not in the sentence
  ] }) } }] }))) as unknown as typeof fetch;
  const read = await basetenModels({ apiKey: "k", fetcher }).suggestCodes({ sentences, candidates });
  expect(read.codes).toEqual([{ code: "N10", label: "Acute tubulo-interstitial nephritis", kind: "Principal", evidence: "assessment" }]);
  // A code from the model's own knowledge, in the US form: cut to WHO's four characters and left for the WHO table to name.
  const hip = [{ id: "assessment", text: "Day 6 after a left hip hemiarthroplasty for a neck of femur fracture." }];
  const own = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ codes: [{ code: "S72.00XA", kind: "Principal", evidence: "3", stated: "neck of femur fracture" }, { code: "B96.2", kind: "Secondary", evidence: "assessment", stated: "E. coli" }] }) } }] }))) as unknown as typeof fetch;
  expect((await basetenModels({ apiKey: "k", fetcher: own }).suggestCodes({ sentences: hip, candidates: [] })).codes).toEqual([{ code: "S72.0", label: "", kind: "Principal", evidence: "assessment" }]);
});

test("asked for voices, the ASR box is told to diarize and handed the visit's memory; its segments come back checked", async () => {
  const good = [{ voice: 1, from: 0, to: 2.4, text: " So apa masalah? " }, { voice: 2, from: 2.4, to: 5, text: "Batuk." }];
  const bad = [{ voice: 0, from: 0, to: 1, text: "x" }, { voice: 9, from: 0, to: 1, text: "x" }, { voice: 1.5, from: 0, to: 1, text: "x" }, { voice: 1, from: "0", to: 1, text: "x" }, { voice: 1, from: 0, to: 1, text: " " }, { voice: 1, from: 0, text: "x" }, null];
  const { fetcher, calls } = fake({ [box("voice")]: { text: "So apa masalah? Batuk.", memory: "m2", segments: [...good, ...bad] } });
  const models = basetenModels({ apiKey: "k", fetcher }), audio = new TextEncoder().encode("RIFF");
  const sent = () => { const form = calls.at(-1)!.init.body as FormData; return [form.get("diarize"), form.get("memory")]; };
  expect(await models.transcribe({ audio, voices: { memory: "m1" } })).toEqual({
    text: "So apa masalah? Batuk.", segments: [{ voice: 1, from: 0, to: 2.4, text: "So apa masalah?" }, good[1]!], memory: "m2", source: "model", model: ASR_MODEL,
  });
  expect(sent()).toEqual(["1", "m1"]);
  // A visit's first part has no memory to hand back yet.
  await models.transcribe({ audio, voices: {} });
  expect(sent()).toEqual(["1", null]);
  // Not asked for voices: the request and the answer are the words only, whatever else the box says.
  expect(await models.transcribe({ audio })).toEqual({ text: "So apa masalah? Batuk.", source: "model", model: ASR_MODEL });
  expect(sent()).toEqual([null, null]);
});

test("a diarized answer with no usable segment or memory is the words alone", async () => {
  const { fetcher } = fake({ [box("voice")]: { text: "Batuk.", memory: 7, segments: [{ voice: "1", from: 0, to: 1, text: "Batuk." }] } });
  expect(await basetenModels({ apiKey: "k", fetcher }).transcribe({ audio: new Uint8Array(4), voices: {} })).toEqual({ text: "Batuk.", source: "model", model: ASR_MODEL });
});

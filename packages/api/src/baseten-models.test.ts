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
  const body = JSON.parse(calls.at(-1)!.init.body as string);
  expect(body.messages[0].content[0].image_url.url).toBe(`data:image/jpeg;base64,${btoa("\x01\x02\x03")}`);
});

test("the reranker scores passages in box ②, and keeps the hybrid order when the box is asleep", async () => {
  const up = fake({ [box("voice")]: { scores: [0.1, 0.9] } });
  expect(await basetenReranker({ apiKey: "k", fetcher: up.fetcher })("steroid", ["a", "b"])).toEqual([0.1, 0.9]);
  boxState.clear(); // asleep, not just failing after it answered
  const down = fake({});
  expect(await basetenReranker({ apiKey: "k", fetcher: down.fetcher })("steroid", ["a", "b", "c"])).toEqual([-0, -1, -2]);
  expect(down.wakes()).toHaveLength(1);
});

test("methods without a hosted model yet stay on the stub, and never say a model is starting: nothing is starting for them", async () => {
  const { fetcher, calls } = fake({});
  const models = basetenModels({ apiKey: "k", fetcher });
  // Every box is cold, so the hosted readers say when their model should be ready...
  expect(await models.briefing({ patient })).toMatchObject({ source: "fixture", waking: COLD_START_MIN.brain });
  expect(await models.xrayRead({ image: new Uint8Array(1), contentType: "image/png" })).toMatchObject({ source: "fixture", waking: COLD_START_MIN.xray });
  // ...and the stub-only ones answer exactly as the stub does, calling nothing.
  const asked = calls.length;
  const known = { names: ["Amelia Tan"] }, note = { image: new Uint8Array(1), contentType: "image/png", patient: { name: "Amelia Tan", knownMedicines: [] } };
  expect(await models.deidentify({ text: "Amelia Tan", known })).toEqual(await stubModels.deidentify({ text: "Amelia Tan", known }));
  expect(await models.readMedicinePhoto({})).toEqual(await stubModels.readMedicinePhoto({}));
  expect(await models.readHandwrittenNote(note)).toEqual(await stubModels.readHandwrittenNote(note));
  expect(await models.incidentalFindings({ patientId: "SYN-1042" })).toEqual(await stubModels.incidentalFindings({ patientId: "SYN-1042" }));
  expect(calls).toHaveLength(asked);
});

/*
 * The drafting methods: AI proposes, rules verify. Each gets a happy path, an unreadable reply and replies
 * that break its rule; the last two must come back as the stub's own answer, labelled fixture.
 */
const gemma = (reply: string) => basetenModels({ apiKey: "k", fetcher: fake({ [box("brain")]: chatReply(reply) }).fetcher });
const amelia = { ...DEMO_PATIENTS[0]!, time: "09:00" };
const fromModel = { source: "model", model: BRAIN_MODEL };

test("reasoning keeps only possibilities citing a record source it was given, one per line, unranked", async () => {
  const read = await gemma(JSON.stringify({ possibilities: [
    { title: "Pneumonia", why: "Five days of cough with a temperature of 38.1 °C.", sources: ["history", "vitals"] },
    { title: "Asthma: flare", why: "Childhood asthma is recorded.", sources: ["history", "xray"] },
    { title: "Viral bronchitis", why: "Cough alone.", sources: ["nowhere"] },
  ] })).reasoning({ patient: amelia, question: "What could explain this?" });
  expect(read).toEqual({ answer: "Pneumonia: Five days of cough with a temperature of 38.1 °C.\nAsthma flare: Childhood asthma is recorded.", sourceIds: ["history", "vitals"], ...fromModel });
  const stub = await stubModels.reasoning({ patient: amelia, question: "Why?" });
  expect(await gemma("Probably pneumonia.").reasoning({ patient: amelia, question: "Why?" })).toEqual(stub);
  // A verdict, and a number the record lacks: nothing left, so the sample answers.
  expect(await gemma(JSON.stringify({ possibilities: [
    { title: "Pneumonia", why: "Most likely pneumonia given the cough.", sources: ["history"] },
    { title: "Sepsis", why: "A lactate of 4.2 points to it.", sources: ["vitals"] },
  ] })).reasoning({ patient: amelia, question: "Why?" })).toEqual(stub);
});

test("the huddle brief is Gemma's words over the rule's numbers; a number the rule did not count brings the rule back", async () => {
  const facts = huddle(WARD_FIXTURE, {});
  expect(facts[0]).toBe("3 fit to go, 2 still blocked, about 8 bed-hours waiting.");
  const lines = ["Three are fit to go and two are still blocked, about 8 bed-hours.", "Start with Bed 2: the final guarantee letter and the urine culture.", "Four blockers still need an owner."];
  expect(await gemma(JSON.stringify({ lines })).huddleBrief({ beds: WARD_FIXTURE, owners: {} })).toEqual({ lines, ...fromModel });
  const rule = { lines: facts, source: "fixture" };
  expect(await gemma(JSON.stringify({ lines: ["3 fit to go.", "Start with Bed 14.", "4 have no owner."] })).huddleBrief({ beds: WARD_FIXTURE, owners: {} })).toEqual(rule);
  expect(await gemma(JSON.stringify({ lines: lines.slice(0, 2) })).huddleBrief({ beds: WARD_FIXTURE, owners: {} })).toEqual(rule);
  expect(await gemma("{not json").huddleBrief({ beds: WARD_FIXTURE, owners: {} })).toEqual(rule);
});

test("a drafted reply may quote the plan, but never changes a dose, diagnoses, promises a time or leaves out 999 when urgent", async () => {
  const plan = { medicines: [{ name: "Azithromycin", line: "Take 500 mg once a day for 2 more days" }], nextVisit: "Clinic review, 14 Oct" };
  const ask: Parameters<Models["draftReply"]>[0] = { text: "Can I stop the azithromycin?", label: "clinical", patientFirstName: "Amelia", plan, language: "en" };
  const quoting = "Hi Amelia, your plan says: Take 500 mg once a day for 2 more days. A nurse can talk it through with you.";
  expect(await gemma(JSON.stringify({ text: quoting })).draftReply(ask)).toEqual({ text: quoting, ...fromModel });
  const broken: [string, typeof ask][] = [
    ["Hi Amelia, take 1000 mg instead.", ask],
    ["Hi Amelia, you can stop taking it now.", ask],
    ["Hi Amelia, it sounds like a chest infection.", ask],
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

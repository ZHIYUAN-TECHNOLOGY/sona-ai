import { SAMPLE_NOTE, segments, unsureWords } from "@sona-ai/domain/scan";
import { expect, test } from "bun:test";

import { stubModels } from "./models";
import { readingOf, visionModels, type Look, type Token } from "./vision-models";

const MODEL = "medgemma-1.5-4b";
const fromModel = { source: "model", model: MODEL };
const image = new Uint8Array([1, 2, 3]), contentType = "image/jpeg";
/** A token the model was sure of, or one with rivals it nearly wrote instead. */
const tok = (text: string, rivals: [string, number][] = []): Token => ({ text, p: 1 - rivals.reduce((s, [, p]) => s + p, 0), rivals: rivals.map(([t, p]) => ({ text: t, p })) });
/** A fake MedGemma: answers each ask by what it asks for, and records the asks. */
function eyes(answer: (ask: Parameters<Look>[0]) => { text: string; tokens?: Token[] } | string) {
  const asks: Parameters<Look>[0][] = [];
  const look: Look = async ask => { asks.push(ask); const a = answer(ask); return typeof a === "string" ? { text: a } : a; };
  return { models: visionModels(look, MODEL, stubModels), asks };
}

test("a medicine photo is read as printed: strength and form leave the name, and a frequency or dose the photo lacks is left out", async () => {
  const { models, asks } = eyes(() => '{"printed": "GLUCOMET Metformin Hydrochloride 500 mg 100 film-coated tablets", "name": "METFORMIN HYDROCHLORIDE 500 mg tablets", "dose": "500mg", "frequency": "twice a day"}');
  expect(await models.readMedicinePhoto({ image, contentType })).toEqual({ name: "Metformin Hydrochloride", dose: "500 mg", ...fromModel });
  // A quick read: the answer is started for it, so it answers at once instead of thinking aloud.
  expect(asks[0]).toMatchObject({ image: { bytes: image, contentType }, prefill: '{"printed": "', logprobs: true });
  const label = eyes(() => '{"printed": "Cetirizine 10 mg tablets Take ONE tablet at night", "name": "Cetirizine", "dose": "10 mg", "frequency": "at night"}');
  expect(await label.models.readMedicinePhoto({ image, contentType })).toEqual({ name: "Cetirizine", dose: "10 mg", frequency: "at night", ...fromModel });
  // A dose whose number is not on the photo is not a reading.
  const wrongDose = eyes(() => '{"printed": "Amlodipine 5 mg", "name": "Amlodipine", "dose": "10 mg"}');
  expect(await wrongDose.models.readMedicinePhoto({ image, contentType })).toEqual({ name: "Amlodipine", ...fromModel });
  const cream = eyes(() => '{"printed": "Hydrocortisone 1% cream 15 g", "name": "Hydrocortisone 1% cream", "dose": "1%"}');
  expect(await cream.models.readMedicinePhoto({ image, contentType })).toEqual({ name: "Hydrocortisone cream", dose: "1%", ...fromModel });
});

test("no medicine, a sentence for a name, or a name it did not read off the photo: the sample answers, labelled fixture", async () => {
  const sample = await stubModels.readMedicinePhoto({});
  for (const reply of [
    '{"printed": "", "name": ""}',
    '{"printed": "Dx Sin", "name": "This is not a medicine"}',
    '{"printed": "Paracetamol 500 mg", "name": "Ibuprofen", "dose": "500 mg"}',
    "I cannot read this photo.",
  ]) expect(await eyes(() => reply).models.readMedicinePhoto({ image, contentType })).toEqual(sample);
  // No photo is the bundled sample: nothing to look at.
  const { models, asks } = eyes(() => "{}");
  expect(await models.readMedicinePhoto({})).toEqual(sample);
  expect(asks).toEqual([]);
});

test("when it nearly read the medicine as another word, it looks again thinking first, and a different name that passes wins", async () => {
  const quick = { text: '{"printed": "AMIODIPINE 5 mg", "name": "AMIODIPINE", "dose": "5 mg"}', tokens: [tok("AM"), tok("IOD", [["L", 0.33]]), tok("IPINE"), tok(" 5"), tok(" mg"), tok('", "name": "AMIODIPINE", "dose": "5 mg"}')] };
  const slow = '<unused94>thought\nThe strip says "AMLODIPINE 5 mg".<unused95>```json\n{"printed": "AMLODIPINE 5 mg", "name": "AMLODIPINE", "dose": "5 mg"}\n```';
  const { models, asks } = eyes(ask => ask.prefill ? quick : slow);
  expect(await models.readMedicinePhoto({ image, contentType })).toEqual({ name: "Amlodipine", dose: "5 mg", ...fromModel });
  expect(asks.map(a => [Boolean(a.prefill), a.maxTokens])).toEqual([[true, 300], [false, 700]]);
  // Sure of it, it does not look twice; a second look that fails keeps the first.
  const sure = eyes(() => ({ ...quick, tokens: quick.tokens.map(t => ({ ...t, rivals: [] })) }));
  expect(await sure.models.readMedicinePhoto({ image, contentType })).toMatchObject({ name: "Amiodipine" });
  expect(sure.asks).toHaveLength(1);
  expect(await eyes(ask => ask.prefill ? quick : "looping...").models.readMedicinePhoto({ image, contentType })).toMatchObject({ name: "Amiodipine" });
  // A second look that never stops thinking has no answer, even if its working holds one.
  const looping = '<unused94>thought\n{"printed": "AMLODIPINE 5 mg", "name": "AMLODIPINE"} {"printed": "AMLODIPINE 5 mg"';
  expect(await eyes(ask => ask.prefill ? quick : looping).models.readMedicinePhoto({ image, contentType })).toMatchObject({ name: "Amiodipine" });
});

test("extra findings: what is there first, then each box on its own, and a box in the wrong place for its kind is left out", async () => {
  const { models, asks } = eyes(ask => {
    if (ask.prefill) return '{"cardiomegaly": true, "effusion": "left", "nodule": "right upper zone", "nodule_mm": 9}';
    if (ask.prompt.includes("Where is the heart?")) return '<unused94>thought\nThe heart is central.\n```json[{"box_2d": [0.1, 0.1, 0.2, 0.2]}]```<unused95>Final Answer: ```json[{"box_2d": [350, 450, 770, 750], "label": "heart"}]```';
    if (ask.prompt.includes("Where is the left pleural effusion?")) return 'Final Answer: ```json[{"box_2d": [180, 500, 830, 870], "label": "pleural effusion"}]```';
    return 'Final Answer: ```json[{"box_2d": [700, 200, 760, 260], "label": "nodule"}]```'; // the right lower zone, not the upper
  });
  const read = await models.incidentalFindings({ patientId: "SYN-2001", image, contentType });
  expect(read).toEqual({ validated: false, ...fromModel, findings: [
    { kind: "cardiomegaly", label: "Enlarged heart (cardiomegaly)", location: { x: 0.6, y: 0.56, zone: "cardiac silhouette", box: [0.35, 0.45, 0.77, 0.75] } },
    { kind: "effusion", label: "Left pleural effusion", location: { x: 0.685, y: 0.505, zone: "left middle zone", box: [0.18, 0.5, 0.83, 0.87] } },
  ] });
  expect(asks.slice(1).map(a => a.prompt.match(/Query: Where is (.*)\?/)?.[1])).toEqual(["the heart", "the left pleural effusion", "the nodule in the right upper zone"]);
});

test("a clear film reads as nothing found by the model; no image or a failed read is nothing found by no model, never the stub's authored findings", async () => {
  const clear = eyes(() => '{"cardiomegaly": false, "effusion": "none", "nodule": "none", "nodule_mm": 0}');
  expect(await clear.models.incidentalFindings({ patientId: "SYN-1042", image, contentType })).toEqual({ findings: [], validated: false, ...fromModel });
  expect(clear.asks).toHaveLength(1);
  const unread = { findings: [], validated: false, source: "fixture" };
  expect((await stubModels.incidentalFindings({ patientId: "SYN-1042" })).findings).toHaveLength(2);
  expect(await clear.models.incidentalFindings({ patientId: "SYN-1042" })).toEqual(unread);
  expect(await eyes(() => "The film is rotated.").models.incidentalFindings({ patientId: "SYN-1042", image, contentType })).toEqual(unread);
});

// The transcription as MedGemma's tokens (live, 1 Oct): "4mg" with a 7% "0" (40mg), "oedema" with "edema" at 35%.
const NOTE_TOKENS = [
  tok("<unused94>"), tok("thought\nhmm"), tok("<unused95>"),
  tok("plan"), tok(":"), tok(" start"), tok(" furosemide"), tok(" 4"), tok("mg", [["0", 0.07]]), tok(" IV"), tok(" BD"), tok("\n"),
  tok("stop"), tok(" amlodipine"), tok("\n"), tok("Bibasal"), tok(" creps", [["CREPS", 0.3]]), tok("."), tok(" pitting"), tok(" oed", [[" edema", 0.35]]), tok("ema"), tok("\n"),
  tok("R/V"), tok(" clinic"), tok(" 4/52"), tok("<end_of_turn>"),
];
const SORTED = {
  sections: { history: "", examination: "Bibasal creps. pitting oedema", assessment: "Heart failure with ejection fraction of 35%", plan: "start furosemide 4mg IV BD stop amlodipine R/V clinic 4/52" },
  medicines: [
    { name: "furosemide", dose: "4mg", frequency: "IV BD", change: "new" },
    { name: "amlodipine", dose: "", frequency: "", change: "stopped" },
    { name: "Bisoprolol", dose: "2.5 mg", frequency: "OD", change: "new" }, // not in the note
    { name: "TCA resp clinic", change: "new" },
  ],
  tasks: [{ title: "R/V clinic", due: "4/52" }, { title: "Echo", due: "tmrw" }],
  followUp: "4/52",
};

test("the transcription marks each word the model nearly read differently, and leaves out its thinking and control tokens", () => {
  const { text, lines, unsure } = readingOf(NOTE_TOKENS);
  expect(text).toBe("plan: start furosemide 4mg IV BD\nstop amlodipine\nBibasal creps. pitting oedema\nR/V clinic 4/52");
  expect(unsure).toEqual(["4mg", "oedema"]); // "CREPS" is the same word in capitals
  expect(lines.map(l => l.text).join("")).toBe(text);
  expect(unsureWords({ lines })).toEqual(["4mg", "oedema"]);
  // A gap the model nearly filled with a digit ("11/52"?) marks the word after it.
  expect(readingOf([tok("swelling"), tok(" ", [["1", 0.11]]), tok("1/52")]).unsure).toEqual(["1/52"]);
  // Chinese has no spaces: only the doubted characters are marked, neighbours joined, never the whole sentence.
  expect(readingOf([tok("请立即"), tok("拔", [["拨", 0.4]]), tok("打", [["电", 0.2]]), tok("999。"), tok("伤口保持干燥。")]).unsure).toEqual(["拔打"]);
  // Cut off while still thinking: there is no transcription.
  expect(readingOf([tok("<unused94>"), tok("thought about it")]).text).toBe("");
});

test("a handwritten note: read, then sorted from exactly those words; anything the note does not hold is left out, and doubted words are marked", async () => {
  const { models, asks } = eyes(ask => ask.image ? { text: "", tokens: NOTE_TOKENS } : JSON.stringify(SORTED));
  const note = await models.readHandwrittenNote({ image, contentType, patient: { name: "[NAME]", knownMedicines: [] } });
  expect(note).toMatchObject({ text: "plan: start furosemide 4mg IV BD\nstop amlodipine\nBibasal creps. pitting oedema\nR/V clinic 4/52", ...fromModel });
  expect(unsureWords(note)).toEqual(["4mg", "oedema"]);
  // The assessment's "35%" is not in the note: left out. The rest copies the note's words, so the doubted ones underline there too.
  expect(note.sections).toEqual({ history: "", examination: "Bibasal creps. pitting oedema", assessment: "", plan: "start furosemide 4mg IV BD stop amlodipine R/V clinic 4/52" });
  expect(segments(note.sections.plan, unsureWords(note)).filter(s => s.unsure).map(s => s.text)).toEqual(["4mg"]);
  // Furosemide touches "4mg", so it is low; a medicine the note never names, or "TCA", is not a medicine read from it.
  expect(note.medicines).toEqual([
    { name: "Furosemide", dose: "4 mg", frequency: "IV BD", change: "new", confidence: "low" },
    { name: "Amlodipine", change: "stopped", confidence: "high" },
  ]);
  // The review is the follow-up (in words), not also a task; "Echo" is not in the note either.
  expect(note.tasks).toEqual([]);
  expect(note.followUp).toEqual({ in: "4 weeks" });
  // Two looks: the photo with token probabilities, then the words alone, its answer started for it.
  expect(asks.map(a => [Boolean(a.image), a.logprobs ?? false, a.prefill ?? ""])).toEqual([[true, true, ""], [false, false, '{"sections": {"history": "']]);
  expect(asks[1]!.prompt).toEndWith(note.text);
});

test("an unreadable photo or an unsortable reply gives the sample note, labelled fixture", async () => {
  const sample = { ...structuredClone(SAMPLE_NOTE), source: "fixture" };
  const input = { image, contentType, patient: { name: "[NAME]", knownMedicines: [] } };
  expect(await eyes(() => ({ text: "", tokens: [tok("<unused94>"), tok("thought")] })).models.readHandwrittenNote(input)).toEqual(sample);
  expect(await eyes(ask => ask.image ? { text: "", tokens: NOTE_TOKENS } : "Sorry, I cannot.").models.readHandwrittenNote(input)).toEqual(sample);
});

test("a document page is read word for word: a blank page reads as no text, and a failed read falls back to the stub", async () => {
  const page = eyes(() => "<unused94>thought<unused95>## Ubat\nAmbil selepas makan.\n");
  expect(await page.models.readDocumentPage({ image, contentType })).toEqual({ text: "## Ubat\nAmbil selepas makan.", unsure: [], ...fromModel });
  expect(page.asks[0]).toMatchObject({ image: { bytes: image, contentType }, maxTokens: 1500, logprobs: true });
  expect(await eyes(() => "NO TEXT").models.readDocumentPage({ image, contentType })).toEqual({ text: "", unsure: [], ...fromModel });
  expect(await eyes(() => ({ text: "", tokens: [tok("NO"), tok(" TEXT")] })).models.readDocumentPage({ image, contentType })).toEqual({ text: "", unsure: [], ...fromModel });
  expect(await eyes(() => { throw new Error("down"); }).models.readDocumentPage({ image, contentType })).toEqual({ text: "", unsure: [], source: "fixture" });
});

test("a document page marks each word the model nearly read differently, so staff check it against the page", async () => {
  const tokens = [tok("<unused94>"), tok("thought"), tok("<unused95>"), tok("Jangan"), tok(" makan", [["minum", 0.3]]), tok(" dua"), tok(" kali.")];
  expect(await eyes(() => ({ text: "", tokens })).models.readDocumentPage({ image, contentType })).toEqual({ text: "Jangan makan dua kali.", unsure: ["makan"], ...fromModel });
});

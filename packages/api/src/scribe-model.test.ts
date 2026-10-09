import { beforeEach, expect, test } from "bun:test";

import { BOXES, BRAIN_MODEL, COLD_START_MIN, basetenModels, boxState } from "./baseten-models";
import { MANGLISH_CONSULTATION } from "./fixtures/manglish-consultation";
import { stubModels } from "./models";
import { checkDraft, citedStatement, medicinesIn, numbersIn, ruleNote, scribeModels, sentencesOf } from "./scribe-model";

const lines = MANGLISH_CONSULTATION.map(text => ({ text }));
const sentences = sentencesOf(lines);
/** What Gemma answered live for the Manglish consultation (1 Oct, 12 s), trimmed to the parts the checks read. */
const LIVE = {
  speakers: "1C 2C 3P 4C 5P 6C 7P 8C 9P 10P 11C 12P 13C 14C 15P 16C 17P 18C 19P 20C 21C 22P 23C 24P 25C 26P 27C 28C 29C 30C 31C 32C 33C 34C 35C 36C 37C 38P",
  history: ["Cough for 5 days, started fever yesterday [3, 5]", "Fever 38.5C with chills [5]", "Uses Ventolin inhaler as needed, used 3 times a day this week [17]", "Allergy to Penicillin (rash) [19, 20]", "Takes Panadol 2 tablets every 6 hours for fever [22]"],
  examination: ["Temperature 38.2, pulse 98, oxygen 96 percent [28]", "Crackles heard at the right lower side [30]"],
  assessment: ["Chest infection, likely pneumonia on the right side [32]"],
  plan: ["Azithromycin 500 mg once a day for three days [33]", "Chest X-ray today [35]", "Follow up in two days [37]"],
  medicines: ["Ventolin", "Penicillin", "Panadol", "azithromycin"],
};

test("the transcript's parts become numbered sentences; a decimal or a Chinese clause is not split wrongly", () => {
  expect(sentences).toHaveLength(38);
  expect(sentences[4]!.text).toBe("Semalam I check 38.5, malam tu menggigil sikit.");
  expect(sentencesOf([{ text: "晚上咳到睡不着。Any chest pain?", speaker: "patient" }])).toEqual([{ text: "晚上咳到睡不着。", speaker: "patient" }, { text: "Any chest pain?", speaker: "patient" }]);
});

test("numbers are read in digits and in English, Malay and Chinese words, so a rewording keeps them; a name's digit is not a number", () => {
  expect([...numbersIn("Batuk dah lima hari, demam dua puluh lima jam, 38.5")]).toEqual(["5", "25", "38.5"]);
  expect([...numbersIn("Two tablets every six hours, twice daily, one hundred and twenty over eighty")]).toEqual(["2", "6", "120", "80"]);
  expect([...numbersIn("一天两次, 三十八点五度, 十五天")]).toEqual(["1", "2", "38.5", "15"]);
  expect([...numbersIn("Amoxicillin 500mg TDS, seratus, dua belas")]).toEqual(["500", "3", "100", "12"]);
  expect([...numbersIn("SpO2 96% on room air, vitamin B12")]).toEqual(["96"]);
});

test("medicines are found by their generic endings, the brands said here, and the model's own list", () => {
  expect(medicinesIn("Start salbutamol and azithromycin; continue Panadol.", [])).toEqual(["salbutamol", "azithromycin", "panadol"]);
  expect(medicinesIn("Uses the blue inhaler as needed.", ["blue inhaler"])).toEqual(["blue", "inhaler"]);
  expect(medicinesIn("Cholesterol checked in April.", [])).toEqual(["cholesterol"]); // a fact the transcript must have anyway
  expect(medicinesIn("Rest and drink water.", [])).toEqual([]);
});

test("a statement cites its sentences at its end, in one or more brackets, or as an object", () => {
  expect(citedStatement("Cough for 5 days [3, 5]")).toEqual({ text: "Cough for 5 days", cites: [3, 5] });
  expect(citedStatement("Fever 38.5C. [5][6].")).toEqual({ text: "Fever 38.5C.", cites: [5, 6] });
  expect(citedStatement({ text: "Non-smoker", cites: [26, "x"] })).toEqual({ text: "Non-smoker", cites: [26] });
  expect(citedStatement("No citation")).toEqual({ text: "No citation", cites: [] });
});

test("Gemma's live draft passes the checks whole: four sections, and who said what as turns", () => {
  const draft = checkDraft(LIVE, sentences)!;
  expect(draft.dropped).toBe(0);
  expect(draft.sections.subjective.split("\n")[0]).toBe("Cough for 5 days, started fever yesterday.");
  expect(draft.sections.objective).toBe("Temperature 38.2, pulse 98, oxygen 96 percent.\nCrackles heard at the right lower side.");
  expect(draft.sections.assessment).toBe("Chest infection, likely pneumonia on the right side.");
  expect(draft.sections.plan.split("\n")).toHaveLength(3);
  expect(draft.turns.slice(0, 3)).toEqual([
    { text: "Okay Amelia, have a seat. So apa masalah hari ni?", speaker: "clinician", sure: true },
    { text: "Batuk dah lima hari doktor, and then semalam start demam.", speaker: "patient", sure: true },
    { text: "Demam tinggi tak?", speaker: "clinician", sure: true },
  ]);
  expect(draft.turns.map(t => t.text).join(" ")).toBe(sentences.map(s => s.text).join(" ")); // every word kept, in order
});

test("a number, dose or medicine the transcript lacks drops its statement, as does one citing nothing; the rest stands", () => {
  const draft = checkDraft({ ...LIVE,
    history: [...LIVE.history, "Fever 39.5C [5]", "Uses salbutamol as needed [17]", "Takes paracetamol for fever [22]", "Mother has asthma"],
    plan: [...LIVE.plan, "Azithromycin 250 mg for five days [33]", "Amoxicillin 500 mg [33]"],
  }, sentences)!;
  expect(draft.dropped).toBe(6);
  expect(draft.sections.subjective).not.toMatch(/39\.5|salbutamol|paracetamol|Mother/);
  expect(draft.sections.plan).toBe("Azithromycin 500 mg once a day for three days.\nChest X-ray today.\nFollow up in two days.");
});

test("an assessment or plan resting only on what the patient said is not the clinician's, so it is dropped", () => {
  const draft = checkDraft({ ...LIVE, assessment: ["Possible asthma flare [15]"], plan: ["Review the inhaler [17]", ...LIVE.plan] }, sentences)!;
  expect(draft.sections.assessment).toBe("");
  expect(draft.sections.plan).not.toContain("inhaler");
  expect(draft.dropped).toBe(2);
});

test("unsure speakers are marked, a sentence nobody labelled stays unjudged, and a clinician's confirmed speaker stands", () => {
  // The clinician confirmed the first line as the patient's (a correction), so the model's "C" for it is ignored.
  const confirmed = [{ text: "Ada kahak?", speaker: "patient" as const }, { text: "Ada, kuning. Okay." }];
  const draft = checkDraft({ speakers: "1C 2P 3C?", history: ["Yellow phlegm [2]"] }, sentencesOf(confirmed))!;
  expect(draft.turns).toEqual([
    { text: "Ada kahak? Ada, kuning.", speaker: "patient", sure: true },
    { text: "Okay.", speaker: "clinician", sure: false },
  ]);
  expect(checkDraft({ speakers: "", history: ["Yellow phlegm [2]"] }, sentencesOf(confirmed))!.turns[1]).toEqual({ text: "Ada, kuning. Okay.", sure: false });
});

test("nothing usable left, or no JSON, is no draft; the stub's answer is the captured words, labelled fixture", async () => {
  expect(checkDraft({ ...LIVE, history: ["Fever 40C [5]"], examination: [], assessment: [], plan: [] }, sentences)).toBeUndefined();
  expect(checkDraft(undefined, sentences)).toBeUndefined();
  const stub = await stubModels.draftNote({ lines: [{ text: " Batuk lima hari. " }, { text: "Ambil Panadol.", speaker: "clinician" }] });
  expect(stub).toEqual({ ...ruleNote([{ text: "Batuk lima hari." }, { text: "Ambil Panadol.", speaker: "clinician" }]), source: "fixture" });
  expect(stub.sections).toEqual({ subjective: "Batuk lima hari.\nClinician: Ambil Panadol.", objective: "", assessment: "", plan: "" });
  expect(stub.turns).toEqual([{ text: "Batuk lima hari.", sure: false }, { text: "Ambil Panadol.", speaker: "clinician", sure: true }]);
});

/** A fake box ①: health says 200, the chat answers `content` (or fails); records the request it was sent. */
function brainSaying(content: string | Error) {
  const sent: string[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/health")) return new Response(null, { status: 200 });
    if (url.endsWith("/wake")) return new Response(null, { status: 202 });
    sent.push(init.body as string);
    if (content instanceof Error) throw content;
    return Response.json({ choices: [{ message: { content } }] });
  }) as typeof fetch;
  return { models: basetenModels({ apiKey: "k", fetcher }), sent };
}
beforeEach(() => boxState.clear());

test("the Baseten adapter asks Gemma with the numbered transcript and labels the checked draft with the model", async () => {
  const { models, sent } = brainSaying("```json\n" + JSON.stringify(LIVE) + "\n```");
  expect(await models.draftNote({ lines })).toMatchObject({ source: "model", model: BRAIN_MODEL, dropped: 0 });
  const body = JSON.parse(sent[0]!);
  expect(body.model).toBe(BRAIN_MODEL);
  expect(body.messages[1].content).toStartWith("Transcript:\n[1] Okay Amelia, have a seat.\n[2] So apa masalah hari ni?\n[3] Batuk dah lima hari");
  // A speaker the clinician confirmed is shown to the model as settled.
  await models.draftNote({ lines: [{ text: "Okay Amelia, have a seat.", speaker: "clinician" }, { text: "Batuk dah lima hari." }] });
  expect(JSON.parse(sent[1]!).messages[1].content).toBe("Transcript:\n[1] (clinician) Okay Amelia, have a seat.\n[2] Batuk dah lima hari.");
});

test("an unreadable reply or a failed call is the captured words, labelled fixture; a cold box says when Gemma is ready", async () => {
  const stub = await stubModels.draftNote({ lines });
  expect(await brainSaying("Here is the note: cough, fever.").models.draftNote({ lines })).toEqual(stub);
  expect(await brainSaying(new Error("reset")).models.draftNote({ lines })).toEqual(stub);
  boxState.clear();
  const cold = basetenModels({ apiKey: "k", fetcher: (async (url: string) => new Response(null, { status: url.endsWith("/wake") ? 202 : 503 })) as typeof fetch });
  expect(await cold.draftNote({ lines })).toEqual({ ...stub, waking: COLD_START_MIN.brain });
  expect(BOXES.brain).toBe("q9p7zn63");
});

/** A visit the speech box numbered: the doctor (1), the patient (2), her daughter (3) and a nurse (4). Eight sentences. */
const VISIT = [
  { text: "So what brings you in today? Any fever?", voice: 1 },
  { text: "I have been coughing for five days. No fever.", voice: 2 },
  { text: "She missed two doses of her Ventolin this week.", voice: 3 },
  { text: "Blood pressure is 150 over 90.", voice: 4 },
  { text: "Okay. We will do a chest X-ray today.", voice: 1 },
];
const NAMED = {
  voices: "1C 2P 3F? 4N", speakers: "",
  history: ["Cough for five days, no fever [3, 4]", "Daughter reports two missed doses of Ventolin [5]"],
  examination: ["Nurse measured BP 150/90 [6]"], assessment: [], plan: ["Chest X-ray today [8]"], medicines: ["Ventolin"],
};

test("each voice is named once and every sentence it said takes that role; an unsure voice says so on all of them", () => {
  const draft = checkDraft(NAMED, sentencesOf(VISIT))!;
  expect(draft.turns).toEqual([
    { text: "So what brings you in today? Any fever?", speaker: "clinician", voice: 1, sure: true },
    { text: "I have been coughing for five days. No fever.", speaker: "patient", voice: 2, sure: true },
    { text: "She missed two doses of her Ventolin this week.", speaker: "family", voice: 3, sure: false },
    { text: "Blood pressure is 150 over 90.", speaker: "nurse", voice: 4, sure: true },
    { text: "Okay. We will do a chest X-ray today.", speaker: "clinician", voice: 1, sure: true },
  ]);
  expect(draft.voices).toEqual([{ voice: 1, speaker: "clinician", sure: true }, { voice: 2, speaker: "patient", sure: true }, { voice: 3, speaker: "family", sure: false }, { voice: 4, speaker: "nurse", sure: true }]);
  expect(draft.dropped).toBe(0);
  // A voice the model left out stays unjudged, one the transcript lacks is ignored, and a sentence's own letter cannot split a voice.
  const partly = checkDraft({ ...NAMED, voices: "1C 2P 9N", speakers: "5C 6C" }, sentencesOf(VISIT))!;
  expect(partly.voices).toEqual([{ voice: 1, speaker: "clinician", sure: true }, { voice: 2, speaker: "patient", sure: true }, { voice: 3, sure: false }, { voice: 4, sure: false }]);
  expect(partly.turns[2]).toEqual({ text: "She missed two doses of her Ventolin this week.", voice: 3, sure: false });
});

test("a speaker the clinician confirmed beats the role the model gave the line's voice", () => {
  const corrected = VISIT.map(l => l.voice === 3 ? { ...l, speaker: "interpreter" as const } : l);
  const draft = checkDraft(NAMED, sentencesOf(corrected))!;
  expect(draft.turns[2]).toEqual({ text: "She missed two doses of her Ventolin this week.", speaker: "interpreter", voice: 3, sure: true });
  expect(draft.voices![2]).toEqual({ voice: 3, speaker: "family", sure: false });
});

test("a plan resting only on what the patient and the family said is not the clinician's; one the clinician also said stands", () => {
  const draft = checkDraft({ ...NAMED, plan: ["Restart Ventolin [4, 5]", "Chest X-ray today, Ventolin doses reviewed [5, 8]"] }, sentencesOf(VISIT))!;
  expect(draft.sections.plan).toBe("Chest X-ray today, Ventolin doses reviewed.");
  expect(draft.dropped).toBe(1);
});

test("where only some sentences have a voice, the rest are read one by one, and the model is asked for both", async () => {
  const mixed = [{ text: "Any fever?", voice: 1 }, { text: "No fever. Cough for five days." }, { text: "We will do a chest X-ray today.", voice: 1, speaker: "clinician" as const }];
  const reply = { voices: "1C", speakers: "1P 2P 3P?", history: ["Cough for five days, no fever [2, 3]"], plan: ["Chest X-ray today [4]"] };
  const draft = checkDraft(reply, sentencesOf(mixed))!;
  expect(draft.turns).toEqual([
    { text: "Any fever?", speaker: "clinician", voice: 1, sure: true },
    { text: "No fever.", speaker: "patient", sure: true },
    { text: "Cough for five days.", speaker: "patient", sure: false },
    { text: "We will do a chest X-ray today.", speaker: "clinician", voice: 1, sure: true },
  ]);
  expect(draft.voices).toEqual([{ voice: 1, speaker: "clinician", sure: true }]);
  const { models, sent } = brainSaying(JSON.stringify(reply));
  expect(await models.draftNote({ lines: mixed })).toMatchObject({ source: "model", voices: draft.voices });
  const asked = JSON.parse(sent[0]!).messages;
  expect(asked[1].content).toBe("Transcript:\n[1] (voice 1) Any fever?\n[2] No fever.\n[3] Cough for five days.\n[4] (voice 1, clinician) We will do a chest X-ray today.");
  expect(asked[0].content).toContain('{"voices": "1C 2P 3F? 4N", "speakers": "7C 8P? ...", "history"');
  expect(asked[0].content).toContain("Daughter reports two missed doses");
  // No voices in the transcript: the model is asked as it always was, and the draft names none.
  expect(await models.draftNote({ lines })).not.toHaveProperty("voices");
  expect(JSON.parse(sent[1]!).messages[0].content).not.toContain("voice");
});

test("the captured words with voices: a named role labels its line, an unnamed voice is Voice N, and turns keep the voice", () => {
  expect(ruleNote([{ text: "Any fever?", voice: 1, speaker: "clinician" }, { text: "No.", voice: 2 }, { text: "She had one last night.", speaker: "family" }, { text: "Okay." }])).toEqual({
    sections: { subjective: "Clinician: Any fever?\nVoice 2: No.\nFamily: She had one last night.\nOkay.", objective: "", assessment: "", plan: "" },
    turns: [{ text: "Any fever?", speaker: "clinician", voice: 1, sure: true }, { text: "No.", voice: 2, sure: false }, { text: "She had one last night.", speaker: "family", sure: true }, { text: "Okay.", sure: false }],
    dropped: 0,
  });
});

test("the note is asked for as JSON the box must keep valid, so an unclosed list cannot drop the draft to its stub", async () => {
  let sent: Record<string, unknown> | undefined;
  const call = async (_box: unknown, _route: string, body: BodyInit) => { sent = JSON.parse(body as string); throw new Error("captured"); };
  await scribeModels(call as never, BRAIN_MODEL, stubModels).draftNote({ lines } as never);
  expect(sent?.response_format).toEqual({ type: "json_object" });
});

// 9 Oct: on staging Gemma answered about half the time with a section as one paragraph citing as it goes, and the next
// section's name as a string inside the history list. Every paragraph failed the number check on its own citations
// ([6], [9, 10]), so the doctor got the captured words labelled "Sample draft", or a note of one line.
const SAID = sentencesOf([
  { text: "I've been coughing for five days, doctor.", speaker: "patient" },
  { text: "The fever started yesterday.", speaker: "patient" },
  { text: "Just cetirizine, ten milligrams.", speaker: "patient" },
  { text: "Some wheeze on both sides.", speaker: "clinician" },
]);

test("a paragraph citing as it goes is split into its statements, so a citation's numbers are never read as numbers said", () => {
  const draft = checkDraft({ history: ["Coughing for five days [1], fever started yesterday [2], takes cetirizine 10mg [3]."], examination: ["Wheeze on both sides [4]."], assessment: [], plan: [], medicines: ["cetirizine"] }, SAID);
  expect(draft?.sections.subjective.split("\n")).toEqual(["Coughing for five days.", "Fever started yesterday.", "Takes cetirizine 10mg."]);
  expect(draft?.dropped).toBe(0);
});

test('a section named inside another\'s list starts that section there, and a list after "medicines:" is the medicines', () => {
  // The shape Gemma answered with on 9 Oct, trimmed: one history list holding every section.
  const draft = checkDraft({ speakers: "", history: ["Coughing for five days [1], fever started yesterday [2].", "examination:", "Wheeze on both sides [4].", "assessment:", "Chest infection [4].", "plan:", "Cetirizine 10mg at night [3, 4].", "medicines:", ["cetirizine"]] }, SAID);
  expect(draft?.sections).toEqual({ subjective: "Coughing for five days.\nFever started yesterday.", objective: "Wheeze on both sides.", assessment: "Chest infection.", plan: "Cetirizine 10mg at night." });
  expect(draft?.dropped).toBe(0);
  // Another 9 Oct shape: names with no colon or with a suffix, each followed by its list.
  const suffixed = checkDraft({ history: ["Coughing for five days [1].", "examination", "assessment", "plan", "medicines", ["cetirizine"], "examination_findings_list", ["Wheeze on both sides [4]"], "assessment_list", ["Chest infection [4]"], "plan_list", ["Cetirizine 10mg at night [3, 4]"]] }, SAID);
  expect(suffixed?.sections).toEqual({ subjective: "Coughing for five days.", objective: "Wheeze on both sides.", assessment: "Chest infection.", plan: "Cetirizine 10mg at night." });
});

test("a decimal said in words matches its digits, so the nurse's vitals are not dropped from the examination", () => {
  expect([...numbersIn("Temperature thirty-eight point one, saturation ninety-seven percent")]).toEqual(["38.1", "97"]);
  expect([...numbersIn("Suhu tiga puluh lapan perpuluhan lima, point two five")]).toEqual(["38.5", "0.25"]);
  const vitals = sentencesOf([{ text: "Temperature thirty-eight point one, pulse ninety-six.", speaker: "nurse" }]);
  expect(checkDraft({ history: [], examination: ["Temp 38.1, pulse 96. [1]"], assessment: [], plan: [] }, vitals)?.sections.objective).toBe("Temp 38.1, pulse 96.");
});

test("an unusable reply is asked for once more before the captured words; a failed call is not, so a timeout never doubles", async () => {
  // 9 Oct on staging, 2 drafts in 12: Gemma looped ("examination_notes_list_2", "_3", ...) until max_tokens, cut off mid-JSON.
  const looped = { choices: [{ message: { content: '{"history": ["Cough [1].", "examination_notes_list_2", "examination_notes_list_3", "exam' } }] };
  const good = { choices: [{ message: { content: JSON.stringify({ history: ["Coughing for five days [1]."], examination: [], assessment: [], plan: [] }) } }] };
  const replies = [looped, good];
  let calls = 0;
  const draft = await scribeModels((async () => replies[calls++]) as never, BRAIN_MODEL, stubModels).draftNote({ lines: [{ text: "I've been coughing for five days, doctor." }] } as never);
  expect(calls).toBe(2);
  expect(draft.source).toBe("model");
  expect(draft.sections.subjective).toBe("Coughing for five days.");
  calls = 0;
  const failed = await scribeModels((async () => { calls++; throw new Error("timeout"); }) as never, BRAIN_MODEL, stubModels).draftNote({ lines } as never);
  expect(calls).toBe(1);
  expect(failed.source).toBe("fixture");
});

test("the reply's length is capped by the consultation's, so a looping reply ends well inside SageMaker's 60 s and can be asked again", async () => {
  const sent: number[] = [];
  const capture = async (_b: unknown, _r: string, body: BodyInit) => { sent.push(JSON.parse(body as string).max_tokens); throw new Error("captured"); };
  const say = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `Line ${i + 1}.` }));
  for (const n of [4, 64, 600]) await scribeModels(capture as never, BRAIN_MODEL, stubModels).draftNote({ lines: say(n) } as never);
  // A good note used at most ~10 tokens a sentence on 9 Oct (623 for 64); a loop runs on to the cap.
  expect(sent).toEqual([460, 1360, 2400]);
});

test("the scribe is told each statement is its own string in its own list: 0 of 12 replies came back malformed with it, 3 of 8 without", async () => {
  const prompts: string[] = [];
  const capture = async (_b: unknown, _r: string, body: BodyInit) => { prompts.push(JSON.parse(body as string).messages[0].content); throw new Error("captured"); };
  await scribeModels(capture as never, BRAIN_MODEL, stubModels).draftNote({ lines } as never);
  await scribeModels(capture as never, BRAIN_MODEL, stubModels).draftNote({ lines: [{ text: "Cough.", voice: 1 }] } as never);
  for (const p of prompts) expect(p).toContain("never a paragraph of several statements, never a section's name inside a list");
});

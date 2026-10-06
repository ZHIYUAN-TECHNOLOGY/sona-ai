import type { NoteSections } from "@sona-ai/domain/types";

import type { Box } from "./baseten-models";
import { jsonIn } from "./chat-models";
import type { Models } from "./models";

/**
 * The consultation scribe on Gemma (box ①): the transcript in as numbered sentences, the note's four sections and
 * who said what out. AI proposes, rules verify, the clinician decides: who said each sentence is the model's reading
 * (the unsure ones say so), and every statement must cite the sentences it rests on and name only numbers, doses and
 * medicines the transcript has. A statement that fails is dropped and counted, so the app can say so; a draft with
 * nothing left is the stub's, labelled fixture.
 * Where the speech box numbered the voices, the model names each voice once, from everything it said, instead of guessing
 * sentence by sentence: one person cannot be the clinician in one sentence and the patient in the next.
 */
export type Speaker = "clinician" | "patient" | "family" | "nurse" | "interpreter" | "other";
/** A consultation line as the app sends it: the words heard, the voice the speech box numbered it as, and who said them once the clinician has confirmed it. */
export type ConsultationLine = { text: string; speaker?: Speaker; voice?: number };
/** One turn of who said what; `sure` is false where the speaker is a guess, and there is no `speaker` where nobody has judged it. */
export type Turn = { text: string; speaker?: Speaker; voice?: number; sure: boolean };
/** The draft in the app's four note sections, the dialogue as turns, how many statements the rule checks dropped, and who each numbered voice was read as. */
export type ScribeDraft = { sections: NoteSections; turns: Turn[]; dropped: number; voices?: { voice: number; speaker?: Speaker; sure: boolean }[] };

const LABEL: Record<Speaker, string> = { clinician: "Clinician", patient: "Patient", family: "Family", nurse: "Nurse", interpreter: "Interpreter", other: "Other" };

/** The captured words as they are, with no model reading them: the dialogue in the history section (as the app's own draft does), the rest left to the clinician. */
export function ruleNote(lines: ConsultationLine[]): ScribeDraft {
  const said = lines.map(l => ({ text: l.text.trim(), ...l.speaker ? { speaker: l.speaker } : {}, ...l.voice ? { voice: l.voice } : {} })).filter(l => l.text);
  // A voice nobody has named is still worth telling apart from the others.
  const by = (l: ConsultationLine) => l.speaker ? `${LABEL[l.speaker]}: ` : l.voice ? `Voice ${l.voice}: ` : "";
  return {
    sections: { subjective: said.map(l => by(l) + l.text).join("\n"), objective: "", assessment: "", plan: "" },
    turns: said.map(l => ({ ...l, sure: Boolean(l.speaker) })),
    dropped: 0,
  };
}

/** The transcript as sentences (numbered from 1 in the prompt), each keeping its line's voice and the speaker its line was confirmed as. */
export function sentencesOf(lines: ConsultationLine[]) {
  return lines.flatMap(l => l.text.split(/(?<=[.!?])\s+|(?<=[。！？])/).map(s => s.trim()).filter(Boolean).map(text => ({ text, speaker: l.speaker, voice: l.voice })));
}

// Number words in English and Malay (and the prescription shorthands), so "lima hari", "five days" and "5 days" agree.
const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, once: 1, twice: 2, thrice: 3, bd: 2, bid: 2, tds: 3, tid: 3, qds: 4, qid: 4,
  kosong: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, lapan: 8, sembilan: 9, sepuluh: 10, sebelas: 11,
  sekali: 1, sehari: 1, seminggu: 1, sebulan: 1, setahun: 1, sejam: 1, sebiji: 1,
};
const SCALES = ["hundred", "thousand", "belas", "puluh", "ratus", "ribu"];
const WORD = `(?:${[...Object.keys(UNITS), ...SCALES].join("|")})`;
const WORDS = new RegExp(`\\b${WORD}(?:[\\s-]+(?:and[\\s-]+)?${WORD})*\\b`, "g");
/** "dua puluh lima" is 25, "one hundred and twenty" 120, "dua belas" 12. */
function wordsValue(run: string) {
  let total = 0, hundreds = 0, group = 0;
  for (const w of run.split(/[\s-]+/)) {
    if (w === "belas") group = (group || 1) + 10;
    else if (w === "puluh") group = (group || 1) * 10;
    else if (w === "hundred" || w === "ratus") { hundreds += (group || 1) * 100; group = 0; }
    else if (w === "thousand" || w === "ribu") { total += (hundreds + group || 1) * 1000; hundreds = group = 0; }
    else group += UNITS[w] ?? 0; // "and"
  }
  return total + hundreds + group;
}
const ZH: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const ZH_SCALE: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
/** "三十八点五" is 38.5, "十五" 15, "两" 2. */
function zhValue(run: string) {
  const [whole = "", fraction = ""] = run.split("点");
  let total = 0, digit = 0;
  for (const ch of whole) {
    if (ch in ZH) digit = ZH[ch]!;
    else { total += (digit || 1) * ZH_SCALE[ch]!; digit = 0; }
  }
  return fraction ? `${total + digit}.${[...fraction].map(c => ZH[c] ?? "").join("")}` : `${total + digit}`;
}
/**
 * The numbers a text states, in digits or in English, Malay or Chinese words. A digit run glued to a word is part of a
 * name (SpO2, B12), not a number said. ponytail: no "point" in words ("thirty eight point five"); speech-to-text writes 38.5.
 */
export function numbersIn(text: string) {
  const plain = text.toLowerCase()
    .replace(/[零〇一二两三四五六七八九十百千点]+/g, run => ` ${zhValue(run)} `)
    .replace(/\bse(ratus|ribu)\b/g, "satu $1")
    .replace(WORDS, run => ` ${wordsValue(run)} `);
  return new Set((plain.match(/(?<![\p{L}\d])\d+(?:\.\d+)?/gu) ?? []).map(n => String(Number(n))));
}

// Words that name a medicine: generic-name endings (WHO INN stems) and the brands patients here say.
// ponytail: endings and a short brand list, not a formulary; Gemma's own list of the medicines it named catches the rest.
const STEMS = /(cillin|mycin|micin|cycline|oxacin|penem|azole|vir|olol|pril|sartan|dipine|statin|parin|farin|xaban|gatran|semide|thiazide|formin|gliptin|flozin|glitazone|terol|amol|sonide|asone|olone|isone|lukast|tropium|phylline|profen|fenac|coxib|oxicam|codone|adol|orphine|tadine|izine|ramine|tidine|setron|peridone|pramide|oxetine|traline|azepam|zolam|triptan|apine|tyline|caine|dronate)$/;
const BRANDS = new Set(["aspirin", "insulin", "digoxin", "ventolin", "augmentin", "amoxil", "zyrtec", "piriton", "ponstan", "voltaren", "voren", "gaviscon", "buscopan", "maxolon", "stemetil", "clarinase", "actifed", "celebrex", "arcoxia", "nexium", "losec", "lipitor", "norvasc", "glucophage", "diamicron", "seretide", "symbicort", "berodual", "uphamol"]);
const words = (text: string) => text.toLowerCase().match(/\p{L}[\p{L}'-]*/gu) ?? [];
/** The medicine words a statement names: a medicine-like word, or a word of a medicine the model listed that the statement contains. */
export function medicinesIn(statement: string, listed: string[]) {
  const lower = statement.toLowerCase();
  const fromList = listed.filter(m => m && lower.includes(m.toLowerCase())).flatMap(m => words(m).filter(w => w.length >= 4));
  const looksLike = words(statement).filter(w => BRANDS.has(w) || /^cef/.test(w) || (w.length >= 6 && STEMS.test(w)));
  return [...new Set([...fromList, ...looksLike])];
}

/** Every number, dose and medicine the statement names is in the transcript (a plural "antibiotics" matches a said "antibiotic"). */
export function onlyFromTranscript(statement: string, transcript: string, listed: string[]) {
  const said = transcript.toLowerCase(), numbers = numbersIn(transcript);
  return [...numbersIn(statement)].every(n => numbers.has(n))
    && medicinesIn(statement, listed).every(m => said.includes(m) || said.includes(m.replace(/e?s$/, "")));
}

const LETTERS: Record<string, Speaker> = { C: "clinician", P: "patient", F: "family", N: "nurse", I: "interpreter", O: "other" };
const READING = /(\d+)\s*([CPFNIO])(\?)?/gi;
/** The scribe's instructions. Without numbered voices they are as they were; with them the model names each voice once and reads sentence by sentence only where there is no voice. */
const scribe = (voiced: boolean) => `You are a hospital doctor's scribe. From the transcript of a consultation, draft the doctor's note for them to check and edit before saving.
The transcript is numbered sentences from speech recognition. It may mix English, Malay and Chinese (Manglish) and may contain recognition errors. ${voiced
  ? "A sentence marked (voice 2) was said by that voice, and one voice is one person throughout. A role beside it or alone, as in (voice 2, patient) or (clinician), is a confirmed speaker."
  : "A sentence marked (clinician) or (patient) has a confirmed speaker."}
Answer with compact JSON only, in exactly this shape:
{${voiced ? `"voices": "1C 2P 3F? 4N", "speakers": "7C 8P? ..."` : `"speakers": "1C 2C 3P 4C? ..."`}, "history": ["<statement> [3, 5]", ...], "examination": [...], "assessment": [...], "plan": [...], "medicines": ["<medicine>", ...]}
Rules:
${voiced
  ? `- voices: every voice number in the transcript, each followed by C (clinician), P (patient), F (family member or companion), N (nurse), I (interpreter) or O (other), and ? when unsure. Judge a voice by everything it says: the one who asks, examines, explains and advises is C; the one whose own symptoms, history and medicines they are is P; one who speaks about the patient is F; one who repeats what was said in another language is I.
- speakers: only the sentences that have no voice, each number followed by one of the same letters, and ? when unsure; "" when every sentence has a voice.
- When a family member, nurse or interpreter gives a fact, the statement says who: "Daughter reports two missed doses", "Nurse measured BP 150/90".`
  : `- speakers: every sentence number in order, each followed by C (clinician) or P (patient), and ? when it could be either. Judge each sentence on its own: a question to the patient, an examination step, an explanation or advice is C; the patient's own symptoms, history, medicines and answers are P.`}
- history, examination, assessment, plan: short clinical statements in English, each ending with the numbers of the sentences it rests on in brackets.
- history: the complaint and its course, relevant past, family and social history, current medicines and allergies.
- examination: only findings and measurements said aloud in the consultation; [] if none.
- assessment and plan: only the clinician's own impression, tests, treatment, advice and follow-up, as they said them; [] if they said none. Never add a diagnosis, test or treatment of your own.
- Use only what the transcript says. Keep every number, dose, frequency and medicine name as said (a brand stays a brand); never add, convert or correct one.
- medicines: every medicine your statements name, as written in them.`;

/** Where each of the model's sections lands in the app's note. */
const SECTIONS = { history: "subjective", examination: "objective", assessment: "assessment", plan: "plan" } as const;

/** A statement and the sentence numbers it cites: "Fever since yesterday. [3, 5]" (or `{ text, cites }`, should the model answer that way). */
export function citedStatement(value: unknown) {
  const { text, cites } = typeof value === "string" ? { text: value, cites: undefined } : (value ?? {}) as { text?: unknown; cites?: unknown };
  if (typeof text !== "string") return { text: "", cites: [] };
  const tail = text.match(/(?:\s*\[[\d,\s]+\])+\s*[.;]?\s*$/);
  const numbers = Array.isArray(cites) ? cites : tail?.[0].match(/\d+/g)?.map(Number) ?? [];
  return { text: (tail ? text.slice(0, tail.index) : text).trim().slice(0, 400), cites: numbers.filter((n): n is number => Number.isInteger(n) && n > 0) };
}

/** The model's reply checked against the transcript; undefined when no statement survives. */
export function checkDraft(read: Record<string, unknown> | undefined, sentences: ReturnType<typeof sentencesOf>): ScribeDraft | undefined {
  if (!read) return undefined;
  const transcript = sentences.map(s => s.text).join(" ");
  // Who each voice is ("1C 2P 3F?"): every sentence of a voice gets the one role.
  const roles = new Map<number, { speaker: Speaker; sure: boolean }>();
  for (const [, n, letter, unsure] of String(read.voices ?? "").matchAll(READING)) roles.set(Number(n), { speaker: LETTERS[letter!.toUpperCase()]!, sure: !unsure });
  // Who said what: a confirmed speaker stands; then the voice's role; then, for a sentence with no voice, the model's own reading of it ("1C 2P 3C? ...").
  const who: (Speaker | undefined)[] = sentences.map(s => s.speaker ?? roles.get(s.voice ?? 0)?.speaker);
  const sure = sentences.map(s => Boolean(s.speaker) || (roles.get(s.voice ?? 0)?.sure ?? false));
  for (const [, n, letter, unsure] of String(read.speakers ?? "").matchAll(READING)) {
    const i = Number(n) - 1;
    if (!sentences[i] || sentences[i]!.speaker || sentences[i]!.voice) continue;
    who[i] = LETTERS[letter!.toUpperCase()];
    sure[i] = !unsure;
  }
  const listed = Array.isArray(read.medicines) ? read.medicines.filter((m): m is string => typeof m === "string") : [];
  const sections: NoteSections = { subjective: "", objective: "", assessment: "", plan: "" };
  let dropped = 0, kept = 0;
  for (const [key, section] of Object.entries(SECTIONS) as [keyof typeof SECTIONS, keyof NoteSections][]) {
    const statements = (Array.isArray(read[key]) ? read[key] as unknown[] : []).flatMap(s => {
      const { text: said, cites } = citedStatement(s);
      const rests = cites.filter(n => n <= sentences.length);
      // An assessment or plan is the clinician's own: one resting only on what the patient or their family said is not.
      const clinicians = key !== "assessment" && key !== "plan" || rests.some(n => who[n - 1] !== "patient" && who[n - 1] !== "family");
      if (said && rests.length && clinicians && onlyFromTranscript(said, transcript, listed)) return [said.replace(/([^.!?])$/, "$1.")];
      dropped++;
      return [];
    });
    kept += statements.length;
    sections[section] = statements.join("\n");
  }
  if (!kept) return undefined;
  // Consecutive sentences of the same voice with the same reading make one turn.
  const turns: Turn[] = [];
  sentences.forEach((s, i) => {
    const last = turns.at(-1);
    if (last && last.speaker === who[i] && last.voice === s.voice && last.sure === sure[i]) last.text += ` ${s.text}`;
    else turns.push({ text: s.text, ...who[i] ? { speaker: who[i] } : {}, ...s.voice ? { voice: s.voice } : {}, sure: sure[i]! });
  });
  // The voices the transcript has, each with the model's role for it or none; a voice the model made up is not among them.
  const voices = [...new Set(sentences.flatMap(s => s.voice ? [s.voice] : []))].sort((a, b) => a - b).map(voice => ({ voice, ...roles.get(voice) ?? { sure: false } }));
  return { sections, turns, dropped, ...voices.length ? { voices } : {} };
}

/** box ①'s call (baseten-models `boxes().call`): a cold box throws at once, a failure throws too. */
type Call = (box: Box, route: string, body: BodyInit, contentType?: string, ms?: number) => Promise<any>;
/** A long consultation is a long reply: about 20 s for ten minutes of talk on the L4, so the wait is longer than the usual 30 s. */
const SCRIBE_MS = 90_000;

export function scribeModels(call: Call, model: string, fallback: Models): Pick<Models, "draftNote"> {
  return {
    async draftNote(input) {
      try {
        const sentences = sentencesOf(input.lines);
        const mark = (s: typeof sentences[number]) => [s.voice ? `voice ${s.voice}` : "", s.speaker ?? ""].filter(Boolean).join(", ");
        const transcript = sentences.map((s, i) => `[${i + 1}] ${mark(s) ? `(${mark(s)}) ` : ""}${s.text}`).join("\n");
        const messages = [{ role: "system", content: scribe(sentences.some(s => s.voice)) }, { role: "user", content: `Transcript:\n${transcript}` }];
        const out = await call("brain", "/v1/chat/completions", JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 2400 }), "application/json", SCRIBE_MS);
        const draft = checkDraft(jsonIn(out?.choices?.[0]?.message?.content), sentences);
        if (draft) return { ...draft, source: "model", model };
      } catch { /* the captured words below, labelled fixture */ }
      return fallback.draftNote(input);
    },
  };
}

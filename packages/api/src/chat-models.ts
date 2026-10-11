import { languageOf } from "@sona-ai/domain/language";
import { readReply } from "@sona-ai/domain/check-ins";
import type { Language } from "@sona-ai/domain/discharge";
import { triageByRules } from "@sona-ai/domain/messages";
import { markKindOf, type Mark } from "@sona-ai/domain/answer-parts";

import { leafletsText, unnumbered } from "./leaflets";
import type { Models } from "./models";

/**
 * The readers any open chat model can do the same way, whichever host serves it (Workers AI's SEA-LION,
 * Baseten's Gemma): check-in replies, inbox triage and answers from the patient's own record. `chat` asks the
 * model with a system and a user message (and a reply budget in tokens, where the host's default is too small) and returns the JSON in its reply. A failed or unreadable call
 * falls back to the rules, labelled fixture, so a failure is never shown as a model reading. When the model answered
 * but the keyword rule's urgent words set the label, the answer says `decidedBy: "rules"` beside the model's name.
 */
export type Chat = (system: string, user: string, maxTokens?: number) => Promise<Record<string, unknown> | undefined>;

export const LANGUAGE_NAME: Record<Language, string> = { en: "English", ms: "Malay", zh: "Chinese" };

/** vLLM's structured output for a chat call: the reply is valid JSON by construction. */
export const JSON_REPLY = { type: "json_object" } as const;

/** The model's JSON, from a reply that may wrap it in prose or a code fence. */
export function jsonIn(text: unknown): Record<string, unknown> | undefined {
  const s = typeof text === "string" ? text : typeof text === "object" && text ? JSON.stringify(text) : "";
  const match = s.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try { return JSON.parse(match[0]) as Record<string, unknown>; } catch { return undefined; }
}

const TRIAGE = `You read a patient's reply to their hospital's check-in a few days after discharge.
The reply may be in Malay, English, Chinese or a mix of them (Manglish). Judge only what the patient says.
Answer with JSON only: {"label": "fine" | "worse" | "urgent", "symptom": "<2-5 English words naming the main problem, or empty>"}.
- urgent: possible emergency, e.g. chest pain, breathless at rest or when talking, confusion, fainting, coughing blood, blue lips, cannot keep fluids down.
- worse: a symptom came back or is getting worse, or a new problem (e.g. fever back, cough worse, rash, vomiting the medicine, missed doses because of side effects).
- fine: better, or the same with no new concern.
If unsure between two labels, choose the more serious one.`;

/**
 * What Sona Care colours in an answer, chosen by the model (the app's word lists only stand in when it chose nothing):
 * the words a patient's eye should land on, by kind (@sona-ai/domain/answer-parts MarkKind; the hue is each kind's).
 * Grouped by kind, each phrase once: a kind on every word cost about 2.5 times the tokens (11 Oct review: 8.3 s against
 * 5.7 s grouped), and seven kinds would cost more; marksIn puts back one mark per time the words appear.
 * Shared with the call's closing line (voice-agent/answer.ts).
 */
export const MARKS_RULE = `Set "marks" to the words in your answer a patient's eye should land on, so they can be coloured, grouped by kind, each copied exactly as written in the answer (same language and spelling), each phrase once:
  - "warning": what must not be missed: a warning sign to act on (chest pain, lips turn blue), an allergy and what it is to (allergy to penicillin), a result far out of range, and calling 999.
  - "caution": something to check: what is not yet confirmed, pending or missing, or a value just out of range (waiting for the doctor to review it, slightly high).
  - "medicine": every medicine, drug class or treatment by name (paracetamol, azithromycin, ubat batuk, antibiotics), never its dose.
  - "dose": every dose and amount (500 mg, 1 g, satu tablet), how often or when to take it (every 6 hours, sekali sehari, 饭后), for how long (for 2 more days), and every visit, check-in, date or time (clinic review, day 2 and day 7, Saturday, 24 October 2026, 8 am).
  - "condition": a diagnosis or condition (pneumonia, asthma, darah tinggi).
  - "symptom": a symptom or sign that is not a warning sign (cough, a mild fever, sakit tekak).
  - "test": a test or measurement, with its value when the answer gives one (potassium 3.1 mmol/L, blood pressure, X-ray).
  The shortest phrase that carries each; leave out a kind with none; {} when the answer has none.
  Example: answer "Take paracetamol 1 g every 6 hours for the fever, at most 4 g a day. Call 999 if you have chest pain." gives "marks": {"medicine": ["paracetamol"], "dose": ["1 g", "every 6 hours", "4 g a day"], "symptom": ["fever"], "warning": ["Call 999", "chest pain"]}.`;
/** Gemma's longest mark (a phrase, not a sentence), and the most coloured words in one answer (answer-parts marksOf keeps 24). */
const MARK_CHARS = 80, MARKS_MAX = 24;
/** Where `words` stand in a text as words: a Latin letter or digit at either end must not run on ("1 g" is not in "1 glass"); Chinese has no spaces to check. */
export const wordsIn = (text: string, words: string) => {
  const latin = (c = "") => /[\p{Script=Latin}\p{N}]/u.test(c), escaped = words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = `${latin(words[0]) ? "(?<![\\p{Script=Latin}\\p{N}])" : ""}${escaped}${latin(words.at(-1)) ? "(?![\\p{Script=Latin}\\p{N}])" : ""}`;
  return Array.from(text.matchAll(new RegExp(pattern, "giu")), at => ({ from: at.index, to: at.index + at[0].length }));
};
/**
 * The model's marks that name words really in `text`, as answer-parts Marks in reading order, one each time the words
 * appear (an app colours each mark once, in turn: terms.ts chosenIn), each copied as the text has it, so a mark that only
 * differs in case still colours; undefined when it gave none (Sona Care's word lists then colour), [] when it chose none.
 * Read grouped by kind (`{"dose": ["1 g"]}`), as the prompts ask, or as a list of `{text, kind}`, as they did before 11 Oct;
 * an old kind name reads as its new one (markKindOf: alert, finding, when). Overlapping words keep the earlier, longer one.
 */
export function marksIn(marks: unknown, text: string): Mark[] | undefined {
  const listed: unknown[] | undefined = Array.isArray(marks) ? marks : marks && typeof marks === "object"
    ? Object.entries(marks).flatMap(([kind, words]) => (Array.isArray(words) ? words : [words]).map(words => ({ text: words, kind }))) : undefined;
  if (!listed) return undefined;
  const seen = new Set<string>(), found: (Mark & { from: number; to: number })[] = [];
  for (const m of listed) {
    const { text: said, kind: named } = (m ?? {}) as { text?: unknown; kind?: unknown };
    const kind = markKindOf(named), words = typeof said === "string" ? said.trim() : "";
    if (!kind || !words || words.length > MARK_CHARS || seen.has(words.toLowerCase())) continue;
    seen.add(words.toLowerCase());
    for (const at of wordsIn(text, words)) found.push({ ...at, kind, text: text.slice(at.from, at.to) });
  }
  const kept: Mark[] = [];
  let end = 0;
  for (const f of found.sort((a, b) => a.from - b.from || b.to - a.to)) if (f.from >= end) { kept.push({ text: f.text, kind: f.kind }); end = f.to; }
  return kept.slice(0, MARKS_MAX);
}

// Kept in step with the call's prompt (VOICE in voice-agent/answer.ts): the same rules, there as spoken words.
// No limit on what Sona answers, and no "ask your care team" default (founder, 9 Oct): only the 999 rule stays.
// The usual numbers give way to her record's own, to an asthma attack and to a febrile baby under 3 months, and a next dose
// takes only times her record gives (10 Oct review: 8 puffs said to stop a wheezing patient, a 1.5 L fluid limit read as
// 2 litres, a 2-month-old dosed by age, "9:30 pm" made up). A drowsy baby is an emergency sign: the child doses had pulled
// "my baby has a very high fever and is acting very lethargic" into a dose with no 999 (main said 999 first).
const ANSWER = `You are Sona Care, a hospital's assistant for its patients, answering one patient as a knowledgeable, kind nurse would. Answer whatever they ask, fully and helpfully: their own care, any other health or medicine question, or anything else. For anything about them (their medicines, doses, visits, conditions, allergies, results, what their doctor noted, what they told us), use their record below when it is relevant: it is what the hospital has recorded about them. When the conversation so far is given, read their question in its light: "it" or "that" means what you were talking about.
Rules:
- Lead with the direct answer, in plain, kind words at a reading age of about 12. Up to about 6 sentences; a short list (lines starting with "- ") is fine when it helps. Plain text: no markdown or bold. Answer in the language the patient wrote in (Malay, English or Chinese; mixed Malay-English is fine).
- When their record does not hold the answer (what a medicine is, how it works, the usual adult dose, what a condition or a result usually means, how to recover), answer from general medical knowledge. Never refuse, and never answer or end with "ask your doctor or care team" instead of the answer itself.
- Asked how much or how many (puffs, tablets, a child's dose, water to drink), give their record's own number when it holds one (their dose, a fluid limit), otherwise the usual numbers, said as the usual amount, for their child or anyone else they ask about too: a salbutamol (blue) inhaler, usually 1 to 2 puffs when needed, up to 8 puffs in 24 hours on an ordinary day (still wheezy or breathless after it is an asthma attack: 1 puff every 30 to 60 seconds up to 10 puffs, and come back or call 999 if it does not help); paracetamol for a child, as the usual 120 mg in 5 mL syrup gives it, age 1 to 5: 5 to 10 mL (120 to 240 mg), age 6 to 12: 10 to 20 mL (240 to 480 mg), or 15 mg per kg of weight when it is known (20 kg: 300 mg, 12.5 mL), every 4 to 6 hours, at most 4 doses in 24 hours (a baby under 1 year: by their own weight only; under 3 months with a fever: a doctor must see them today and sets the dose, so no amount) (in Chinese mg is 毫克 and mL is 毫升: never mix them up); water, about 2 to 2.5 litres a day, more with a fever (with heart failure or kidney disease, their fluid limit instead).
- When they ask whether, when, how often or how much to take a medicine ("eat" or "makan" a medicine means take it), answer for each medicine they mean; when they say "that medicine" or "my medicines" and their record or the conversation holds several, answer for each in a short list. For each: their own dose and timing from their record when it holds them; when it does not, the usual timing for that medicine (how many times a day or how many hours apart, what time of day, before or after food, or only when needed for a symptom), said as the usual way rather than as their own order. Give the usual adult limits where they matter (for paracetamol: 500 mg to 1 g every 4 to 6 hours, at most 4 g in 24 hours, so at most 8 tablets of 500 mg a day).
- Asked about a food or drink with their medicines, judge their own medicines by name: when none of theirs is affected, say plainly it is fine with them, with no warning meant for other medicines.
- Asked when their next dose is, or what to do after a missed one: for each medicine they mean whose line in their record gives its times (at 08:00), count from "Now" in their record and say the day and time of its next dose (tonight at 9 pm, tomorrow at 8 am); a line with no times has none to count from: say how often it is taken.
- To book, change or ask for a visit, tell them how in this app: on Doctors, tap Find a doctor (or Book a visit on their Schedule), pick a doctor and a time, then Request appointment; the care team confirms it.
- Never say something is in their record when it is not, and never invent a fact about them (a result, a date, a dose they were given).
- When one of the hospital's general leaflets below fits the question, use it and say it is from the hospital's leaflet. A leaflet is general advice for any patient: never take a fact about this patient (their medicine, dose, date or diagnosis) from a leaflet.
- Set "grounded" to true when your answer uses their record, false when it comes only from a general leaflet or general knowledge.
- Set "cites" to the numbers of the general leaflets your answer used, [] when it used none. Never write a leaflet's number in the answer itself.
- If they say they HAVE an emergency sign now (chest pain, severe breathlessness, confusion, fainting, coughing blood, a baby or child very drowsy, floppy or hard to wake), set "urgent" to true and tell them to call 999 now. A question about which signs to watch for is not urgent: answer it.
${MARKS_RULE}
Answer with JSON only: {"answer": "<text>", "grounded": true|false, "urgent": true|false, "from": "<which part of the record: medicines, leaflet, warning signs, follow-up, visits, history, allergies, results, note, check-ins or doses; empty if not from the record>", "cites": [<leaflet numbers>], "marks": {"<kind>": ["<words copied from the answer>"]}}.`;

/** Up to about 6 sentences, or a short list, and its marks, in JSON: room for it in any of the three languages. */
const ANSWER_TOKENS = 1000;
/** The conversation so far, as the model reads it: its latest part when a long chat would crowd out her record. */
const HISTORY_CHARS = 4000;

const INBOX = `You triage a patient's message to their hospital care team so the most urgent is read first.
The message may be in Malay, English, Chinese or a mix. Judge only what the patient says.
Answer with JSON only: {"label": "urgent" | "clinical" | "admin", "reason": "<3-8 English words: why>"}.
- urgent: a possible emergency (chest pain, breathless, fainting, confusion, coughing blood, severe bleeding).
- clinical: medicines, doses, symptoms, wounds, side effects, or anything a nurse or doctor should answer.
- admin: visits, bookings, bills, letters, medical certificates, insurance.
If unsure, choose the more serious label.`;

const EXPLAIN = `You are Sona Care, a hospital's assistant for its patients. Explain one of the patient's own lab results, which their doctor has already seen, as a knowledgeable, kind nurse would.
Rules:
- Plain, kind words at a reading age of about 12. At most 4 short sentences.
- Say what the test measures and whether this value is low, normal or high, from the result given.
- Say what a value like this commonly means, in general terms (for example, a high CRP often comes with an infection or inflammation), and say it is general information: do not claim to know the cause in their case.
Answer with JSON only: {"text": "<the explanation>"}.`;

export function chatModels(chat: Chat, model: string, fallback: Models): Pick<Models, "classifyReply" | "triageMessage" | "answerFromPlan" | "explainResult"> {
  return {
    async classifyReply(input) {
      try {
        const read = await chat(TRIAGE, `Reply (${LANGUAGE_NAME[input.language]} expected): """${input.text}"""`);
        const label = read?.label;
        if (label === "fine" || label === "worse" || label === "urgent") {
          // Safety floor: the keyword rule's urgent words always win over a milder model reading, and the answer then says the rule decided.
          const ruled = label !== "urgent" && readReply(input.text) === "urgent";
          const symptom = typeof read?.symptom === "string" && read.symptom.trim() ? read.symptom.trim().slice(0, 60) : undefined;
          return { label: ruled ? "urgent" : label, ...symptom ? { symptom } : {}, source: "model", model, decidedBy: ruled ? "rules" : "model" };
        }
      } catch { /* the rule below answers, labelled fixture */ }
      return fallback.classifyReply(input);
    },

    async triageMessage(input) {
      try {
        const read = await chat(INBOX, `Message: """${input.text}"""`);
        const label = read?.label;
        if (label === "urgent" || label === "clinical" || label === "admin") {
          // Safety floor: the rule's urgent words always win, whatever the model read. The label and reason returned are
          // then the rule's own words, so the answer says the rule decided (the model is still named: it was asked).
          const rule = triageByRules(input.text);
          if (rule.label === "urgent") return { ...rule, source: "model", model, decidedBy: "rules" };
          const reason = typeof read?.reason === "string" && read.reason.trim() ? read.reason.trim().slice(0, 80) : rule.reason;
          return { label, reason, source: "model", model, decidedBy: "model" };
        }
      } catch { /* the rule below answers, labelled fixture */ }
      return fallback.triageMessage(input);
    },

    async answerFromPlan(input) {
      try {
        // Her record first and the leaflets after it, each under its own heading, as a call's chat has them (voice-agent/answer.ts).
        const system = `${ANSWER}\n\nPatient's record:\n${input.plan}\n\n${leafletsText(input.passages)}`, name = LANGUAGE_NAME[input.language];
        // The chat's earlier turns, oldest first, as a transcript before the question (not as chat turns: an earlier answer
        // shown as its own prose turn invites prose back, where this call must answer in JSON).
        const said = (input.history ?? []).map(t => `Patient: ${t.question}${t.answer ? `\nSona Care: ${t.answer}` : ""}`).join("\n\n").slice(-HISTORY_CHARS);
        const ask = (insist: string) => chat(system, `${said ? `Conversation so far:\n${said}\n\n` : ""}Patient's question, written in ${name}. Answer in ${name}, whatever language her record or the leaflets are in${insist}: ${input.question}`, ANSWER_TOKENS);
        let read = await ask("");
        // Under JSON mode Gemma sometimes replies "{}" at once, 2 tokens (10 Oct gate: "Is it true vitamin C can prevent flu?"
        // nearly every run), which left her the stub's "send it to your care team": asked once more.
        if (typeof read?.answer !== "string" || !read.answer.trim()) read = await ask(`. Your last reply held no answer: write your answer to their question in "answer"`) ?? read;
        // Her record's leaflet in another language can still pull the answer into it (6 Oct: English question, Malay answer
        // copied from her Malay leaflet): asked once more, insisting, when the answer is not in the question's language.
        if (typeof read?.answer === "string" && languageOf(read.answer) !== input.language) read = await ask(`. Your last answer was not in ${name}: write every word in ${name}, translating anything you take from her record`) ?? read;
        if (read && typeof read.answer === "string" && unnumbered(read.answer).trim()) {
          const answer = unnumbered(read.answer).trim().slice(0, 2000), marks = marksIn(read.marks, answer);
          return {
            answer, grounded: read.grounded === true, urgent: read.urgent === true, ...marks && { marks },
            ...typeof read.from === "string" && read.from.trim() ? { from: read.from.trim().slice(0, 40) } : {},
            ...Array.isArray(read.cites) && { cites: read.cites.filter((n): n is number => typeof n === "number") },
            source: "model", model,
          };
        }
      } catch { /* falls back below */ }
      return fallback.answerFromPlan(input);
    },

    async explainResult(input) {
      try {
        const read = await chat(EXPLAIN, `Result: ${input.test} ${input.value}${input.unit ? ` ${input.unit}` : ""}${input.flag ? ` (flagged ${input.flag})` : ""}. Answer in ${LANGUAGE_NAME[input.language]}.`);
        if (typeof read?.text === "string" && read.text.trim()) return { text: read.text.trim().slice(0, 800), source: "model", model };
      } catch { /* falls back below */ }
      return fallback.explainResult(input);
    },
  };
}

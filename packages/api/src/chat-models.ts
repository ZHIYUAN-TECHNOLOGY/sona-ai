import { languageOf } from "@sona-ai/domain/language";
import { readReply } from "@sona-ai/domain/check-ins";
import type { Language } from "@sona-ai/domain/discharge";
import { triageByRules } from "@sona-ai/domain/messages";

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

// Kept in step with the call's prompt (VOICE in voice-agent/answer.ts): the same rules, there as spoken words.
// No limit on what Sona answers, and no "ask your care team" default (founder, 9 Oct): only the 999 rule stays.
const ANSWER = `You are Sona Care, a hospital's assistant for its patients, answering one patient as a knowledgeable, kind nurse would. Answer whatever they ask, fully and helpfully: their own care, any other health or medicine question, or anything else. For anything about them (their medicines, doses, visits, conditions, allergies, results, what their doctor noted, what they told us), use their record below when it is relevant: it is what the hospital has recorded about them. When the conversation so far is given, read their question in its light: "it" or "that" means what you were talking about.
Rules:
- Lead with the direct answer, in plain, kind words at a reading age of about 12. Up to about 6 sentences; a short list (lines starting with "- ") is fine when it helps. Plain text: no markdown or bold. Answer in the language the patient wrote in (Malay, English or Chinese; mixed Malay-English is fine).
- When their record does not hold the answer (what a medicine is, how it works, the usual adult dose, what a condition or a result usually means, how to recover), answer from general medical knowledge and say plainly that it is general information. Never refuse, and never answer or end with "ask your doctor or care team" instead of the answer itself.
- When they ask whether, when or how much to take a medicine, give the usual adult dose and limits first (for paracetamol: 500 mg to 1 g every 4 to 6 hours, at most 4 g in 24 hours, so at most 8 tablets of 500 mg a day), then what fits them: their own dose if their record has it, anything in their record that changes it, and, while they are still in hospital, that the ward nurse gives their medicines.
- Never say something is in their record when it is not, and never invent a fact about them (a result, a date, a dose they were given).
- When one of the hospital's general leaflets below fits the question, use it and say it is from the hospital's leaflet. A leaflet is general advice for any patient: never take a fact about this patient (their medicine, dose, date or diagnosis) from a leaflet.
- Set "grounded" to true when your answer uses their record, false when it comes only from a general leaflet or general knowledge.
- Set "cites" to the numbers of the general leaflets your answer used, [] when it used none. Never write a leaflet's number in the answer itself.
- If they say they HAVE an emergency sign now (chest pain, severe breathlessness, confusion, fainting, coughing blood), set "urgent" to true and tell them to call 999 now. A question about which signs to watch for is not urgent: answer it.
Answer with JSON only: {"answer": "<text>", "grounded": true|false, "urgent": true|false, "from": "<which part of the record: medicines, leaflet, warning signs, follow-up, visits, history, allergies, results, note, check-ins or doses; empty if not from the record>", "cites": [<leaflet numbers>]}.`;

/** Up to about 6 sentences, or a short list, in JSON: room for it in any of the three languages. */
const ANSWER_TOKENS = 800;
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
        // Her record's leaflet in another language can still pull the answer into it (6 Oct: English question, Malay answer
        // copied from her Malay leaflet): asked once more, insisting, when the answer is not in the question's language.
        if (typeof read?.answer === "string" && languageOf(read.answer) !== input.language) read = await ask(`. Your last answer was not in ${name}: write every word in ${name}, translating anything you take from her record`) ?? read;
        if (read && typeof read.answer === "string" && unnumbered(read.answer).trim()) {
          return {
            answer: unnumbered(read.answer).trim().slice(0, 2000), grounded: read.grounded === true, urgent: read.urgent === true,
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

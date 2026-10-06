import { languageOf } from "@sona-ai/domain/language";
import { readReply } from "@sona-ai/domain/check-ins";
import type { Language } from "@sona-ai/domain/discharge";
import { triageByRules } from "@sona-ai/domain/messages";

import { leafletsText, unnumbered } from "./leaflets";
import type { Models } from "./models";

/**
 * The readers any open chat model can do the same way, whichever host serves it (Workers AI's SEA-LION,
 * Baseten's Gemma): check-in replies, inbox triage and answers from the patient's own record. `chat` asks the
 * model with a system and a user message and returns the JSON in its reply. A failed or unreadable call
 * falls back to the rules, labelled fixture, so a failure is never shown as a model reading. When the model answered
 * but the keyword rule's urgent words set the label, the answer says `decidedBy: "rules"` beside the model's name.
 */
export type Chat = (system: string, user: string) => Promise<Record<string, unknown> | undefined>;

export const LANGUAGE_NAME: Record<Language, string> = { en: "English", ms: "Malay", zh: "Chinese" };

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
const ANSWER = `You are Sona Care, a hospital's assistant for its patients, answering one patient. Answer whatever they ask: their own care, any other health or medicine question, or anything else. For anything about them (their medicines, doses, visits, conditions, allergies, results, what their doctor noted, what they told us), use their record below: it is what the hospital has recorded about them.
Rules:
- Use plain, kind words at a reading age of about 12. At most 3 short sentences. Answer in the language the patient wrote in (Malay, English or Chinese; mixed Malay-English is fine).
- Facts about them (a result, a number, a date, a medicine, a diagnosis) come only from their record, in plain words: never invent one, and never give a new diagnosis or say what a result means for them beyond the record's own words. If they ask for such a fact and their record lacks it, say it is not in their record and suggest asking their care team.
- General health advice is always yours to give, also about their own condition: how to recover, what to eat, what to watch for. When one of the hospital's general leaflets below fits the question, give the advice from it and say it is from the hospital's leaflet. When none fits, give it from general knowledge and say it is general advice. Never answer such a question with only "ask your care team".
- A general leaflet is advice for any patient: never take a fact about this patient (their medicine, dose, date or diagnosis) from a leaflet.
- Set "grounded" to true when your answer uses their record, false when it comes only from a general leaflet or general knowledge.
- Set "cites" to the numbers of the general leaflets your answer used, [] when it used none. Never write a leaflet's number in the answer itself.
- If they say they HAVE an emergency sign now (chest pain, severe breathlessness, confusion, fainting, coughing blood), set "urgent" to true and tell them to call 999 now. A question about which signs to watch for is not urgent: answer it.
Answer with JSON only: {"answer": "<text>", "grounded": true|false, "urgent": true|false, "from": "<which part of the record: medicines, leaflet, warning signs, follow-up, visits, history, allergies, results, note, check-ins or doses; empty if not from the record>", "cites": [<leaflet numbers>]}.`;

const INBOX = `You triage a patient's message to their hospital care team so the most urgent is read first.
The message may be in Malay, English, Chinese or a mix. Judge only what the patient says.
Answer with JSON only: {"label": "urgent" | "clinical" | "admin", "reason": "<3-8 English words: why>"}.
- urgent: a possible emergency (chest pain, breathless, fainting, confusion, coughing blood, severe bleeding).
- clinical: medicines, doses, symptoms, wounds, side effects, or anything a nurse or doctor should answer.
- admin: visits, bookings, bills, letters, medical certificates, insurance.
If unsure, choose the more serious label.`;

export function chatModels(chat: Chat, model: string, fallback: Models): Pick<Models, "classifyReply" | "triageMessage" | "answerFromPlan"> {
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
        const ask = (insist: string) => chat(system, `Patient's question, written in ${name}. Answer in ${name}, whatever language her record or the leaflets are in${insist}: ${input.question}`);
        let read = await ask("");
        // Her record's leaflet in another language can still pull the answer into it (6 Oct: English question, Malay answer
        // copied from her Malay leaflet): asked once more, insisting, when the answer is not in the question's language.
        if (typeof read?.answer === "string" && languageOf(read.answer) !== input.language) read = await ask(`. Your last answer was not in ${name}: write every word in ${name}, translating anything you take from her record`) ?? read;
        if (read && typeof read.answer === "string" && unnumbered(read.answer).trim()) {
          return {
            answer: unnumbered(read.answer).trim().slice(0, 800), grounded: read.grounded === true, urgent: read.urgent === true,
            ...typeof read.from === "string" && read.from.trim() ? { from: read.from.trim().slice(0, 40) } : {},
            ...Array.isArray(read.cites) && { cites: read.cites.filter((n): n is number => typeof n === "number") },
            source: "model", model,
          };
        }
      } catch { /* falls back below */ }
      return fallback.answerFromPlan(input);
    },
  };
}

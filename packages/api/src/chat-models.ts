import { readReply } from "@sona-ai/domain/check-ins";
import type { Language } from "@sona-ai/domain/discharge";
import { triageByRules } from "@sona-ai/domain/messages";

import type { Models } from "./models";

/**
 * The readers any open chat model can do the same way, whichever host serves it (Workers AI's SEA-LION,
 * Baseten's Gemma): check-in replies, inbox triage and answers from the patient's own plan. `chat` asks the
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

const ANSWER = `You are Sona Care, a hospital's assistant for its patients, answering one patient. Answer whatever they ask: their own care, any other health or medicine question, or anything else. For their own medicines, doses and appointments, use their discharge plan below: it is their record.
Rules:
- Use plain, kind words at a reading age of about 12. At most 3 short sentences. Answer in the language the patient wrote in (Malay, English or Chinese; mixed Malay-English is fine).
- Set "grounded" to true when your answer comes from their plan, false when it comes from general knowledge.
- If they describe an emergency sign (chest pain, severe breathlessness, confusion, fainting, coughing blood), set "urgent" to true and tell them to call 999 now.
Answer with JSON only: {"answer": "<text>", "grounded": true|false, "urgent": true|false, "from": "<which part of the plan: medicines, leaflet, warning signs or follow-up; empty if not from the plan>"}.`;

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
        const read = await chat(`${ANSWER}\n\nDischarge plan:\n${input.plan}`, `Patient's question (answer in the same language as the question; if unclear, ${LANGUAGE_NAME[input.language]}): ${input.question}`);
        if (read && typeof read.answer === "string" && read.answer.trim()) {
          return {
            answer: read.answer.trim().slice(0, 800), grounded: read.grounded === true, urgent: read.urgent === true,
            ...typeof read.from === "string" && read.from.trim() ? { from: read.from.trim().slice(0, 40) } : {},
            source: "model", model,
          };
        }
      } catch { /* falls back below */ }
      return fallback.answerFromPlan(input);
    },
  };
}

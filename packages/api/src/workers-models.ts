import { readReply } from "@sona-ai/domain/check-ins";
import type { Language } from "@sona-ai/domain/discharge";

import { stubModels, type Models } from "./models";

/**
 * Sona Care's models on Cloudflare Workers AI, open-weight and called from the Worker: an adapter
 * ready for when model hosting is chosen (not wired into the Worker yet; the stub answers until then,
 * see docs/delivery-plan.md). Speech to text is Whisper large v3 turbo;
 * reading replies and answering from the plan is SEA-LION v4 27B (Gemma-based, Southeast Asian languages). Everything else stays on the stub, and
 * each answer names its model. When Baseten is ready, the Worker passes Baseten's `Models` instead.
 * If a model call fails or returns something unreadable, the answer falls back to the stub's, which
 * says "fixture", so a failure is never shown as a model reading.
 */
export type WorkersAi = { run(model: string, input: Record<string, unknown>): Promise<unknown> };

export const SPEECH_MODEL = "@cf/openai/whisper-large-v3-turbo";
// SEA-LION v4 (AI Singapore, built on Gemma): tuned for Southeast Asian languages, so Malay, Manglish and Chinese replies read well.
export const TEXT_MODEL = "@cf/aisingapore/gemma-sea-lion-v4-27b-it";

const LANGUAGE_NAME: Record<Language, string> = { en: "English", ms: "Malay", zh: "Chinese" };
const WHISPER_LANGUAGE: Record<Language, string> = { en: "en", ms: "ms", zh: "zh" };

/** The model's JSON, from a reply that may wrap it in prose or a code fence. */
export function jsonIn(text: unknown): Record<string, unknown> | undefined {
  const s = typeof text === "string" ? text : typeof text === "object" && text ? JSON.stringify(text) : "";
  const match = s.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try { return JSON.parse(match[0]) as Record<string, unknown>; } catch { return undefined; }
}

/** Base64 without Node's Buffer (chunked, so a long recording does not overflow the call stack). */
function base64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Workers AI answers either { response } or the OpenAI shape { choices: [{ message: { content } }] }.
const responseOf = (out: unknown) => {
  const o = out as { response?: unknown; choices?: { message?: { content?: unknown } }[] } | undefined;
  return o?.response ?? o?.choices?.[0]?.message?.content;
};

async function chat(ai: WorkersAi, system: string, user: string) {
  const out = await ai.run(TEXT_MODEL, {
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0.1, max_tokens: 400,
  });
  return jsonIn(responseOf(out));
}

const TRIAGE = `You read a patient's reply to their hospital's check-in a few days after discharge.
The reply may be in Malay, English, Chinese or a mix of them (Manglish). Judge only what the patient says.
Answer with JSON only: {"label": "fine" | "worse" | "urgent", "symptom": "<2-5 English words naming the main problem, or empty>"}.
- urgent: possible emergency, e.g. chest pain, breathless at rest or when talking, confusion, fainting, coughing blood, blue lips, cannot keep fluids down.
- worse: a symptom came back or is getting worse, or a new problem (e.g. fever back, cough worse, rash, vomiting the medicine, missed doses because of side effects).
- fine: better, or the same with no new concern.
If unsure between two labels, choose the more serious one.`;

const ANSWER = `You are Sona Care, a hospital's after-discharge assistant for one patient. Answer ONLY from the patient's discharge plan below.
Rules:
- Use plain, kind words at a reading age of about 12. At most 3 short sentences. Answer in the language the patient wrote in (Malay, English or Chinese; mixed Malay-English is fine).
- If the plan does not answer the question, do not guess: set "grounded" to false and say briefly that you will pass it to their care team.
- Never diagnose, never change a dose, never tell them to stop a medicine.
- If they describe an emergency sign (chest pain, severe breathlessness, confusion, fainting, coughing blood), set "urgent" to true and tell them to call 999 now.
Answer with JSON only: {"answer": "<text>", "grounded": true|false, "urgent": true|false, "from": "<which part of the plan: medicines, leaflet, warning signs or follow-up; empty if not grounded>"}.`;

export function workersModels(ai: WorkersAi, fallback: Models = stubModels): Models {
  return {
    ...fallback,

    async transcribe({ audio, language }) {
      const out = await ai.run(SPEECH_MODEL, {
        audio: base64(audio),
        ...language ? { language: WHISPER_LANGUAGE[language] } : {},
        vad_filter: true,
        // A hint of the words patients use, so "demam" and "ubat" are not heard as English.
        initial_prompt: "Demam, batuk, sesak nafas, ubat, antibiotik, klinik, doktor. Fever, cough, medicine.",
      }) as { text?: string; transcription_info?: { language?: string } };
      return { text: (out.text ?? "").trim(), language: out.transcription_info?.language, source: "model", model: SPEECH_MODEL };
    },

    async classifyReply(input) {
      try {
        const read = await chat(ai, TRIAGE, `Reply (${LANGUAGE_NAME[input.language]} expected): """${input.text}"""`);
        const label = read?.label;
        if (label === "fine" || label === "worse" || label === "urgent") {
          // Safety floor: the keyword rule's urgent words always win over a milder model reading.
          const final = readReply(input.text) === "urgent" ? "urgent" : label;
          const symptom = typeof read?.symptom === "string" && read.symptom.trim() ? read.symptom.trim().slice(0, 60) : undefined;
          return { label: final, ...symptom ? { symptom } : {}, source: "model", model: TEXT_MODEL };
        }
      } catch { /* the stub below answers, labelled fixture */ }
      return fallback.classifyReply(input);
    },

    async answerFromPlan(input) {
      try {
        const read = await chat(ai, `${ANSWER}\n\nDischarge plan:\n${input.plan}`, `Patient's question (answer in the same language as the question; if unclear, ${LANGUAGE_NAME[input.language]}): ${input.question}`);
        if (read && typeof read.answer === "string" && read.answer.trim()) {
          return {
            answer: read.answer.trim().slice(0, 800), grounded: read.grounded === true, urgent: read.urgent === true,
            ...typeof read.from === "string" && read.from.trim() ? { from: read.from.trim().slice(0, 40) } : {},
            source: "model", model: TEXT_MODEL,
          };
        }
      } catch { /* falls back below */ }
      return fallback.answerFromPlan(input);
    },
  };
}

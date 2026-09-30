import type { Language } from "@sona-ai/domain/discharge";

import { chatModels, jsonIn } from "./chat-models";
import { stubModels, type Models } from "./models";

export { jsonIn };

/**
 * Sona Care's models on Cloudflare Workers AI, open-weight and called from the Worker: a fallback host,
 * not wired in (Baseten serves the models, see ./baseten-models). Speech to text is Whisper large v3 turbo;
 * reading replies and answering from the plan is SEA-LION v4 27B (Gemma-based, Southeast Asian languages).
 * Everything else stays on the stub, and each answer names its model.
 */
export type WorkersAi = { run(model: string, input: Record<string, unknown>): Promise<unknown> };

export const SPEECH_MODEL = "@cf/openai/whisper-large-v3-turbo";
// SEA-LION v4 (AI Singapore, built on Gemma): tuned for Southeast Asian languages, so Malay, Manglish and Chinese replies read well.
export const TEXT_MODEL = "@cf/aisingapore/gemma-sea-lion-v4-27b-it";

const WHISPER_LANGUAGE: Record<Language, string> = { en: "en", ms: "ms", zh: "zh" };

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

export function workersModels(ai: WorkersAi, fallback: Models = stubModels): Models {
  const chat = async (system: string, user: string) => jsonIn(responseOf(await ai.run(TEXT_MODEL, {
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0.1, max_tokens: 400,
  })));
  return {
    ...fallback,
    ...chatModels(chat, TEXT_MODEL, fallback),

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
  };
}

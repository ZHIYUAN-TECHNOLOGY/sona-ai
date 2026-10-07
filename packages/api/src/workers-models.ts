import type { Language } from "@sona-ai/domain/discharge";

import { chatModels, jsonIn } from "./chat-models";
import { stubModels, type Models } from "./models";

export { jsonIn };

/**
 * Sona's models on Cloudflare Workers AI, open-weight and called from the Worker through its AI binding. The
 * library's embedder (EmbeddingGemma, below) is wired in; the rest is a fallback host, not wired in (Baseten
 * serves those models, see ./baseten-models). Speech to text is Whisper large v3 turbo; reading replies and
 * answering from the plan is SEA-LION v4 27B (Gemma-based, Southeast Asian languages). Everything else stays
 * on the stub, and each answer names its model.
 */
export type WorkersAi = { run(model: string, input: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown> };

export const SPEECH_MODEL = "@cf/openai/whisper-large-v3-turbo";
// SEA-LION v4 (AI Singapore, built on Gemma): tuned for Southeast Asian languages, so Malay, Manglish and Chinese replies read well.
export const TEXT_MODEL = "@cf/aisingapore/gemma-sea-lion-v4-27b-it";

const WHISPER_LANGUAGE: Record<Language, string> = { en: "en", ms: "ms", zh: "zh" };

/** Base64 without Node's Buffer (chunked, so a long recording does not overflow the call stack). */
export function base64(bytes: Uint8Array) {
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

/**
 * EmbeddingGemma-300M (Google, 768 dimensions, 100+ languages): the library's embedder, on Workers AI next to the
 * Worker, or on its own always-on box in Malaysia with the other models (SAGEMAKER_ENDPOINTS names it, embed=sona-embed).
 */
export const EMBED_MODEL = "@cf/google/embeddinggemma-300m";
const DIMS = 768;
const EMBED_BATCH = 100; // the most Workers AI takes in one call

/** Same shape as packages/retrieval's Embedder (that package imports this one, so it is not imported back). */
export type Embedder = (texts: string[], as: "query" | "document") => Promise<number[][]>;

// EmbeddingGemma's retrieval prompts (its model card): a question and a passage are embedded differently.
const PROMPT = { query: "task: search result | query: ", document: "title: none | text: " } as const;
// A question waits 3 s at most, then the search runs on keywords alone; a batch of sections being stored waits 15 s.
const EMBED_TIMEOUT_MS = { query: 3000, document: 15_000 } as const;

/**
 * Texts to EmbeddingGemma vectors, 100 a call, over `run`: the prompted texts in, {data: vectors} out (Workers AI's
 * shape, which the SageMaker box keeps, packages/api/src/sagemaker.ts). Throws when the model fails, is slow or answers
 * out of shape, so retrieval can fall back: keywords alone for a search, no vector for a stored section until the next
 * re-index.
 * ponytail: the model reads the first ~2,048 tokens of a text (measured 1 Oct), so a section longer than ~1,500 words
 * is embedded by its start; split long sections into overlapping chunks if recall on long documents suffers.
 */
export function embedderOver(name: string, run: (text: string[], as: "query" | "document", signal: AbortSignal) => Promise<unknown>,
  limits: { batch: number; timeoutMs: Record<"query" | "document", number> } = { batch: EMBED_BATCH, timeoutMs: EMBED_TIMEOUT_MS }): Embedder {
  return async (texts, as) => {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += limits.batch) {
      const batch = texts.slice(i, i + limits.batch);
      const out = await run(batch.map(t => PROMPT[as] + t), as, AbortSignal.timeout(limits.timeoutMs[as])) as { data?: unknown } | undefined;
      const data = out?.data;
      if (!Array.isArray(data) || data.length !== batch.length || !data.every(v => Array.isArray(v) && v.length === DIMS && v.every(Number.isFinite))) {
        throw new Error(`${name} answered out of shape`);
      }
      vectors.push(...data as number[][]);
    }
    return vectors;
  };
}

/** The embedder on Workers AI, next to the Worker. */
export function workersEmbedder(ai: WorkersAi): Embedder {
  return embedderOver(EMBED_MODEL, (text, _as, signal) => ai.run(EMBED_MODEL, { text }, { signal }));
}

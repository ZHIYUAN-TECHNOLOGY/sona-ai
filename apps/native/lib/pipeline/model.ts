import {
  PARAPHRASE_MULTILINGUAL_MINILM_L12_V2_QUANTIZED,
  QWEN2_5_1_5B_QUANTIZED,
} from "react-native-executorch";

// Single source of truth for the on-device note model. The rest of the pipeline
// is model-agnostic — it only depends on the `LlmLike.generate(messages)` shape
// (see noteGen.ts). To switch models, change these two lines only:
//   - NOTE_MODEL: the executorch model source passed to useLLM.
//   - NOTE_MODEL_NAME: the human label shown in the note screen / audit / settings.
//
// Qwen2.5-1.5B-Instruct (quantized, ~1.1GB, Apache-2.0) — the PRODUCTION note model. executorch
// ships it ready as a .pte, so it's a drop-in over the smaller Qwen3-0.6B: markedly better SOAP
// extraction + instruction-following for the transcript→SOAP task, on a model a clinician signs.
// Trade up to QWEN2_5_3B_QUANTIZED (premium/tablet) or down to QWEN2_5_0_5B_QUANTIZED (low-end)
// here — one-line change, no other code. (The Malaysian Whisper STT already handles the
// Malaysian speech; the note LLM works on de-identified clinical text.)
// generationConfig: repetitionPenalty is the fix for degenerate loops ("He is not on any
// current medical treatment." ×30) a small model falls into on thin transcripts; low
// temperature keeps clinical notes factual rather than creative.
export const NOTE_MODEL = {
  ...QWEN2_5_1_5B_QUANTIZED,
  generationConfig: { temperature: 0.3, topP: 0.9, repetitionPenalty: 1.15 },
};
export const NOTE_MODEL_NAME = "Qwen2.5-1.5B";

// On-device text-embedding model for semantic search / RAG (the Knowledge tab and,
// later, note search). Multilingual on purpose: a quantized paraphrase MiniLM that
// embeds Malay and English in the same space, so a "sakit dada" query matches an
// English "chest pain" guideline. Runs via useTextEmbeddings().forward(text) →
// Float32Array — on-device, so the query never leaves the phone. Downloaded on first
// use; retrieval falls back to the lexical ranker until it's ready.
export const EMBED_MODEL = PARAPHRASE_MULTILINGUAL_MINILM_L12_V2_QUANTIZED;
export const EMBED_MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2";

// Speech-to-text now lives entirely in ./whisperStt (whisper.cpp via whisper.rn) — the
// Malaysian Whisper ggml, bundled + offline. This module keeps only the ExecuTorch models
// (note LLM + embeddings). See lib/pipeline/whisperStt.ts for the STT model tiers.

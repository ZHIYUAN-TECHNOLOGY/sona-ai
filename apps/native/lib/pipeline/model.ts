import {
  PARAPHRASE_MULTILINGUAL_MINILM_L12_V2_QUANTIZED,
  QWEN3_4B_QUANTIZED,
} from "react-native-executorch";

// Single source of truth for the on-device note model. The rest of the pipeline
// is model-agnostic — it only depends on the `LlmLike.generate(messages)` shape
// (see noteGen.ts). To switch models, change these two lines only:
//   - NOTE_MODEL: the executorch model source passed to useLLM.
//   - NOTE_MODEL_NAME: the human label shown in the note screen / audit / settings.
//
// Qwen3-4B (quantized, ~2.5GB, Apache-2.0) — the PREMIER note model executorch ships,
// used across every text feature (consult SOAP note, document summaries, knowledge RAG).
// The 1.5B/1.7B tiers under-extracted from noisy scanned text ("Not stated." for
// sections the document clearly covered, Jul 2026); 4B is the accuracy tier a clinician
// signs. RAM discipline: whisper is UNLOADED before this model loads (PipelineProvider /
// docSummary) — 4B + resident whisper-turbo would pressure 6GB iPhones. Qwen3 emits
// <think> blocks; every consumer runs stripThink, and prompts append /no_think.
// Trade down to QWEN3_1_7B_QUANTIZED (~1.2GB, low-end devices) here — one-line change.
// Sampling (temperature / repetitionPenalty) is applied at RUNTIME via llm.configure() in
// PipelineProvider — executorch ignores a generationConfig field on the model object.
export const NOTE_MODEL = QWEN3_4B_QUANTIZED;
export const NOTE_MODEL_NAME = "Qwen3-4B";

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

import {
  PARAPHRASE_MULTILINGUAL_MINILM_L12_V2_QUANTIZED,
  QWEN3_1_7B_QUANTIZED,
} from "react-native-executorch";

// Single source of truth for the on-device note model. The rest of the pipeline
// is model-agnostic — it only depends on the `LlmLike.generate(messages)` shape
// (see noteGen.ts). To switch models, change these two lines only:
//   - NOTE_MODEL: the executorch model source passed to useLLM.
//   - NOTE_MODEL_NAME: the human label shown in the note screen / audit / settings.
//
// Qwen3-1.7B (quantized, ~1.3GB, Apache-2.0) — the PRODUCTION note model. A model
// generation newer than Qwen2.5-1.5B at nearly the same footprint, with markedly better
// instruction-following — the doc-summary/format failures (ignored '## ' sections,
// rambling invention) that pushed the 2.5-1.5B out (Jul 2026). Qwen3 emits <think>
// blocks; every consumer already runs stripThink, and prompts append /no_think to skip
// thinking at generation time. Trade up to QWEN3_4B_QUANTIZED (premium/tablet, ~2.6GB)
// or down to QWEN3_0_6B_QUANTIZED (low-end) here — one-line change, no other code.
// Sampling (temperature / repetitionPenalty) is applied at RUNTIME via llm.configure() in
// PipelineProvider — executorch ignores a generationConfig field on the model object.
export const NOTE_MODEL = QWEN3_1_7B_QUANTIZED;
export const NOTE_MODEL_NAME = "Qwen3-1.7B";

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

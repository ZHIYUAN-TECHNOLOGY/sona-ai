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
// Qwen3-1.7B (quantized, ~1.2GB, Apache-2.0) — the note model for every text feature
// (consult SOAP note, document summaries, knowledge RAG), and the MEASURED winner for
// this codebase's tasks:
// - Qwen3-4B (~2.5GB): jetsammed at load on the 6GB dev iPhone — any 4B-class model
//   (incl. MedGemma-4B) crosses iOS's per-app memory ceiling on this device class.
// - MedPsy-1.7B (medical fine-tune of this exact model; we exported it to .pte and ran
//   it on-device + on-Mac, Jul 2026): an RL-trained THINKING model — it reasons in
//   plain prose (no <think> tags, stripThink can't help), never reaches the required
//   format, and on garbled scans it SPECULATES about drug identities ("possibly
//   codeine?"), which the note contract forbids. Great at clinical Q&A, wrong tool for
//   strict-format extraction. Export + trial harness: scratchpad/medpsy-export.
// Model swaps happen here in one line — but only after a Mac-side trial on the real
// prompts (see medpsy-export/trial.py for the harness pattern).
// Qwen3 emits <think> blocks; every consumer runs stripThink, and prompts append
// /no_think. RAM discipline stays: whisper is UNLOADED before this model loads.
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

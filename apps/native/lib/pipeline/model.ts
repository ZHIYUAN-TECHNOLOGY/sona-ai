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
// Qwen3-4B (8da4w quantized, ~2.5GB, Apache-2.0) — the note model for every text
// feature (consult SOAP note, document summaries, knowledge RAG). MEASURED upgrade
// (note-eval harness, 6 gold cases, temp 0.15, Jul 14 2026):
// - Qwen3-4B:    90.9% recall, 0 inventions, 6/6 format
// - Qwen3-1.7B:  89.1% recall, 2 inventions (invented names on a garbled scan) — the
//   invention risk is why the 4B wins even at similar recall.
// - Qwen3-4B-Instruct-2507: 92.8% — best, but needs our own export + hosting (no
//   bundled .pte); revisit if we get HF hosting. Qwen3.5-4B: better still on paper,
//   BLOCKED — executorch qwen3_5 export is fp32-only (DeltaNet), no quantization yet.
// Device fit: needs the 12GB-class iPhone (17 Pro Max dev device). The old "4B
// jetsam" note came from an undiagnosed crash during download — retest before
// shipping to 6GB devices; 1.7B remains the fallback for that RAM class.
// - MedPsy-1.7B (medical fine-tune; exported + trialed Jul 2026): RL-trained THINKING
//   model — reasons in plain prose (no <think> tags), never reaches the required
//   format, speculates about drug identities on garbled scans. Rejected.
// Model swaps happen here in one line — but only after a Mac-side trial on the real
// prompts (harness: scratchpad note-eval/runner.py; MedPsy pattern: medpsy-export/trial.py).
// Qwen3 emits <think> blocks; every consumer runs stripThink, and prompts append
// /no_think. RAM discipline stays: whisper is UNLOADED before this model loads.
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

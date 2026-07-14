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
// (consult SOAP note, document summaries, knowledge RAG). Device-proven for weeks.
//
// Qwen3-4B tried and REVERTED (Jul 14 2026) — the full arc, so nobody repeats it:
// - Mac bf16 trial (note-eval harness): 4B 90.9% recall / 0 inventions beat 1.7B's
//   89.1% / 2 inventions → swapped.
// - On-device (bundled 8da4w .pte): jetsam-killed at load until BOTH the awaited
//   whisper unload AND the increased-memory-limit entitlement landed; then the
//   QUANTIZED output degraded catastrophically vs the Mac trial — pervasive missing
//   spaces ("ReviewinoneweekorFBCifnotimproving"), mangled doses ("Parectemol1g
//   every6hours×4times"), and an INVENTED lethal vital ("Temperature48.2°C").
//   Screenshot #147. Still crashed intermittently in real flows.
// - LESSON: a Mac bf16 trial is NECESSARY but NOT SUFFICIENT — the device's
//   quantized runtime must pass the same eval before a swap ships. No device-side
//   harness exists yet; until one does, treat bundled-quantized models as untrialed.
// - Qwen3-4B-Instruct-2507: 92.8% on Mac, needs own export + hosting. Qwen3.5-4B:
//   best on paper, BLOCKED (executorch DeltaNet export is fp32-only).
// - MedPsy-1.7B (medical fine-tune; exported + trialed Jul 2026): RL-trained THINKING
//   model — reasons in plain prose (no <think> tags), never reaches the required
//   format, speculates about drug identities on garbled scans. Rejected.
// Model swaps happen here in one line — but only after a Mac-side trial on the real
// prompts (harness: scratchpad note-eval/runner.py; MedPsy pattern: medpsy-export/trial.py).
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

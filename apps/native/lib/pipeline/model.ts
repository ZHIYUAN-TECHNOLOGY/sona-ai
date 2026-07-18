import {
  PARAPHRASE_MULTILINGUAL_MINILM_L12_V2_QUANTIZED,
  QWEN3_1_7B_QUANTIZED,
  QWEN3_5_2B_QUANTIZED,
} from "react-native-executorch";

// Qwen3-4B-Instruct-2507 — OUR OWN ExecuTorch export (official qwen3 recipe,
// 8da4w XNNPACK; scratchpad q4b-export, Jul 15 2026). DEV-TEST SERVING: from the
// dev Mac over LAN — phone and Mac must share wifi for the one-time download;
// after that the model is cached on-device. User-directed production pick
// (Jul 15 pm). Mac harness on the rich prompt: 90.8% recall / 1 invention
// ("fever", thin case) / 6-of-6 format vs Qwen3-1.7B's 90.7% / 0 / 6-of-6 —
// device-quantized behaviour is the open risk (classic Qwen3-4B degraded badly
// after 8da4w). QWEN3_1_7B_QUANTIZED stays the one-line revert.
const QWEN3_4B_2507_LAN = {
  // Custom exports aren't in the library's LLMModelName union — the cast is the
  // supported escape hatch (name is only telemetry + reload key).
  modelName: "qwen3-4b-instruct-2507-8da4w",
  modelSource: "http://192.168.0.139:8765/q4b2507_8da4w.pte",
  tokenizerSource: "http://192.168.0.139:8765/tokenizer.json",
  tokenizerConfigSource: "http://192.168.0.139:8765/tokenizer_config.json",
} as unknown as typeof QWEN3_1_7B_QUANTIZED;

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
// Qwen3-1.7B — the production model, RESTORED (Jul 15 2026 pm) after the
// user-insisted Qwen3.5-2B override failed on device a FOURTH time (wordy
// hallucinated ramble, meta-commentary, inline "## Summary", invented referral/
// imaging — user then asked for a complete fix; systematic diagnosis confirmed
// the model IS the root cause, not the pipeline). Qwen3.5-2B's full record:
// - Mac harness (old env): 51% recall, invented amoxicillin for a
//   penicillin-allergic case (docs/model-roadmap.md).
// - On-device (Jul 15 am, screenshot #149): hallucinated timelines, invented
//   findings, no SOAP structure, rambled to token cap → reverted same hour.
// - Mac harness RE-TRIAL (Jul 15 pm, transformers 5.13.1,
//   tools/note-eval/out_q35_2b_retrial.json): 36.7% recall, invented
//   "antibiotic" + "steroid", format 3/6 — vs Qwen3-1.7B's 93.5% / 0 / 6/6.
// - On-device again (Jul 15 pm): same ramble class. DO NOT RETRY Qwen3.5-2B.
// Qwen3-1.7B: 93.5% recall / 0 inventions / 6-of-6 format on the harness,
// weeks device-proven, clean 4-section notes in ~15s. Kept loaded-constant as
// the ONE-LINE REVERT for the 4B trial below.
//
// Qwen3.5-2B — THIRD user-directed swap to this model (Jul 15 night), confirmed
// via explicit prompt with the full failure record restated. The record stands
// unchanged (do-not-retry was AND REMAINS the engineering position):
// 4 failures Jul 15 alone — Mac 51%, Mac re-trial 36.7% (invented antibiotic/
// steroid), device am (screenshot #149), device pm (user's own screenshots:
// hallucinated referrals/imaging, token-cap rambles, no SOAP structure).
// User confirmed understanding that output will return. Post-processing
// (SOAP salvage, mid-line heading repair) softens the FORMAT damage only.
// Reverts one line away: QWEN3_1_7B_QUANTIZED / "Qwen3-1.7B" (bundled) or
// QWEN3_4B_2507_LAN / "Qwen3-4B-Instruct-2507" (LAN).
export const NOTE_MODEL = QWEN3_5_2B_QUANTIZED;
void QWEN3_1_7B_QUANTIZED;
void QWEN3_4B_2507_LAN;

// NOTE ENGINE — which runtime drafts notes/doc summaries:
//   "llamarn"    → Bonsai-8B GGUF via llama.rn (lib/pipeline/llamaLlm.ts).
//                  Mac harness Jul 17: 92.5% recall / 0 inventions / 6-of-6 on
//                  the rich prompt — best candidate ever. DEVICE eval pending;
//                  4.8GB one-time LAN download; 12GB-device tier only.
//   "executorch" → the executorch NOTE_MODEL above (one-line revert path).
export type NoteEngine = "llamarn" | "executorch";
export const NOTE_ENGINE: NoteEngine = "llamarn";
export const NOTE_MODEL_NAME = NOTE_ENGINE === "llamarn" ? "Bonsai-8B" : "Qwen3.5-2B";

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

import { PARAPHRASE_MULTILINGUAL_MINILM_L12_V2_QUANTIZED } from "react-native-executorch";

// Single source of truth for the on-device note model. The rest of the pipeline
// is model-agnostic — it only depends on the `LlmLike.generate(messages)` shape
// (see noteGen.ts). To switch models, change these two lines only:
//   - NOTE_MODEL: the executorch model source passed to useLLM.
//   - NOTE_MODEL_NAME: the human label shown in the note screen / audit / settings.
//
// MedPsy-1.7B (QVAC/Tether, Apache-2.0) — a MEDICAL fine-tune of Qwen3-1.7B, and the
// note model for every text feature (consult SOAP note, document summaries, knowledge
// RAG). Beats MedGemma-4B by +11 avg across 7 medical benchmarks at less than half the
// size — medical-domain quality at the exact RAM footprint this device class proved it
// can hold (Qwen3-4B jetsammed at load on the 6GB dev iPhone, Jul 2026; any 4B-class
// model incl. MedGemma-4B hits the same iOS per-app memory ceiling).
//
// The .pte is OUR export (scratchpad medpsy-export: optimum-executorch, executorch 1.1,
// XNNPACK 8da4w linear + 8w embedding, max_seq_len 4096 — the same recipe as the stock
// qwen3-1.7b-quantized binary this replaced). Tokenizer files come straight from the
// upstream HF repo. modelName stays "qwen3-1.7b-quantized": it is that architecture —
// the field only drives telemetry + hook reload identity.
//
// DEV HOSTING: the .pte is served from the dev Mac over LAN (python -m http.server 8090
// in scratchpad/medpsy-export/out). Before release, upload it to a HuggingFace repo and
// point MEDPSY_PTE_URL there — nothing else changes.
//
// Same arch → same machinery: stripThink on every consumer, /no_think in prompts
// (MedPsy's chat template disables thinking by default anyway), whisper unloaded before
// load (PipelineProvider / docSummary). Fallback: swap back to QWEN3_1_7B_QUANTIZED.
// Sampling (temperature / repetitionPenalty) is applied at RUNTIME via llm.configure() in
// PipelineProvider — executorch ignores a generationConfig field on the model object.
const MEDPSY_PTE_URL = "http://192.168.0.139:8090/medpsy-1.7b-8da4w.pte";
const MEDPSY_HF = "https://huggingface.co/qvac/MedPsy-1.7B/resolve/main";

export const NOTE_MODEL = {
  modelName: "qwen3-1.7b-quantized",
  modelSource: MEDPSY_PTE_URL,
  tokenizerSource: `${MEDPSY_HF}/tokenizer.json`,
  tokenizerConfigSource: `${MEDPSY_HF}/tokenizer_config.json`,
} as const;
export const NOTE_MODEL_NAME = "MedPsy-1.7B";

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

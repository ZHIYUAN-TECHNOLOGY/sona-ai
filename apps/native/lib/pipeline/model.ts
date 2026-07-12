import {
  PARAPHRASE_MULTILINGUAL_MINILM_L12_V2_QUANTIZED,
  QWEN3_0_6B_QUANTIZED,
} from "react-native-executorch";

// Single source of truth for the on-device note model. The rest of the pipeline
// is model-agnostic — it only depends on the `LlmLike.generate(messages)` shape
// (see noteGen.ts). To switch models, change these two lines only:
//   - NOTE_MODEL: the executorch model source passed to useLLM.
//   - NOTE_MODEL_NAME: the human label shown in the note screen / audit / settings.
//
// Qwen3-0.6B (quantized) — chosen for FAST on-device load + generation: ~3× smaller
// than the 1.7B (smaller first-run download, quicker warm-up, snappier drafting), while
// staying a capable Qwen3 instruction model for the constrained transcript→SOAP task
// (further grounded by on-device RAG). Trade up to QWEN3_5_0_8B_QUANTIZED or
// QWEN3_1_7B_QUANTIZED here if note quality needs it — one-line change, no other code.
export const NOTE_MODEL = QWEN3_0_6B_QUANTIZED;
export const NOTE_MODEL_NAME = "Qwen3-0.6B";

// On-device text-embedding model for semantic search / RAG (the Knowledge tab and,
// later, note search). Multilingual on purpose: a quantized paraphrase MiniLM that
// embeds Malay and English in the same space, so a "sakit dada" query matches an
// English "chest pain" guideline. Runs via useTextEmbeddings().forward(text) →
// Float32Array — on-device, so the query never leaves the phone. Downloaded on first
// use; retrieval falls back to the lexical ranker until it's ready.
export const EMBED_MODEL = PARAPHRASE_MULTILINGUAL_MINILM_L12_V2_QUANTIZED;
export const EMBED_MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2";

// On-device speech-to-text (Whisper). Multilingual — the consult is code-switched BM + EN,
// and whisper-base handles both ('ms' + 'en'). We pin the XNNPACK build explicitly: the
// exported WHISPER_BASE constant points iOS at a CoreML .pte that 404s on Hugging Face for
// v0.9.0 (verified), whereas the XNNPACK .pte exists on both platforms. Runs via
// SpeechToTextModule.transcribe (verbose → per-segment timestamps) — audio in, text out,
// on-device. Swap whisper-base → whisper-tiny (faster) / whisper-small (more accurate).
export const STT_MODEL = {
  modelName: "whisper-base" as const,
  isMultilingual: true,
  modelSource:
    "https://huggingface.co/software-mansion/react-native-executorch-whisper-base/resolve/v0.9.0/xnnpack/whisper_base_xnnpack_fp32.pte",
  tokenizerSource:
    "https://huggingface.co/software-mansion/react-native-executorch-whisper-base/resolve/v0.9.0/tokenizer.json",
};
export const STT_MODEL_NAME = "Whisper-base";

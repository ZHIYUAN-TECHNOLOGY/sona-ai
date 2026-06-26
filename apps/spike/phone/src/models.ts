// Model registry for the Sona on-device spike (Phase 1 / phone).
//
// LLM  : Malaysian-Qwen2.5 (GGUF, q4_k_m) — the real feasibility risk.
//        Spike uses a generic Qwen2.5 GGUF for the SPEED number (≈ same as the
//        Malaysian fine-tune at equal size/quant). Swap the URL to the mesolitica
//        Malaysian-Qwen2.5 GGUF to also judge QUALITY (convert via llama.cpp
//        `convert_hf_to_gguf.py` + `llama-quantize` if mesolitica ships no GGUF).
// STT  : multilingual Whisper via RunAnywhere (sherpa-onnx). Default below is a
//        placeholder — point it at a MULTILINGUAL sherpa-onnx whisper build (or a
//        sherpa-onnx export of Malaysian-Whisper) to test rojak. English-only
//        whisper-tiny.en gives a timing-only smoke test.
// PII  : OpenMed runs as a plain ONNX token-classifier — measured in a separate
//        step (small + fast, low risk); not wired into this RunAnywhere harness.

import { ModelCategory } from "@runanywhere/core";
import { LlamaCPP } from "@runanywhere/llamacpp";
import { ONNX, ModelArtifactType } from "@runanywhere/onnx";

// Toggle which LLM size to bench.
export const LLM_SIZE: "1.5b" | "7b" = "1.5b";

const LLM = {
  "1.5b": {
    id: "qwen2.5-1.5b-q4",
    name: "Qwen2.5-1.5B-Instruct (q4_k_m)  [swap → Malaysian-Qwen2.5-1.5B]",
    url: "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf",
    memoryRequirement: 1_300_000_000,
  },
  "7b": {
    id: "qwen2.5-7b-q4",
    name: "Qwen2.5-7B-Instruct (q4_k_m)  [swap → Malaysian-Qwen2.5-7B]",
    url: "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
    memoryRequirement: 5_200_000_000,
  },
} as const;

export const MODEL_IDS = {
  llm: LLM[LLM_SIZE].id,
  // Default RunAnywhere whisper (English smoke test). Replace with a multilingual build for rojak.
  stt: "sherpa-onnx-whisper-tiny.en",
};

export async function registerModels() {
  const llm = LLM[LLM_SIZE];
  await LlamaCPP.addModel({
    id: llm.id,
    name: llm.name,
    url: llm.url,
    memoryRequirement: llm.memoryRequirement,
  });

  await ONNX.addModel({
    id: MODEL_IDS.stt,
    name: "Whisper (STT) — swap to multilingual for rojak",
    url: "https://github.com/RunanywhereAI/sherpa-onnx/releases/download/runanywhere-models-v1/sherpa-onnx-whisper-tiny.en.tar.gz",
    modality: ModelCategory.SpeechRecognition,
    artifactType: ModelArtifactType.TarGzArchive,
    memoryRequirement: 75_000_000,
  });
}

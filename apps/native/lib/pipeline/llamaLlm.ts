import { Directory, File, Paths } from "expo-file-system";
import { initLlama, type LlamaContext } from "llama.rn";

import type { LlmLike, Msg } from "./noteGen";

// Note LLM via llama.rn (llama.cpp / GGUF) — the production path that replaces the ExecuTorch
// Qwen3-0.6B. Same ggml runtime family as the Malaysian Whisper (one stack). Default model =
// official Qwen2.5-1.5B-Instruct (Apache-2.0, instruct-tuned for terse SOAP, ~3× the 0.6B),
// downloaded once from Hugging Face — no hosting needed. Swap MODEL.url to a Mesolitica
// Malaysian-Qwen GGUF for native Manglish note text. Runs on Metal (n_gpu_layers).
//
// Satisfies the same LlmLike seam as the ExecuTorch note model, so noteGen/cleanup swap engines
// with a flag (see sttMode: getNoteEngine). MOAT: fully on-device; only de-identified text is
// ever fed to it.

export interface LlamaModel {
  file: string; // stable local filename / cache key
  url: string; // GGUF download source
}

// Official Qwen2.5-1.5B-Instruct GGUF (Apache-2.0). Public HF resolve URL — downloads directly.
export const NOTE_LLAMA_MODEL: LlamaModel = {
  file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
  url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
};

export function noteLlamaModelName(): string {
  return "Qwen2.5-1.5B-Instruct (llama.cpp)";
}

let ctxPromise: Promise<LlamaContext> | null = null;

/** Download the GGUF to app storage if absent; return its local path. */
async function ensureModel(model: LlamaModel, onProgress?: (p: number) => void): Promise<string> {
  const file = new File(Paths.document, model.file);
  if (file.exists) return file.uri;
  const downloaded = await File.downloadFileAsync(model.url, new Directory(Paths.document));
  if (downloaded.uri !== file.uri) {
    try {
      downloaded.move(file);
    } catch {
      onProgress?.(1);
      return downloaded.uri;
    }
  }
  onProgress?.(1);
  return file.uri;
}

async function getCtx(onProgress?: (p: number) => void): Promise<LlamaContext> {
  if (!ctxPromise) {
    ctxPromise = (async () => {
      const path = await ensureModel(NOTE_LLAMA_MODEL, onProgress);
      // n_gpu_layers 99 → offload all layers to Metal. n_ctx sized for a consult transcript.
      return initLlama({ model: path, n_ctx: 4096, n_gpu_layers: 99 }, onProgress);
    })().catch((e) => {
      ctxPromise = null;
      throw e;
    });
  }
  return ctxPromise;
}

async function llamaGenerate(messages: Msg[]): Promise<string> {
  const ctx = await getCtx();
  const res = await ctx.completion({
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    jinja: true, // apply the model's chat template
    n_predict: 1024,
    temperature: 0.3,
    stop: ["<|im_end|>", "<|endoftext|>"],
  });
  return (res.text ?? "").trim();
}

/** The note LLM as an LlmLike (same seam as the ExecuTorch model). */
export const LLAMA_LLM: LlmLike = { generate: llamaGenerate };

/** Pre-download + load the GGUF (Settings pre-warm), reporting progress. */
export async function prewarmLlama(onProgress?: (p: number) => void): Promise<void> {
  await getCtx(onProgress);
  onProgress?.(1);
}

/** Release the llama.cpp context + free native memory. */
export async function unloadLlama(): Promise<void> {
  const p = ctxPromise;
  ctxPromise = null;
  if (!p) return;
  try {
    const ctx = await p;
    await ctx.release();
  } catch {
    // load already failed — nothing to release
  }
}

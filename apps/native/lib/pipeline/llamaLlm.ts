import { Directory, File, Paths } from "expo-file-system";
import { initLlama, type LlamaContext } from "llama.rn";

import type { LlmLike, Msg } from "./noteGen";

// llama.rn note engine — runs GGUF models (Bonsai) that react-native-executorch
// cannot. Same discipline as whisperStt: ONE resident context, model file
// downloaded once to app storage (DEV: served from the dev Mac over LAN),
// loaded on demand, unloadable so whisper/executorch never fight it for RAM.
//
// Bonsai-8B (bartowski unpacked Q4_K_M, 4.8GB): Mac harness 92.5% recall /
// 0 inventions / 6-of-6 format on the rich prompt — the best any candidate has
// scored (Jul 17 2026). Device-quantized behaviour still gates the swap.

export interface GgufModel {
  file: string; // stable local filename
  url: string; // one-time download source
}

export const BONSAI_8B: GgufModel = {
  file: "bonsai-8b-q4km.gguf",
  // Public HF mirror (bartowski unpacked Q4_K_M, 5.2GB) — TestFlight phones download once, wifi only.
  url: "https://huggingface.co/bartowski/prism-ml_Bonsai-8B-unpacked-GGUF/resolve/main/prism-ml_Bonsai-8B-unpacked-Q4_K_M.gguf",
};

let ctx: LlamaContext | null = null;
let ctxFile: string | null = null;
let loading: Promise<LlamaContext> | null = null;

/** True when the model file is already on device (no download needed). */
export function llamaModelReady(model: GgufModel): boolean {
  try {
    return new File(Paths.document, model.file).exists;
  } catch {
    return false;
  }
}

async function ensureFile(model: GgufModel, onProgress?: (p: number) => void): Promise<string> {
  const file = new File(Paths.document, model.file);
  if (file.exists) return file.uri;
  const downloaded = await File.downloadFileAsync(model.url, new Directory(Paths.document), {});
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

/** Load (download + init) the llama.rn context. Idempotent per model file. */
export async function loadLlama(
  model: GgufModel,
  onProgress?: (p: number) => void,
): Promise<LlamaContext> {
  if (ctx && ctxFile === model.file) return ctx;
  if (loading) return loading;
  loading = (async () => {
    if (ctx && ctxFile !== model.file) await unloadLlama();
    const path = await ensureFile(model, onProgress);
    const c = await initLlama({
      model: path.startsWith("file://") ? path.slice(7) : path,
      n_ctx: 4096,
      n_gpu_layers: 99, // Metal
      ctx_shift: false,
    });
    ctx = c;
    ctxFile = model.file;
    return c;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

/** Free the context (RAM discipline — call before whisper/executorch loads). */
export async function unloadLlama(): Promise<void> {
  const c = ctx;
  ctx = null;
  ctxFile = null;
  try {
    await c?.release();
  } catch {
    // already gone
  }
}

/**
 * LlmLike over llama.rn — the same generate(messages) contract the whole note
 * pipeline consumes (noteGen, docSummary). `onToken` streams ACCUMULATED text
 * for the live-draft preview. Sampling mirrors the app's executorch config.
 */
export function makeLlamaLlm(
  model: GgufModel,
  onToken?: (accumulated: string) => void,
  onProgress?: (p: number) => void,
): LlmLike {
  return {
    generate: async (messages: Msg[]) => {
      const c = await loadLlama(model, onProgress);
      let acc = "";
      const res = await c.completion(
        {
          messages,
          jinja: true,
          temperature: 0.15,
          top_p: 0.9,
          penalty_repeat: 1.3,
          n_predict: 512,
        },
        onToken
          ? (d: { token: string }) => {
              acc += d.token;
              onToken(acc);
            }
          : undefined,
      );
      return res.text;
    },
  };
}

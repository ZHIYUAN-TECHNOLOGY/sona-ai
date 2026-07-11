import { ExecutorchModule, isAvailable, ScalarType, type TensorPtr } from "react-native-executorch";

import type { SpeakerEmbedder } from "./embedder";
import { logMelFbank } from "./features";
import type { Voiceprint } from "./types";

// REAL on-device speaker embedder — runs a neural speaker model (ECAPA-TDNN / CAM++ /
// x-vector) exported to an ExecuTorch `.pte`, via the generic ExecutorchModule. This is
// the drop-in that makes diarization production-real: clustering, role assignment,
// enrollment, and the moat are all unchanged; only this replaces the mock band-energy
// embedder. ExecuTorch is already linked in the app (LLM, STT, text embeddings), so no new
// native module is added.
//
// On-device: the model runs locally; audio and voiceprints never leave the phone.
//
// The top-level `react-native-executorch` import is safe: ExecuTorch is a CORE app
// dependency (LLM, STT, text embeddings) imported unconditionally in app/_layout.tsx, so it
// is always linked — unlike the optional native libs that failed to register. What's
// optional here is the speaker MODEL FILE: with none configured (SPEAKER_MODEL = null),
// initSpeakerModel never constructs this embedder and diarization stays on the mock.

export interface ExecutorchEmbedderConfig {
  /** Embedder id (stored with the enrolled voiceprint as a cache key). */
  id?: string;
  /** Output voiceprint dimensionality (e.g. 192 for ECAPA-TDNN). */
  dim: number;
  /** The `.pte` model: a bundled `require(...)`, a file path, or an HTTPS URL. */
  modelSource: string | number;
  /** What the exported graph expects as input. Match your `.pte`. */
  inputKind?: "waveform" | "fbank";
  sampleRate?: number;
  /** Mel-band count when `inputKind === "fbank"`. */
  numMel?: number;
  /** Progress callback for the initial model download. */
  onDownloadProgress?: (p: number) => void;
}

function l2normalize(v: Float32Array): Voiceprint {
  let sq = 0;
  for (let i = 0; i < v.length; i++) sq += v[i] * v[i];
  const n = Math.sqrt(sq);
  const out = new Float32Array(v.length);
  if (n > 0) for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/**
 * Load a speaker `.pte` and return a real SpeakerEmbedder. Rejects if ExecuTorch isn't
 * available on this device or the model fails to load — the caller (model.ts) catches that
 * and keeps the mock embedder, so the app never crashes on a build without the model.
 */
export async function createExecutorchSpeakerEmbedder(
  cfg: ExecutorchEmbedderConfig,
): Promise<SpeakerEmbedder> {
  if (!isAvailable) throw new Error("ExecuTorch native runtime unavailable on this device");
  const sampleRate = cfg.sampleRate ?? 16000;
  const inputKind = cfg.inputKind ?? "waveform";
  const numMel = cfg.numMel ?? 80;

  const model = new ExecutorchModule();
  await model.load(cfg.modelSource, cfg.onDownloadProgress);

  return {
    id: cfg.id ?? "executorch-speaker",
    dim: cfg.dim,
    async embed(pcm: Float32Array): Promise<Voiceprint> {
      let input: TensorPtr;
      if (inputKind === "fbank") {
        const fb = logMelFbank(pcm, { sampleRate, numMel });
        // [batch, frames, mel]; transpose in your export if the model wants [batch, mel, frames].
        input = { dataPtr: fb.data, sizes: [1, fb.frames, numMel], scalarType: ScalarType.FLOAT };
      } else {
        input = { dataPtr: pcm, sizes: [1, pcm.length], scalarType: ScalarType.FLOAT };
      }
      const out = await model.forward([input]);
      const raw = out[0]?.dataPtr as ArrayLike<number> | undefined;
      // Guard a non-array/empty output (e.g. a wrong-shape export) instead of letting
      // Float32Array.from throw obscurely — a clear error surfaces the model mismatch.
      if (!raw || typeof raw.length !== "number" || raw.length === 0) {
        throw new Error("speaker model returned an unexpected or empty embedding tensor");
      }
      return l2normalize(raw instanceof Float32Array ? raw : Float32Array.from(raw));
    },
  };
}

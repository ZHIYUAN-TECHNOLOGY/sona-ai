import { activeSpeakerEmbedderId, registerSpeakerEmbedder } from "./embedder";
import { createExecutorchSpeakerEmbedder, type ExecutorchEmbedderConfig } from "./executorchEmbedder";

// Speaker-model configuration + one-time init. Point SPEAKER_MODEL at your exported speaker
// `.pte` to make diarization fully real; leave it null to run on the mock band-energy
// embedder (app still works). initSpeakerModel() is called once at app start — on success
// it swaps the active embedder to the real ExecuTorch model; on any failure it keeps the
// mock, so a build without the model never crashes. See REAL_MODEL.md for how to export a
// model and fill this in.

export const SPEAKER_MODEL: ExecutorchEmbedderConfig | null = null;
// Example — host or bundle an ECAPA-TDNN and uncomment:
// export const SPEAKER_MODEL: ExecutorchEmbedderConfig = {
//   id: "ecapa-tdnn-192",
//   dim: 192,
//   inputKind: "fbank",
//   numMel: 80,
//   threshold: 0.5, // ECAPA cosine scale — NOT 0.9; tune to your model or it over-splits
//   modelSource: "https://your-host/ecapa_tdnn_xnnpack.pte",
// };

export interface SpeakerModelStatus {
  /** True once the real neural model is loaded + active; false = mock fallback. */
  real: boolean;
  /** Active embedder id (stored with enrolled voiceprints as a cache key). */
  id: string;
  /** Load error, if the real model was configured but failed to load. */
  error?: string;
}

let result: SpeakerModelStatus | null = null;
let inFlight: Promise<SpeakerModelStatus> | null = null;

/** Load + register the real speaker model if configured. Idempotent; safe on every start. */
export function initSpeakerModel(): Promise<SpeakerModelStatus> {
  if (result) return Promise.resolve(result);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (!SPEAKER_MODEL) {
      result = { real: false, id: activeSpeakerEmbedderId() };
    } else {
      try {
        const embedder = await createExecutorchSpeakerEmbedder(SPEAKER_MODEL);
        registerSpeakerEmbedder(embedder);
        result = { real: true, id: embedder.id };
      } catch (e) {
        result = { real: false, id: activeSpeakerEmbedderId(), error: String(e) };
      }
    }
    return result;
  })();
  return inFlight;
}

/** Last init result (null until initSpeakerModel resolves). For a Settings status row. */
export function speakerModelStatus(): SpeakerModelStatus | null {
  return result;
}

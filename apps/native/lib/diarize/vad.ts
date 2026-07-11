import { isAvailable, VADModule } from "react-native-executorch";

// REAL voice-activity detection via ExecuTorch's shipped FSMN-VAD model. VAD is the first
// real stage of production diarization: it splits the mic waveform into speech regions so
// each region can be embedded and clustered (silence/noise excluded). The model auto-
// downloads once from Software Mansion's HF repo, then runs fully on-device.

// Shipped fsmn-vad (matches react-native-executorch 0.9.x). Overridable for a bundled asset.
const FSMN_VAD_URL =
  "https://huggingface.co/software-mansion/react-native-executorch-fsmn-vad/resolve/v0.9.0/xnnpack/fsmn_vad_xnnpack_fp32.pte";

/** A detected speech region, in seconds. */
export interface SpeechSegment {
  start: number;
  end: number;
}

let vadPromise: Promise<VADModule> | null = null;

async function getVad(source: string): Promise<VADModule> {
  if (!isAvailable) throw new Error("ExecuTorch native runtime unavailable — cannot run VAD");
  if (!vadPromise) {
    // Clear the cache if load rejects (network/404), so a transient failure can retry
    // instead of poisoning every later call with the same rejected promise.
    vadPromise = VADModule.fromModelName({ modelName: "fsmn-vad", modelSource: source }).catch((e) => {
      vadPromise = null;
      throw e;
    });
  }
  return vadPromise;
}

/** Detect speech segments in a 16 kHz mono waveform. Real on-device VAD. */
export async function detectSpeech(
  waveform: Float32Array,
  source: string = FSMN_VAD_URL,
): Promise<SpeechSegment[]> {
  const vad = await getVad(source);
  return vad.forward(waveform);
}

/** Slice a waveform into its speech regions — the windows fed to the speaker embedder. */
export function sliceSegments(
  waveform: Float32Array,
  segs: SpeechSegment[],
  sampleRate = 16000,
): Float32Array[] {
  return segs.map((s) =>
    waveform.subarray(
      Math.max(0, Math.floor(s.start * sampleRate)),
      Math.min(waveform.length, Math.ceil(s.end * sampleRate)),
    ),
  );
}

/** Release the cached VAD model (teardown). */
export function disposeVad(): void {
  vadPromise = null;
}

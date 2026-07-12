import { isAvailable, VADModule } from "react-native-executorch";

// REAL voice-activity detection via ExecuTorch's shipped FSMN-VAD model. VAD is the first
// real stage of production diarization: it splits the mic waveform into speech regions so
// each region can be embedded and clustered (silence/noise excluded). The model auto-
// downloads once from Software Mansion's HF repo, then runs fully on-device.

// Shipped fsmn-vad (matches react-native-executorch 0.9.x). Overridable for a bundled asset.
const FSMN_VAD_URL =
  "https://huggingface.co/software-mansion/react-native-executorch-fsmn-vad/resolve/v0.9.0/xnnpack/fsmn_vad_xnnpack_fp32.pte";

const SAMPLE_RATE = 16000;

/** A detected speech region, in seconds. */
export interface SpeechSegment {
  start: number;
  end: number;
}

/** The raw native VAD binding, reached past the broken JS wrapper (see detectSpeech). */
interface NativeVad {
  generate?: (waveform: Float32Array, mergeGap: number) => Promise<{ start: number; end: number }[]>;
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
  // react-native-executorch 0.9.2 bug: VADModule.forward() calls the native generate() with a
  // SINGLE arg, but the native binding is generate(waveform, mergeGap) — arity 2 — so forward()
  // throws "Argument count mismatch, was expecting: 2 but got: 1". Call the native fn directly
  // with the mergeGap default (0 = no merging).
  const native = (vad as unknown as { nativeModule?: NativeVad }).nativeModule;
  if (!native?.generate) throw new Error("VAD native generate() unavailable");
  const raw = await native.generate(waveform, 0);
  // The native segments are SAMPLE INDICES (score-frame × hopLength), despite the TS type doc
  // claiming seconds — convert to seconds so the rest of the pipeline (minSegmentSec filter,
  // sliceSegments, STT-timestamp alignment) works in a single, consistent unit.
  return raw.map((s) => ({ start: s.start / SAMPLE_RATE, end: s.end / SAMPLE_RATE }));
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

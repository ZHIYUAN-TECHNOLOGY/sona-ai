import { AudioManager, AudioRecorder } from "react-native-audio-api";

// Real microphone capture for diarization. Reuses the proven standalone-AudioRecorder
// setup from useMicAmplitude (permission → iOS session → onAudioReady frames), but instead
// of only reducing to loudness it ACCUMULATES the mono 16 kHz PCM into an in-memory buffer
// so VAD + speaker embedding can run on the whole utterance. One recorder only — a second
// concurrent AudioRecorder clashes on iOS.
//
// MOAT: enableFileOutput() and connect() are NEVER called — audio is never written to disk
// or routed anywhere. The buffer lives in memory, is handed to on-device VAD/embedding, and
// is discarded. Nothing persists or transmits. The buffer is capped so it can't grow without
// bound.

const SAMPLE_RATE = 16000;
const BUFFER_LENGTH = 512;
const MAX_SECONDS = 20 * 60; // hard cap on retained audio (memory + safety)

export interface CaptureController {
  /** Stop the recorder and return the accumulated mono 16 kHz PCM (resampled if needed). */
  stop(): Promise<Float32Array>;
  /** Whether capture is still running. */
  active(): boolean;
  /** Seconds of audio captured so far. */
  seconds(): number;
  /** The ACTUAL sample rate the device delivered (may differ from the requested 16 kHz). */
  deliveredRate(): number;
}

/** Linear-resample mono PCM to 16 kHz. No-op when already 16 kHz. */
function resampleTo16k(input: Float32Array, inRate: number): Float32Array {
  if (inRate === SAMPLE_RATE || input.length === 0) return input;
  const ratio = inRate / SAMPLE_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = input[i0];
    const b = i0 + 1 < input.length ? input[i0 + 1] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

export interface CaptureOptions {
  /** Per-frame loudness 0..1 (for a live level indicator) — no audio is exposed. */
  onAmplitude?: (amp: number) => void;
}

function frameRms(frame: Float32Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return Math.min(1, Math.sqrt(s / Math.max(1, frame.length)) * 4);
}

/**
 * Begin capturing. Rejects if permission is denied, the session can't activate, or the
 * native module is unavailable — the caller catches and falls back (e.g. to synth capture).
 */
export async function startCapture(opts: CaptureOptions = {}): Promise<CaptureController> {
  const status = await AudioManager.requestRecordingPermissions();
  if (status !== "Granted") throw new Error("microphone permission not granted");

  AudioManager.setAudioSessionOptions({ iosCategory: "record", iosMode: "default", iosOptions: [] });
  await AudioManager.setAudioSessionActivity(true); // rejects on failure in 0.13.1

  const recorder = new AudioRecorder();
  const chunks: Float32Array[] = [];
  let total = 0;
  // Cap sized to the DEVICE rate below (up to 48 kHz), so a long recording isn't cut short.
  const cap = 48000 * MAX_SECONDS;
  let live = true;
  let rate = SAMPLE_RATE; // actual delivered rate (from the buffer) — may be 44.1/48 kHz

  recorder.onAudioReady({ sampleRate: SAMPLE_RATE, bufferLength: BUFFER_LENGTH, channelCount: 1 }, ({ buffer, numFrames }) => {
    rate = buffer.sampleRate || SAMPLE_RATE; // the device's real rate, not the requested one
    const view = buffer.getChannelData(0).subarray(0, numFrames);
    if (total < cap) {
      const take = Math.min(numFrames, cap - total); // clamp exactly to the cap
      chunks.push(Float32Array.from(view.subarray(0, take))); // copy — view is a transient window
      total += take;
    }
    opts.onAmplitude?.(frameRms(view));
  });
  recorder.onError(() => {});

  const res = await recorder.start();
  if (res.status === "error") throw new Error("recorder failed to start");

  let stopping: Promise<Float32Array> | null = null;
  return {
    active: () => live,
    seconds: () => total / rate, // actual delivered rate, not the requested 16 kHz
    deliveredRate: () => rate,
    // Idempotent: concurrent/repeat calls (e.g. stop() + unmount cleanup) share one promise,
    // so teardown runs once and every caller gets the same waveform.
    stop() {
      if (stopping) return stopping;
      live = false;
      stopping = (async () => {
        try {
          recorder.clearOnAudioReady();
          recorder.clearOnError();
          await recorder.stop().catch(() => {});
          await AudioManager.setAudioSessionActivity(false).catch(() => {});
        } catch {
          // native unavailable — nothing to release
        }
        const assembled = new Float32Array(total);
        let o = 0;
        for (const c of chunks) {
          assembled.set(c, o); // sum(chunks) === total (capped above), so this never overruns
          o += c.length;
        }
        chunks.length = 0; // drop references — audio discarded
        // The device often ignores the requested 16 kHz and delivers 44.1/48 kHz; Whisper needs
        // 16 kHz, so resample here (no-op if already 16 kHz).
        return resampleTo16k(assembled, rate);
      })();
      return stopping;
    },
  };
}

export const CAPTURE_SAMPLE_RATE = SAMPLE_RATE;

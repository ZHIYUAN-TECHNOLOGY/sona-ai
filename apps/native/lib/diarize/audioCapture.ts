import {
  AudioManager,
  AudioRecorder,
  BitDepth,
  FileDirectory,
  FileFormat,
  FlacCompressionLevel,
  IOSAudioQuality,
} from "react-native-audio-api";
import { File } from "expo-file-system";

import { parseWav, resampleTo16k } from "../pipeline/wav";

// Real microphone capture for transcription + diarization.
//
// PRIMARY PATH — NATIVE FILE RECORDING: the recorder writes a 16 kHz/16-bit WAV natively
// (enableFileOutput), with NO JavaScript in the audio hot path. The earlier JS-callback
// capture (onAudioReady every ~32 ms) silently DROPPED FRAMES whenever the JS thread janked
// (e.g. with the 1.3GB note LLM resident) — captured clips came out with 2-second holes and
// transcribed as garbage. A native file cannot lose frames to JS jank. At stop() the WAV is
// read, parsed to PCM, resampled to 16 kHz if needed, and the file is DELETED immediately.
//
// The JS callback remains for two demoted jobs only: the live amplitude indicator, and an
// in-memory PCM FALLBACK in case file output fails on some device.
//
// MOAT: the recording exists transiently as a file in the app sandbox and is deleted at
// stop(); it is never uploaded, shared, or retained. connect() is never called.

const SAMPLE_RATE = 16000;
const BUFFER_LENGTH = 2048; // amplitude-only callback → big buffers, few callbacks
const MAX_SECONDS = 20 * 60; // hard cap on retained fallback audio (memory + safety)

export interface CaptureController {
  /** Stop the recorder and return the mono 16 kHz PCM (from the native file when available). */
  stop(): Promise<Float32Array>;
  /** Whether capture is still running. */
  active(): boolean;
  /** Seconds of audio captured so far. */
  seconds(): number;
  /** The ACTUAL sample rate delivered (from the recorded file header, else the callback). */
  deliveredRate(): number;
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

/** Read + parse the recorder's WAV, delete it, return 16 kHz mono PCM. */
async function readRecordingFile(path: string): Promise<{ pcm: Float32Array; rate: number }> {
  const uri = path.startsWith("file://") ? path : `file://${path}`;
  const f = new File(uri);
  const bytes = new Uint8Array(await f.arrayBuffer());
  try {
    f.delete(); // transient artifact — never retained (moat)
  } catch {
    // deletion best-effort; sandbox-only file
  }
  const { rate, samples } = parseWav(bytes);
  return { pcm: resampleTo16k(samples, rate), rate };
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

  // PRIMARY: native 16 kHz / 16-bit mono WAV — immune to JS-thread jank.
  let fileOutput = false;
  try {
    const res = recorder.enableFileOutput({
      channelCount: 1,
      format: FileFormat.Wav,
      preset: {
        sampleRate: SAMPLE_RATE,
        bitDepth: BitDepth.Bit16,
        bitRate: SAMPLE_RATE * 16,
        iosQuality: IOSAudioQuality.Max,
        flacCompressionLevel: FlacCompressionLevel.L5, // unused for wav; type requires it
      },
      directory: FileDirectory.Cache,
      fileNamePrefix: "consult-rec",
    });
    fileOutput = res.status === "success";
  } catch {
    fileOutput = false; // fall back to JS PCM accumulation below
  }

  // FALLBACK + amplitude: JS callback. When file output is on, big buffers keep this cheap.
  const chunks: Float32Array[] = [];
  let total = 0;
  const cap = 48000 * MAX_SECONDS;
  let live = true;
  let cbRate = SAMPLE_RATE; // actual delivered rate per the callback buffers
  let fileRate = 0; // actual rate per the recorded file header (authoritative)

  recorder.onAudioReady({ sampleRate: SAMPLE_RATE, bufferLength: BUFFER_LENGTH, channelCount: 1 }, ({ buffer, numFrames }) => {
    cbRate = buffer.sampleRate || SAMPLE_RATE;
    const view = buffer.getChannelData(0).subarray(0, numFrames);
    if (!fileOutput && total < cap) {
      const take = Math.min(numFrames, cap - total); // clamp exactly to the cap
      chunks.push(Float32Array.from(view.subarray(0, take))); // copy — view is transient
      total += take;
    } else if (fileOutput) {
      total += numFrames; // track duration only; PCM comes from the file
    }
    opts.onAmplitude?.(frameRms(view));
  });
  recorder.onError(() => {});

  const res = await recorder.start();
  if (res.status === "error") throw new Error("recorder failed to start");

  let stopping: Promise<Float32Array> | null = null;
  return {
    active: () => live,
    seconds: () => total / cbRate,
    deliveredRate: () => fileRate || cbRate,
    // Idempotent: concurrent/repeat calls (e.g. stop() + unmount cleanup) share one promise,
    // so teardown runs once and every caller gets the same waveform.
    stop() {
      if (stopping) return stopping;
      live = false;
      stopping = (async () => {
        let fileInfoPath: string | null = null;
        try {
          recorder.clearOnAudioReady();
          recorder.clearOnError();
          const stopRes = await recorder.stop().catch(() => null);
          if (stopRes && stopRes.status === "success" && stopRes.paths?.length) {
            fileInfoPath = stopRes.paths[0];
          }
          await AudioManager.setAudioSessionActivity(false).catch(() => {});
        } catch {
          // native unavailable — nothing to release
        }

        // Primary: the native recording file (gap-free).
        if (fileOutput && fileInfoPath) {
          try {
            const { pcm, rate } = await readRecordingFile(fileInfoPath);
            fileRate = rate;
            chunks.length = 0;
            return pcm;
          } catch {
            // fall through to the JS fallback (empty when fileOutput was on — but try anyway)
          }
        }

        // Fallback: accumulated JS PCM (may have gaps under JS jank — better than nothing).
        const assembled = new Float32Array(fileOutput ? 0 : total);
        if (!fileOutput) {
          let o = 0;
          for (const c of chunks) {
            assembled.set(c, o);
            o += c.length;
          }
        }
        chunks.length = 0; // drop references — audio discarded
        return resampleTo16k(assembled, cbRate);
      })();
      return stopping;
    },
  };
}

export const CAPTURE_SAMPLE_RATE = SAMPLE_RATE;

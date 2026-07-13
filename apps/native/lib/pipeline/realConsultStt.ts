import {
  diarizeWindows,
  loadDoctorVoiceprint,
  startCapture,
  type CaptureController,
} from "../diarize";
import { saveLastCaptureWav, setLastCapture } from "./captureDebug";
import { filterHallucinations } from "./hallucination";
import { langTag, type ClusterSegment } from "./sttAlign";
import { getSttAccuracy, getSttLanguage } from "./sttMode";
import { transcribeWaveform, whisperModelFor } from "./whisperStt";

const SAMPLE_RATE = 16000;

// A consult has few speakers (doctor, patient, maybe one family member) — cap diarization so
// noisy audio can't explode into "Speaker 5". The clinician merges/relabels on Review anyway.
const MAX_CONSULT_SPEAKERS = 4;

/** Slice the [startSec, endSec] window out of a 16 kHz waveform (a whisper speech segment). */
function sliceWindow(waveform: Float32Array, startSec: number, endSec: number): Float32Array {
  const a = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const b = Math.min(waveform.length, Math.ceil(endSec * SAMPLE_RATE));
  return waveform.subarray(a, b);
}

// Real-audio consult source. Flip USE_REAL_STT to true to record REAL mic audio and produce
// the transcript on-device (Whisper) + diarize it, instead of the scripted mockStt. Default
// FALSE keeps the locked demo intact. Batch (not streaming): audio is captured during the
// consult, then transcribed + diarized at End-consult. Needs the mic + Whisper (a device
// build); the pipeline falls back to the mock if capture can't start.
//
// MOAT: audio, transcript, and voiceprints are computed on-device and discarded; only the
// resulting de-identified text later crosses the boundary (optional cloud path).

export type { CaptureController };

/** Per-stage diagnostics so a "no speech" outcome tells us WHICH stage was empty. */
export interface CaptureDiag {
  seconds: number; // audio captured from the mic
  peak: number; // peak amplitude (0 = silence / mic delivered nothing)
  transcriptChars: number; // Whisper output length
  vadSegments: number; // diarization speech regions
  rate?: number; // ACTUAL device sample rate delivered by the recorder
  raw?: string; // first chars of whisper's untouched output (debug)
  sttError?: string;
  vadError?: string;
}

export interface CaptureResult {
  candidates: ClusterSegment[];
  diag: CaptureDiag;
}

/** Begin real mic capture for the consult. Rejects if mic/native unavailable. */
export function startRealCapture(): Promise<CaptureController> {
  return startCapture();
}

function peakOf(w: Float32Array): number {
  let p = 0;
  for (let i = 0; i < w.length; i++) {
    const a = w[i] < 0 ? -w[i] : w[i];
    if (a > p) p = a;
  }
  return p;
}

/**
 * Stop capture, transcribe on-device (whisper.cpp), then diarize the WHISPER SEGMENTS directly —
 * the transcription already located the speech regions (segment timestamps), so there's no
 * separate VAD pass/model. Each utterance becomes a cluster candidate the clinician labels on
 * Review. Every stage is isolated so a failure/empty is reported in `diag`, not swallowed.
 */
export async function finishRealCaptureClusters(capture: CaptureController): Promise<CaptureResult> {
  const waveform = await capture.stop();
  const diag: CaptureDiag = {
    seconds: Math.round((waveform.length / SAMPLE_RATE) * 10) / 10,
    peak: Math.round(peakOf(waveform) * 1000) / 1000,
    transcriptChars: 0,
    vadSegments: 0,
    rate: capture.deliveredRate(),
  };
  if (waveform.length === 0) return { candidates: [], diag };

  // DEBUG rig: keep the exact PCM fed to whisper as a playable/pullable artifact
  // (in-app Play button + Documents/last-capture.wav). Remove before release.
  setLastCapture(waveform);
  if (__DEV__) saveLastCaptureWav(waveform);

  const doctorVoiceprint = await loadDoctorVoiceprint().catch(() => null);

  let tr: Awaited<ReturnType<typeof transcribeWaveform>> | null = null;
  try {
    // whisper.cpp on-device: auto-detect language (default) + built-in hallucination guards.
    tr = await transcribeWaveform(waveform, {
      model: whisperModelFor(getSttAccuracy()),
      language: getSttLanguage(), // "auto" | "en" | "ms"
    });
    diag.transcriptChars = tr.text?.length ?? 0;
    diag.raw = (tr.raw ?? "").slice(0, 140); // whisper's untouched output (debug)
  } catch (e) {
    diag.sttError = String(e);
  }
  // Keep the whisper context RESIDENT — unloading here forced a full 181MB model reload +
  // Metal warmup on every consult (the "Transcribing…" stall). Whisper-small (~300MB) + the
  // Qwen note model (~1.3GB) comfortably coexist on modern iPhones; getCtx still frees the old
  // context on an accuracy-tier switch, and unloadWhisper() remains available for teardown.
  if (!tr) return { candidates: [], diag };

  // Strip hallucinations (bracketed non-speech, repetition loops, caption artifacts) before the
  // segments become speech windows — junk lines shouldn't spawn speakers.
  const cleanSegs = filterHallucinations(tr.segments);
  diag.vadSegments = cleanSegs.length; // speech segments (from whisper, not a separate VAD)
  if (cleanSegs.length === 0) return { candidates: [], diag };

  // Embed + cluster each whisper segment's audio window → anonymous speakers + roles.
  let turns: Awaited<ReturnType<typeof diarizeWindows>> = [];
  try {
    const windows = cleanSegs.map((s) => sliceWindow(waveform, s.start, s.end));
    turns = await diarizeWindows(
      windows,
      cleanSegs.map((s) => s.text),
      { doctorVoiceprint, maxSpeakers: MAX_CONSULT_SPEAKERS },
    );
  } catch (e) {
    diag.vadError = String(e); // diarize failed → everything falls back to one speaker below
  }

  // NOTE: a tri-decode (forced zh/ms) + LLM-arbitration stage lived here briefly and was
  // REMOVED: the multi-voice eval harness measured it as net harmful (overall 75.8% → 66.2%,
  // Malay 95.8% → 68.1%). Pure whisper (beam 5) + human edit is the measured best transcript.
  const lang = langTag(tr.language);
  const candidates: ClusterSegment[] = cleanSegs.map((s, i) => ({
    cluster: turns[i]?.cluster ?? 0, // no diarization → single speaker
    text: s.text,
    rawText: s.text,
    lang,
  }));
  return { candidates, diag };
}

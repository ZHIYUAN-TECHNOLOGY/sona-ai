import {
  diarizeAudio,
  loadDoctorVoiceprint,
  startCapture,
  type CaptureController,
} from "../diarize";
import { filterHallucinations } from "./hallucination";
import { alignTextToClusters, type ClusterSegment } from "./sttAlign";
import { transcribeAudio, unloadStt } from "./realStt";

// A consult has few speakers (doctor, patient, maybe one family member) — cap diarization so
// noisy audio can't explode into "Speaker 5". The clinician merges/relabels on Review anyway.
const MAX_CONSULT_SPEAKERS = 4;

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
 * Stop capture, transcribe the audio on-device (Whisper), diarize it, and align the text to
 * anonymous speaker CLUSTERS. Each stage is isolated so a failure/empty in one is reported in
 * `diag` (not silently swallowed) — the clinician labels the clusters afterwards.
 */
export async function finishRealCaptureClusters(capture: CaptureController): Promise<CaptureResult> {
  const waveform = await capture.stop();
  const diag: CaptureDiag = {
    seconds: Math.round((waveform.length / 16000) * 10) / 10,
    peak: Math.round(peakOf(waveform) * 1000) / 1000,
    transcriptChars: 0,
    vadSegments: 0,
  };
  if (waveform.length === 0) return { candidates: [], diag };

  const doctorVoiceprint = await loadDoctorVoiceprint().catch(() => null);

  let tr: Awaited<ReturnType<typeof transcribeAudio>> | null = null;
  try {
    tr = await transcribeAudio(waveform);
    diag.transcriptChars = tr.text?.length ?? 0;
  } catch (e) {
    diag.sttError = String(e);
  }
  // Free the Whisper model's native memory now — the rest of the consult (diarize, then the
  // Qwen cleanup + note pass) doesn't need it, and whisper-small is ~1.1GB we don't want to
  // hold alongside the LLM.
  await unloadStt();

  let diarized: Awaited<ReturnType<typeof diarizeAudio>> = [];
  try {
    diarized = await diarizeAudio(waveform, { doctorVoiceprint, maxSpeakers: MAX_CONSULT_SPEAKERS });
    diag.vadSegments = diarized.length;
  } catch (e) {
    diag.vadError = String(e);
  }

  // Strip Whisper hallucinations (bracketed non-speech, repetition loops, caption artifacts)
  // before aligning + displaying, so junk lines don't reach the transcript or spawn speakers.
  const cleanSegs = tr ? filterHallucinations(tr.segments) : [];
  let candidates = tr ? alignTextToClusters(cleanSegs, diarized, tr.language) : [];
  // If diarization found no regions but we DID transcribe, keep the text under one speaker
  // instead of dropping it (VAD failing shouldn't discard a real transcript).
  if (candidates.length > 0 && candidates.every((c) => c.cluster < 0)) {
    candidates = candidates.map((c) => ({ ...c, cluster: 0 }));
  }
  return { candidates, diag };
}

import {
  diarizeAudio,
  loadDoctorVoiceprint,
  startCapture,
  type CaptureController,
} from "../diarize";
import type { RawSegment } from "./mockStt";
import { alignTextToSpeakers, transcribeAudio } from "./realStt";

// Real-audio consult source. Flip USE_REAL_STT to true to record REAL mic audio and produce
// the transcript on-device (Whisper) + diarize it, instead of the scripted mockStt. Default
// FALSE keeps the locked demo intact. Batch (not streaming): audio is captured during the
// consult, then transcribed + diarized at End-consult. Needs the mic + Whisper (a device
// build); the pipeline falls back to the mock if capture can't start.
//
// MOAT: audio, transcript, and voiceprints are computed on-device and discarded; only the
// resulting de-identified text later crosses the boundary (optional cloud path).

export const USE_REAL_STT = false;

export type { CaptureController };

/** Begin real mic capture for the consult. Rejects if mic/native unavailable. */
export function startRealCapture(): Promise<CaptureController> {
  return startCapture();
}

/**
 * Stop capture, transcribe the audio on-device (Whisper), diarize it, and align the text to
 * speakers → the diarized transcript the pipeline consumes. Empty transcript if no audio.
 */
export async function finishRealCapture(capture: CaptureController): Promise<RawSegment[]> {
  const waveform = await capture.stop();
  if (waveform.length === 0) return [];
  const doctorVoiceprint = await loadDoctorVoiceprint();
  const [tr, diarized] = await Promise.all([
    transcribeAudio(waveform),
    diarizeAudio(waveform, { doctorVoiceprint }),
  ]);
  return alignTextToSpeakers(tr.segments, diarized, tr.language);
}

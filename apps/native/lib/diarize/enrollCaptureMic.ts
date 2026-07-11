import { CAPTURE_SAMPLE_RATE, startCapture } from "./audioCapture";
import { detectSpeech, sliceSegments } from "./vad";

// REAL enrollment capture — records the clinician's voice through the mic, runs VAD to keep
// only the speech, and returns the windows to embed. Kept separate from the synth
// enrollCapture so the pure/testable path stays native-free. Throws if the mic or native
// modules are unavailable (Expo Go, denied permission) so the caller falls back to synth.
//
// MOAT: audio is captured, VAD'd, and embedded on-device; nothing is written to disk or sent.

export async function captureEnrollmentWindowsMic(durationMs = 4000): Promise<Float32Array[]> {
  const capture = await startCapture();
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  const waveform = await capture.stop();
  const segments = await detectSpeech(waveform);
  const windows = sliceSegments(waveform, segments, CAPTURE_SAMPLE_RATE).filter(
    (w) => w.length >= CAPTURE_SAMPLE_RATE * 0.3, // ≥300 ms of speech
  );
  if (windows.length === 0) throw new Error("no speech captured for enrollment");
  return windows;
}

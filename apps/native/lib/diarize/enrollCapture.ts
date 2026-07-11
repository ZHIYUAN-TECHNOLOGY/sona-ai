import { synthUtterancePcm } from "./mockAudio";

// MOCK enrollment capture — stands in for recording the clinician's own voice through the
// microphone. In production this returns real mic PCM windows (react-native-audio-api,
// already wired for the consult path); here it synthesizes a few windows of the clinician's
// stable voice so the whole enrollment loop (capture → embed → persist) runs end-to-end
// today. Same seam as mockStt/mockAudio — swap the source, nothing downstream changes.

// The clinician's stable voice identity on this device. It matches the doctor's voiceId in
// the mock consult so an enrolled voiceprint actually strengthens the diarizer's acoustic
// match to the doctor cluster. (Real mic audio replaces this stand-in.)
export const CLINICIAN_VOICE_ID = "doctor";

/** Capture N enrollment audio windows for the clinician (mock: synthesized). */
export function captureEnrollmentWindows(count = 5): Float32Array[] {
  return Array.from({ length: count }, (_, i) =>
    synthUtterancePcm(CLINICIAN_VOICE_ID, `enrollment sample ${i}`),
  );
}

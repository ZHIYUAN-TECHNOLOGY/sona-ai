// On-device speaker diarization — public API. Importing this registers the mock
// embedder (via ./mockEmbedder) so getSpeakerEmbedder() works out of the box. Swap in a
// real ECAPA/sherpa-onnx embedder with registerSpeakerEmbedder() and nothing else changes.
//
// MOAT: audio + voiceprints are biometric PHI, computed/matched/stored on-device only.

export * from "./types";
export * from "./embedder";
export * from "./cluster";
export * from "./roleClassifier";
export * from "./diarize";
export { enrollDoctorVoiceprint, loadDoctorVoiceprint, unenrollDoctor, isDoctorEnrolled } from "./enroll";
export { captureEnrollmentWindows, CLINICIAN_VOICE_ID } from "./enrollCapture";
export { mockVoiceprint, mockDiarUtterances } from "./mock";
export { synthUtterancePcm, SAMPLE_RATE, hashStr } from "./mockAudio";
export { mockSpeakerEmbedder, embedPcm, MOCK_EMBED_DIM } from "./mockEmbedder";

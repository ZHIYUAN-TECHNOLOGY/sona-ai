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

// Real (production) on-device pipeline — ExecuTorch speaker model, VAD, fbank frontend.
export { createExecutorchSpeakerEmbedder, type ExecutorchEmbedderConfig } from "./executorchEmbedder";
export { logMelFbank, type Fbank, type FbankOptions } from "./features";
export { detectSpeech, sliceSegments, disposeVad, type SpeechSegment } from "./vad";
export { initSpeakerModel, speakerModelStatus, SPEAKER_MODEL, type SpeakerModelStatus } from "./speakerModel";
export { startCapture, CAPTURE_SAMPLE_RATE, type CaptureController, type CaptureOptions } from "./audioCapture";
export { diarizeAudio, diarizeWindows, type DiarizedSpeech, type DiarizeAudioOptions } from "./liveDiarizer";
export { captureEnrollmentWindowsMic } from "./enrollCaptureMic";

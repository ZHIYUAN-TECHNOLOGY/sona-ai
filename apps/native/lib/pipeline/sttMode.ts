// Recording mode. Default = "real": the consult records real mic audio and transcribes it
// on-device (Whisper) + diarizes it, then the clinician labels the detected speakers. "demo"
// replays the scripted locked transcript (for a fast, deterministic demo). A simple module-
// level setting so a Settings toggle can flip it; the recording flow reads it at start.

export type SttMode = "real" | "demo";

let mode: SttMode = "real";

export function getSttMode(): SttMode {
  return mode;
}

export function setSttMode(next: SttMode): void {
  mode = next;
}

export function isDemoMode(): boolean {
  return mode === "demo";
}

// The on-device Whisper model is MULTILINGUAL — it REQUIRES a forced decode language (it can't
// auto-detect through the executorch wrapper). A Malaysian consult code-switches BM+EN; whisper-
// base can't be told two languages at once, so we pick one. Default "en": the clinical content
// and demo are English-dominant, and English Whisper still passes Malay loanwords through
// legibly. A record-screen toggle can flip this to "ms" for a Malay-dominant consult.
export type SttLanguage = "en" | "ms";

let language: SttLanguage = "en";

export function getSttLanguage(): SttLanguage {
  return language;
}

export function setSttLanguage(next: SttLanguage): void {
  language = next;
}

// STT accuracy tier. "fast" = whisper-base (398MB, already downloaded, quick) — the safe
// default. "high" = whisper-small (1.1GB, multilingual) — markedly better on Malay + code-
// switch, at a bigger download + more RAM/latency. A Settings toggle flips this; realStt
// loads the matching model (and unloads the old one) on the next transcription.
export type SttAccuracy = "fast" | "high";

let accuracy: SttAccuracy = "fast";

export function getSttAccuracy(): SttAccuracy {
  return accuracy;
}

export function setSttAccuracy(next: SttAccuracy): void {
  accuracy = next;
}

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

import { useEffect } from "react";
import { AppState } from "react-native";
import { useEncounter } from "@/features/encounter/store";
import { advancePlayback } from "./model";

export { NoteCard, NoteScreen } from "./note";
export { RecordingScreen } from "./recording-screen";

/** Mount once in the encounter shell so minimizing the recorder keeps playback alive. */
export function ScribePlayback() {
  const { patient, encounter, updateEncounter } = useEncounter();
  useEffect(() => {
    if (encounter?.recording !== "recording") return;
    const timer = setInterval(() => updateEncounter(current => advancePlayback(current)), 1000);
    const listener = AppState.addEventListener("change", next => {
      if (next !== "active") updateEncounter(current => current.recording === "recording" ? { ...current, recording: "paused" } : current);
    });
    return () => { clearInterval(timer); listener.remove(); };
  }, [encounter?.recording, patient?.id, updateEncounter]);
  return null;
}

import { useEffect } from "react";
import { AppState } from "react-native";
import { useEncounter } from "@/features/encounter/store";
import { useLive } from "@/features/live";
import { LiveRecorder } from "./live-recorder";
import { advancePlayback } from "./model";

export { NoteCard, NoteScreen } from "./note";

/** The recorder screen (and its waveform shader) loads when first opened, not with the shell that imports this module. */
export function RecordingScreen() {
  const { RecordingScreen: Screen } = require("./recording-screen") as typeof import("./recording-screen");
  return <Screen />;
}

/** Mount once in the encounter shell so minimizing the recorder keeps it going: the microphone in live mode, the scripted sample otherwise. */
export function ScribePlayback() {
  const { patient, encounter, updateEncounter } = useEncounter();
  const { on: live } = useLive();
  useEffect(() => {
    if (live || encounter?.recording !== "recording") return;
    const timer = setInterval(() => updateEncounter(current => advancePlayback(current)), 1000);
    const listener = AppState.addEventListener("change", next => {
      if (next !== "active") updateEncounter(current => current.recording === "recording" ? { ...current, recording: "paused" } : current);
    });
    return () => { clearInterval(timer); listener.remove(); };
  }, [live, encounter?.recording, patient?.id, updateEncounter]);
  return live ? <LiveRecorder /> : null;
}

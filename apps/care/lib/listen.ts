import { AudioModule, IOSOutputFormat, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState, type RecordingOptions } from "expo-audio";
import { File } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { errorText } from "@/features/errors";
import { client } from "@/utils/orpc";
import { currentLang, translate } from "./i18n";
import "./strings";

/**
 * Speaking to Sona Care: record the patient's voice, stop by itself once they go quiet, and turn it
 * into text on the server (care.transcribe). The words come back for the patient to see before
 * anything is sent. Audio is 16 kHz mono WAV on iOS (what speech models read best), kept only on the
 * phone until it is sent, then deleted. With no speech model switched on, the server says so plainly
 * and the patient types instead.
 */
const OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  extension: ".wav",
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 256_000,
  ios: { ...RecordingPresets.HIGH_QUALITY.ios, extension: ".wav", outputFormat: IOSOutputFormat.LINEARPCM, sampleRate: 16_000, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
};
// Metering is dBFS: above SPEECH counts as talking; SILENCE_MS of quiet after talking ends the turn.
const SPEECH_DB = -38, SILENCE_MS = 1300, MAX_MS = 30_000, NOTHING_MS = 7_000;

export type Listening = "idle" | "listening" | "reading" | "error";

export function useListen({ language, onHeard }: { language?: "en" | "ms" | "zh"; onHeard: (text: string) => void }) {
  const recorder = useAudioRecorder(OPTIONS);
  const status = useAudioRecorderState(recorder, 100);
  const [state, setState] = useState<Listening>("idle");
  const [error, setError] = useState<string>();
  const spoke = useRef(false), quietSince = useRef<number>(undefined), startedAt = useRef(0), ending = useRef(false);
  const heard = useRef(onHeard);
  useEffect(() => { heard.current = onHeard; });

  const finish = async (send: boolean) => {
    // The silence check runs on every level update; only the first end of a turn counts.
    if (state !== "listening" || ending.current) return;
    ending.current = true;
    await recorder.stop().catch(() => {});
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    const uri = recorder.uri;
    if (!send || !uri) { setState("idle"); return; }
    setState("reading");
    const file = new File(uri);
    try {
      const { text } = await client.care.transcribe({ audio: await file.base64(), language });
      setState("idle");
      if (text.trim()) heard.current(text.trim());
      else { setError(translate(currentLang(), "listen.missed")); setState("error"); }
    } catch (e) {
      setError(errorText(e, currentLang())); setState("error");
    } finally {
      try { file.delete(); } catch { /* already gone */ }
    }
  };

  const start = async () => {
    setError(undefined);
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) { setError(translate(currentLang(), "listen.mic")); setState("error"); return; }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    spoke.current = false; quietSince.current = undefined; startedAt.current = Date.now(); ending.current = false;
    setState("listening");
  };

  // Ends the turn by itself: a pause after speaking sends it; nothing said for a while, or too long, stops.
  const level = status.metering ?? -160;
  useEffect(() => {
    if (state !== "listening") return;
    const now = Date.now();
    if (level > SPEECH_DB) { spoke.current = true; quietSince.current = undefined; }
    else if (spoke.current) quietSince.current ??= now;
    if (spoke.current && quietSince.current && now - quietSince.current > SILENCE_MS) void finish(true);
    else if (!spoke.current && now - startedAt.current > NOTHING_MS) void finish(false);
    else if (now - startedAt.current > MAX_MS) void finish(true);
  });

  return {
    state, error, level,
    /** Tap: start listening, or (while listening) send what was said now. */
    toggle: () => { if (state === "listening") void finish(true); else if (state !== "reading") void start(); },
    cancel: () => { void finish(false); },
  };
}

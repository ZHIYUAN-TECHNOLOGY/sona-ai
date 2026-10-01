import { AudioModule, IOSOutputFormat, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState, type RecordingOptions } from "expo-audio";
import { File } from "expo-file-system";
import { base64, partialDue, PARTIAL_MS, wavSoFar } from "@sona-ai/domain/partial-wav";
import { useEffect, useRef, useState } from "react";
import { errorText } from "@/features/errors";
import { client } from "@/utils/orpc";
import { currentLang, translate } from "./i18n";
import "./strings";

/**
 * Speaking to Sona Care: record the patient's voice, stop by itself once they go quiet (or, with
 * `untilStop`, only when they tap stop: the composer's dictation, where a pause mid-thought cut them off), and turn it
 * into text on the server (care.transcribe). The words come back for the patient to see before
 * anything is sent. Audio is 16 kHz mono WAV on iOS (what speech models read best), kept only on the
 * phone until it is sent, then deleted. With no speech model switched on, the server says so plainly
 * and the patient types instead. With `untilStop` the words so far stream back as `partial` while they
 * speak (Sona Pro's rolling partials, see @sona-ai/domain/partial-wav); the pass on the whole file replaces them.
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
// Metering is dBFS: above SPEECH counts as talking; SILENCE_MS of quiet after talking ends the turn (0.8 s, as voice
// assistants do: a longer wait reads as Sona being slow to answer).
const SPEECH_DB = -38, SILENCE_MS = 800, MAX_MS = 30_000, NOTHING_MS = 7_000;

export type Listening = "idle" | "listening" | "reading" | "error";

export function useListen({ language, onHeard, untilStop }: { language?: "en" | "ms" | "zh"; onHeard: (text: string) => void; untilStop?: boolean }) {
  const recorder = useAudioRecorder(OPTIONS);
  const status = useAudioRecorderState(recorder, 100);
  const [state, setState] = useState<Listening>("idle");
  const [error, setError] = useState<string>();
  const [partial, setPartial] = useState("");
  // turn: which recording a partial belongs to, so a late answer from the last one never shows over this one.
  const turn = useRef(0), partialBusy = useRef(false), partialSent = useRef(0), latest = useRef("");
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
    // The partial stays on screen while the whole file is read (no blank wait); if that read fails or hears
    // nothing, the partial is what they said, so it lands in the field instead of an error.
    const said = latest.current;
    latest.current = "";
    const fail = (message: string) => { setPartial(""); setError(message); setState("error"); };
    if (!send || !uri) { setPartial(""); setState("idle"); return; }
    setState("reading");
    const file = new File(uri);
    try {
      const { text } = await client.care.transcribe({ audio: await file.base64(), language });
      setPartial(""); setState("idle");
      if (text.trim() || said) heard.current(text.trim() || said);
      else fail(translate(currentLang(), "listen.missed"));
    } catch (e) {
      if (said) { setPartial(""); setState("idle"); heard.current(said); }
      else fail(errorText(e, currentLang()));
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
    turn.current++; partialSent.current = 0; latest.current = ""; setPartial("");
    setState("listening");
  };

  // Ends the turn by itself: a pause after speaking sends it (unless `untilStop`); nothing said for a while, or too long, stops.
  const level = status.metering ?? -160;
  useEffect(() => {
    if (state !== "listening") return;
    const now = Date.now();
    if (level > SPEECH_DB) { spoke.current = true; quietSince.current = undefined; }
    else if (spoke.current) quietSince.current ??= now;
    if (!untilStop && spoke.current && quietSince.current && now - quietSince.current > SILENCE_MS) void finish(true);
    else if (!spoke.current && now - startedAt.current > NOTHING_MS) void finish(false);
    else if (now - startedAt.current > MAX_MS) void finish(true);
  });

  // With `untilStop`, every PARTIAL_MS while recording send the file so far (a tick is skipped while the last partial
  // is still out). A partial fails silently: it is only a preview, and the final pass says what went wrong.
  useEffect(() => {
    if (!untilStop || state !== "listening") return;
    const tick = setInterval(() => {
      const uri = recorder.uri, mine = turn.current;
      if (!uri || ending.current) return;
      const file = new File(uri), size = file.size;
      if (!partialDue({ busy: partialBusy.current, spoke: spoke.current, sent: partialSent.current, size })) return;
      partialBusy.current = true; partialSent.current = size;
      void (async () => {
        try {
          const wav = wavSoFar(await file.bytes());
          if (!wav || ending.current) return;
          const { text } = await client.care.transcribe({ audio: base64(wav), language });
          if (turn.current === mine && !ending.current && text.trim()) { latest.current = text.trim(); setPartial(latest.current); }
        } catch { /* preview only */ } finally { partialBusy.current = false; }
      })();
    }, PARTIAL_MS);
    return () => clearInterval(tick);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps -- one ticker per recording

  return {
    state, error, level, untilStop,
    /** The words so far (untilStop only): live while recording, held while the whole file is read. */
    partial,
    /** How long this recording has run, for the timer. */
    ms: status.durationMillis,
    /** Tap: start listening, or (while listening) send what was said now. */
    toggle: () => { if (state === "listening") void finish(true); else if (state !== "reading") void start(); },
    cancel: () => { void finish(false); },
  };
}

import { AudioModule, IOSOutputFormat, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState, type RecordingOptions } from "expo-audio";
import { File } from "expo-file-system";
import { base64, partialDue, PARTIAL_MS, wavSoFar } from "@sona-ai/domain/partial-wav";
import { useEffect, useRef, useState } from "react";
import { api, errorText } from ".";
import { MAX_MS, SPEECH_DB, turnEnd } from "./turn";

/**
 * Speaking to Sona from the dock, in live mode: record the clinician's voice as 16 kHz mono WAV (what
 * the speech model reads best, the same format Sona Care sends), then turn it into text on the server
 * (`voice.transcribe`, Sona speech on Baseten). Holding the orb records until release; a tap records
 * until a pause after speaking. Audio stays on the phone until it is sent, then it is deleted. While it
 * records, the words so far come back as `partial` (see @sona-ai/domain/partial-wav); reading the whole file replaces them.
 */
export const OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  extension: ".wav",
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 256_000,
  ios: { ...RecordingPresets.HIGH_QUALITY.ios, extension: ".wav", outputFormat: IOSOutputFormat.LINEARPCM, sampleRate: 16_000, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
};
export type Hearing = "idle" | "listening" | "reading";
export type How = "hold" | "tap";

export function useVoiceInput({ onHeard, onError }: { onHeard: (text: string, how: How) => void; onError: (message: string) => void }) {
  const recorder = useAudioRecorder(OPTIONS);
  const status = useAudioRecorderState(recorder, 100);
  const [state, setState] = useState<Hearing>("idle");
  const [partial, setPartial] = useState("");
  // turn: which recording a partial belongs to, so a late answer from the last one never shows over this one.
  const turn = useRef(0), partialBusy = useRef(false), partialSent = useRef(0);
  const starting = useRef(false), dropped = useRef(false), how = useRef<How>("hold"), spoke = useRef(false), quietSince = useRef<number>(undefined), startedAt = useRef(0), ending = useRef(false);
  const handlers = useRef({ onHeard, onError });
  useEffect(() => { handlers.current = { onHeard, onError }; });

  const stop = async (send: boolean) => {
    // Released before the microphone opened (a very short hold, or the permission sheet): nothing to send.
    if (starting.current) { dropped.current = true; return; }
    if (ending.current || state !== "listening") return;
    ending.current = true;
    await recorder.stop().catch(() => {});
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    const uri = recorder.uri;
    // Nothing to send: the room's audio goes now (Sona Live drops a silent turn every few seconds while it listens).
    if (!send || !uri || !spoke.current) { try { if (uri) new File(uri).delete(); } catch { /* already gone */ } setState("idle"); return; }
    setState("reading");
    const file = new File(uri);
    try {
      const { text } = await api.voice.transcribe({ audio: await file.base64() });
      setState("idle");
      if (text.trim()) handlers.current.onHeard(text.trim(), how.current);
      else handlers.current.onError("Sona didn't catch that. Try again, or type.");
    } catch (e) {
      setState("idle");
      handlers.current.onError(errorText(e));
    } finally {
      try { file.delete(); } catch { /* already gone */ }
    }
  };

  const start = async (next: How) => {
    if (state !== "idle" || starting.current) return;
    starting.current = true; dropped.current = false;
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) { handlers.current.onError("Sona can't hear you: allow the microphone for Sona Pro in Settings, or type."); return; }
      if (dropped.current) { handlers.current.onError("Hold the orb while you speak, then let go."); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) {
      // The recorder's own error is for us, not the clinician (it names native classes and line numbers).
      console.warn("voice: microphone did not open", e);
      handlers.current.onError("Sona can't open the microphone right now. Type instead, or try again.");
      return;
    } finally {
      starting.current = false;
    }
    turn.current++; partialSent.current = 0; setPartial("");
    how.current = next; spoke.current = false; quietSince.current = undefined; startedAt.current = Date.now(); ending.current = false;
    setState("listening");
  };

  // Every level update: note speech, and end a tap's turn on its own (a hold ends on release, or at the cap).
  const level = status.metering ?? -160;
  useEffect(() => {
    if (state !== "listening") return;
    const now = Date.now();
    if (level > SPEECH_DB) { spoke.current = true; quietSince.current = undefined; }
    else if (spoke.current) quietSince.current ??= now;
    const end = turnEnd({ spoke: spoke.current, quietFor: quietSince.current ? now - quietSince.current : 0, elapsed: now - startedAt.current });
    if (end && (how.current === "tap" || now - startedAt.current > MAX_MS)) void stop(end === "send");
  });

  // Every PARTIAL_MS while recording, send the file so far (a tick is skipped while the last partial is still out).
  // A partial fails silently: it is only a preview, and the final pass says what went wrong.
  useEffect(() => {
    if (state !== "listening") { if (state === "idle") setPartial(""); return; }
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
          const { text } = await api.voice.transcribe({ audio: base64(wav) });
          if (turn.current === mine && !ending.current && text.trim()) setPartial(text.trim());
        } catch { /* preview only */ } finally { partialBusy.current = false; }
      })();
    }, PARTIAL_MS);
    return () => clearInterval(tick);
  }, [state]);

  return { state, level, partial, speaking: state === "listening" && level > SPEECH_DB, start, stop };
}

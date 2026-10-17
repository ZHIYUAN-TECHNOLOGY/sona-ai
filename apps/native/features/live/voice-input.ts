import { AudioModule, IOSOutputFormat, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState, type RecordingOptions } from "expo-audio";
import { File } from "expo-file-system";
import { base64, partialDue, PARTIAL_MS, wavSoFar } from "@sona-ai/domain/partial-wav";
import { useEffect, useRef, useState } from "react";
import { api, errorText, lostConnection } from ".";
import { MAX_MS, SPEECH_DB, turnEnd } from "./turn";

/**
 * Speaking to Sona from the dock, in live mode: record the clinician's voice as 16 kHz mono WAV (what
 * the speech model reads best, the same format Sona Care sends), then turn it into text on the server
 * (`voice.transcribe`, Sona speech on Baseten). Holding the orb records until release; a tap records
 * until a pause after speaking. Sona Live ("live") records until it is stopped and never sends by itself: each pause
 * after speech ends a chunk, read (`onHeard`, in order) while the next one records. Audio stays on the phone until it
 * is read, then it is deleted. While it records, the words so far come back as `partial` and `onWords` (see
 * @sona-ai/domain/partial-wav); reading the whole file replaces them.
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
export type How = "hold" | "tap" | "live";

const forget = (uri: string | null) => { try { if (uri) new File(uri).delete(); } catch { /* already gone */ } };
const OPENING = "Sona can't open the microphone right now. Type instead, or try again.";
/** Read a recording on the server; a dropped connection is tried twice more (0.5 s, then 1.5 s later) before it counts. */
async function transcribe(uri: string) {
  const audio = await new File(uri).base64();
  for (const wait of [500, 1500]) {
    try { return (await api.voice.transcribe({ audio })).text.trim(); }
    catch (e) { if (!lostConnection(e)) throw e; await new Promise(r => setTimeout(r, wait)); }
  }
  return (await api.voice.transcribe({ audio })).text.trim();
}

export function useVoiceInput({ onHeard, onError, onWords }: {
  /** A recording's final reading, by recording (Live: chunk) number; a Live chunk with nothing said is "". */
  onHeard: (text: string, how: How, chunk: number) => void;
  /** Why speech didn't become words; `chunk` when a Live chunk couldn't be read. */
  onError: (message: string, chunk?: number) => void;
  /** The words so far of the recording being made (a partial reading). */
  onWords?: (text: string, chunk: number) => void;
}) {
  const recorder = useAudioRecorder(OPTIONS);
  const status = useAudioRecorderState(recorder, 100);
  // The state also lives in a ref, so a recorder step that runs later reads it as it is then.
  const [state, setState] = useState<Hearing>("idle"), hearing = useRef<Hearing>("idle");
  const set = (next: Hearing) => { hearing.current = next; setState(next); };
  const [partial, setPartial] = useState("");
  // Live: finished chunks still being read.
  const [reading, setReading] = useState(false);
  // turn: which recording (Live: chunk) a partial belongs to, so a late answer from the last one never shows over this one.
  const turn = useRef(0), partialBusy = useRef(false), partialSent = useRef(0);
  const starting = useRef(false), dropped = useRef(false), how = useRef<How>("hold"), spoke = useRef(false), quietSince = useRef<number>(undefined), startedAt = useRef(0), ending = useRef(false);
  // Recorder steps run one after another (as the scribe's do), so a chunk being cut finishes before a stop; Live's
  // chunks are read one after another too, so their words land in the order said.
  const steps = useRef(Promise.resolve()), reads = useRef(Promise.resolve()), unread = useRef(0);
  const handlers = useRef({ onHeard, onError, onWords });
  useEffect(() => { handlers.current = { onHeard, onError, onWords }; });
  const serial = (step: () => Promise<void>) => (steps.current = steps.current.then(step).catch(e => console.warn("voice: recorder step failed", e)));

  /** A recording (or Live's next chunk) has started: its partials, speech and clock start over. */
  const begin = () => {
    turn.current++; partialSent.current = 0; setPartial("");
    spoke.current = false; quietSince.current = undefined; startedAt.current = Date.now(); ending.current = false;
  };

  /** Live: a finished chunk is read after those before it (nothing said is "", unread), then its file goes. */
  const read = (uri: string | null, chunk: number, said: boolean) => {
    unread.current++; setReading(true);
    reads.current = reads.current.then(async () => {
      try { handlers.current.onHeard(said && uri ? await transcribe(uri) : "", "live", chunk); }
      catch (e) { handlers.current.onError(errorText(e), chunk); }
      finally { forget(uri); if (!--unread.current) setReading(false); }
    }).catch(e => console.warn("voice: chunk not read", e));
  };

  const stop = (send: boolean): Promise<void> => {
    // Released before the microphone opened (a very short hold, or the permission sheet): nothing to send.
    if (starting.current) { dropped.current = true; return Promise.resolve(); }
    return serial(async () => {
      if (hearing.current !== "listening") return;
      ending.current = true;
      await recorder.stop().catch(() => {});
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      const uri = recorder.uri;
      // Live: the chunk is read into the draft after the others (send), or goes unread.
      if (how.current === "live") { set("idle"); if (send) read(uri, turn.current, spoke.current); else forget(uri); return; }
      // Nothing to send: the room's audio goes now.
      if (!send || !uri || !spoke.current) { forget(uri); set("idle"); return; }
      set("reading");
      try {
        const text = await transcribe(uri);
        set("idle");
        if (text) handlers.current.onHeard(text, how.current, turn.current);
        else handlers.current.onError("Sona didn't catch that. Try again, or type.");
      } catch (e) {
        set("idle");
        handlers.current.onError(errorText(e));
      } finally {
        forget(uri);
      }
    });
  };

  // Live: a pause after speech (or the cap) ends a chunk. The next one starts recording at once, inside the pause, and
  // the finished one is read into the draft; silence goes the same way, unread, so the room's audio never piles up.
  // ponytail: the restart loses about 0.2 s, which the pause absorbs (as the scribe's parts do); expo-audio's PCM stream
  // (useAudioStream) would cut without a gap if words go missing at the joins.
  const cut = (keep: boolean) => {
    ending.current = true;
    void serial(async () => {
      if (hearing.current !== "listening") return;
      const chunk = turn.current, said = spoke.current;
      await recorder.stop().catch(() => {});
      const uri = recorder.uri;
      try {
        await recorder.prepareToRecordAsync(OPTIONS);
        recorder.record();
        begin();
      } catch (e) {
        console.warn("voice: next chunk did not start", e);
        set("idle");
        handlers.current.onError(OPENING);
      }
      if (keep) read(uri, chunk, said); else forget(uri);
    });
  };

  const start = async (next: How) => {
    if (hearing.current !== "idle" || starting.current) return;
    starting.current = true; dropped.current = false;
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) { handlers.current.onError("Sona can't hear you: allow the microphone for Sona Pro in Settings, or type."); return; }
      if (dropped.current) { handlers.current.onError("Hold the orb while you speak, then let go."); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      // OPTIONS, so each recording gets a file of its own: without them iOS records over the last one's, which Live may still be reading.
      await recorder.prepareToRecordAsync(OPTIONS);
      recorder.record();
    } catch (e) {
      // The recorder's own error is for us, not the clinician (it names native classes and line numbers).
      console.warn("voice: microphone did not open", e);
      handlers.current.onError(OPENING);
      return;
    } finally {
      starting.current = false;
    }
    how.current = next; begin();
    set("listening");
  };

  // Every level update: note speech; a tap's turn ends on its own (a hold ends on release, or at the cap), and Live's chunk is cut.
  const level = status.metering ?? -160;
  useEffect(() => {
    if (state !== "listening" || ending.current) return;
    const now = Date.now();
    if (level > SPEECH_DB) { spoke.current = true; quietSince.current = undefined; }
    else if (spoke.current) quietSince.current ??= now;
    const end = turnEnd({ spoke: spoke.current, quietFor: quietSince.current ? now - quietSince.current : 0, elapsed: now - startedAt.current });
    if (!end) return;
    if (how.current === "live") cut(end === "send");
    else if (how.current === "tap" || now - startedAt.current > MAX_MS) void stop(end === "send");
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
          if (turn.current !== mine || ending.current || !text.trim()) return;
          setPartial(text.trim());
          handlers.current.onWords?.(text.trim(), mine);
        } catch { /* preview only */ } finally { partialBusy.current = false; }
      })();
    }, PARTIAL_MS);
    return () => clearInterval(tick);
  }, [state]);

  // latest: the newest recording's number, so Live can leave out chunks recorded before it opened (or was cleared).
  return { state, level, partial, reading, speaking: state === "listening" && level > SPEECH_DB, start, stop, latest: () => turn.current };
}

import { AudioModule, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { File } from "expo-file-system";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { useEncounterSelect, type useEncounter } from "@/features/encounter/store";
import { sameShallow } from "@/features/live/keep-same";
import type { TranscriptLine } from "@/features/encounter/types";
import { api, errorText } from "@/features/live";
import { OPTIONS } from "@/features/live/voice-input";
import { captionLines, draftLines, draftOrigin, listen, namesOf, nextMemory, placeCaption, scribeStore, sendPart, speechOff, withCapturedDraft, withDraft, withPart, type Listening, type LiveDraft, type Part, type SendDeps } from "./live";

type Update = ReturnType<typeof useEncounter>["updateEncounter"];
/** A visit's live parts, last draft and microphone state, re-read whenever they change. */
export const useScribe = (patientId: string | undefined) => useSyncExternalStore(scribeStore.subscribe, () => scribeStore.get(patientId));

/*
 * The consultation clock while recording (one microphone, so one clock). It ticks here once a second rather than in
 * the visit's state, so only the clock re-renders, not every screen that reads the visit. The visit's
 * `recordingSeconds` is written at each cut, pause and stop, and the tick is dropped once that has landed.
 */
let ticking: { owner: string; seconds: number } | undefined;
const clockListeners = new Set<() => void>();
const clockStore = {
  get: (patientId: string | undefined) => ticking && ticking.owner === patientId ? ticking.seconds : undefined,
  set(next: typeof ticking) { ticking = next; clockListeners.forEach(l => l()); },
  subscribe(listener: () => void) { clockListeners.add(listener); return () => { clockListeners.delete(listener); }; },
};
/** Renders `children` with the visit's recorded seconds (`saved` is its `recordingSeconds`), live while recording. */
export function RecordingSeconds({ patientId, saved, children }: { patientId: string | undefined; saved: number; children: (seconds: number) => ReactNode }) {
  return children(useSyncExternalStore(clockStore.subscribe, () => clockStore.get(patientId) ?? saved));
}

const deps: SendDeps = {
  read: uri => new File(uri).base64(),
  transcribe: (audio, memory) => api.voice.transcribe({ audio, voices: { memory } }),
  remove: uri => { try { new File(uri).delete(); } catch { /* already gone */ } },
  wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

/*
 * A visit's parts reach the speech model one at a time, in recording order: each is sent with the voice memory the one
 * before returned, so a person keeps their number. A part that fails does not hold up the next.
 */
const sending = new Map<string, Promise<void>>();
const inTurn = (owner: string, part: Part, update: Update) => {
  sending.set(owner, (sending.get(owner) ?? Promise.resolve()).then(() => send(owner, part, update)).catch(e => console.warn("scribe: part was not filed", e)));
};

/** Sends one part and files its words under the visit it was recorded in; a part that fails keeps its audio for `retryParts`. */
async function send(owner: string, part: Part, update: Update) {
  const result = await sendPart(part.uri!, deps, () => scribeStore.update(owner, withPart(part.n, { status: "retrying" })), scribeStore.get(owner).memory);
  if ("text" in result) {
    scribeStore.update(owner, s => ({ ...withPart(part.n, { status: "done", uri: undefined, error: undefined, starting: undefined })(s), memory: nextMemory(result, s.memory) }));
    // New dialogue revises the visit, as a scripted line does: the note needs review again.
    if (result.text) update(c => ({ ...c, transcript: placeCaption(c.transcript, captionLines(part, result, namesOf(c.transcript))), noteReviewed: false }), true, owner);
    return;
  }
  const off = speechOff(result.error);
  scribeStore.update(owner, withPart(part.n, { status: "failed", error: errorText(result.error), starting: off?.starting ? { minutes: off.minutes } : undefined }));
}

/** The clinician's retry: every part that failed is sent again (with its one retry), in turn, with the voice memory as it is now. */
export function retryParts(owner: string, update: Update) {
  for (const part of scribeStore.get(owner).parts) {
    if (part.status !== "failed" || !part.uri) continue;
    scribeStore.update(owner, withPart(part.n, { status: "sending", error: undefined, starting: undefined }));
    inTurn(owner, part, update);
  }
}

/** Gemma's draft of the visit's note from its transcript (note.draft). Not applied: the screen applies it, or offers it beside the note. */
export const askDraft = (encounterId: string, transcript: TranscriptLine[]) => api.note.draft({ encounterId, lines: draftLines(transcript) });
/** The draft becomes the note under review (and who said what, the transcript); the note screen labels it by where it came from. */
export function applyDraft(owner: string, draft: LiveDraft, update: Update) {
  update(c => withDraft(c, draft), false, owner);
  scribeStore.update(owner, s => ({ ...s, draft: draftOrigin(draft) }));
}
/** No draft came back: the captured words stand as the note's history, labelled, with the reason. */
export function applyCaptured(owner: string, error: unknown, update: Update) {
  update(withCapturedDraft, false, owner);
  scribeStore.update(owner, s => ({ ...s, draft: { source: "fixture", dropped: 0, error: errorText(error) } }));
}

/** One stretch of recording, from start (or resume) to pause or stop. Times are ms into the consultation. */
type Run = { owner: string; baseMs: number; doneMs: number; busy: boolean; heard: Listening; stalledSince?: number };
const DENIED = "Sona can't hear the consultation: allow the microphone for Sona Pro in Settings.";

/**
 * The consultation recorder in live mode, mounted with the encounter shell (ScribePlayback) so it keeps recording while
 * the recorder screen is minimized. It follows the visit's `recording`: recording records, paused or stopped ends the
 * stretch. Underneath, the audio is cut into parts of about 15 s at a pause (./live `listen`), each sent to
 * voice.transcribe as soon as it ends; to the clinician it is one recording. A part's words join the transcript as a
 * caption, and its audio is deleted once heard.
 * ponytail: the recorder is stopped and restarted at each cut, losing about 0.2 s, which the pause absorbs; expo-audio's
 * PCM stream (useAudioStream) would cut without a gap if words go missing at the joins.
 */
export function LiveRecorder() {
  const { patient, encounter, updateEncounter } = useEncounterSelect(s => ({ patient: s.patient, encounter: s.encounter, updateEncounter: s.updateEncounter }), sameShallow);
  const recorder = useAudioRecorder(OPTIONS);
  const run = useRef<Run>(undefined);
  // Recorder steps run one after another, so a cut in progress finishes before a stop or a new start.
  const chain = useRef(Promise.resolve());
  const serial = (step: () => Promise<void>) => { chain.current = chain.current.then(step).catch(e => console.warn("scribe: recorder step failed", e)); };
  const wanted = encounter?.recording, id = patient?.id;

  const halt = (owner: string, mic?: string) => {
    if (mic) scribeStore.update(owner, s => ({ ...s, mic }));
    // The clock runs ahead of the visit's seconds between cuts; keep what was recorded.
    const ticked = clockStore.get(owner) ?? 0;
    updateEncounter(c => {
      if (c.recording !== "recording") return c;
      const seconds = Math.max(ticked, c.recordingSeconds);
      return { ...c, recording: seconds ? "paused" : "idle", recordingSeconds: seconds };
    }, false, owner);
  };
  const queue = (owner: string, span: { from: number; to: number }, uri: string) => {
    const part: Part = { n: scribeStore.get(owner).parts.length + 1, from: Math.round(span.from / 1000), to: Math.round(span.to / 1000), status: "sending", uri };
    scribeStore.update(owner, s => ({ ...s, parts: [...s.parts, part] }));
    inTurn(owner, part, updateEncounter);
  };
  const start = (owner: string, seconds: number) => {
    const r: Run = { owner, baseMs: seconds * 1000, doneMs: 0, busy: true, heard: { levels: [] } };
    run.current = r;
    serial(async () => {
      try {
        if (!(await AudioModule.requestRecordingPermissionsAsync()).granted) { if (run.current === r) run.current = undefined; return halt(owner, DENIED); }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync(OPTIONS);
        recorder.record();
        r.busy = false;
        scribeStore.update(owner, s => s.mic ? { ...s, mic: undefined } : s);
      } catch (e) {
        // The recorder's own error is for us, not the clinician (it names native classes).
        console.warn("scribe: microphone did not open", e);
        if (run.current === r) run.current = undefined;
        halt(owner, "The microphone didn't open. Try again.");
      }
    });
  };
  /** Ends the part being recorded and sends it; `next` starts the next part at once, so the gap falls in the pause. */
  const cut = (r: Run, next: boolean) => serial(async () => {
    const ms = recorder.getStatus().durationMillis;
    await recorder.stop().catch(e => console.warn("scribe: recorder did not stop cleanly", e));
    const uri = recorder.uri, span = { from: r.baseMs + r.doneMs, to: r.baseMs + r.doneMs + ms };
    r.doneMs += ms; r.heard = { levels: [] };
    if (uri && ms >= 1000) queue(r.owner, span, uri); else if (uri) deps.remove(uri);
    updateEncounter(c => ({ ...c, recordingSeconds: Math.floor(span.to / 1000) }), false, r.owner);
    if (!next) { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {}); return; }
    try {
      await recorder.prepareToRecordAsync(OPTIONS);
      recorder.record();
      r.busy = false;
    } catch (e) {
      console.warn("scribe: next part did not start", e);
      if (run.current === r) run.current = undefined;
      halt(r.owner, "The microphone stopped. What was said so far is kept; resume to carry on.");
    }
  });

  // Recording starts a stretch; pausing, stopping or opening another visit ends it (one microphone, one consultation).
  useEffect(() => {
    const r = run.current;
    if (!r && wanted === "recording" && id) start(id, clockStore.get(id) ?? encounter?.recordingSeconds ?? 0);
    else if (r && (wanted !== "recording" || id !== r.owner)) {
      if (id !== r.owner) updateEncounter(c => c.recording === "recording" ? { ...c, recording: "paused" } : c, false, r.owner);
      run.current = undefined; r.busy = true;
      cut(r, false);
    }
  }, [wanted, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // While recording, ten times a second: track the level, cut at a pause once the part is long enough, and move the clock.
  useEffect(() => {
    if (wanted !== "recording") return;
    let tick = 0;
    const timer = setInterval(() => {
      const r = run.current;
      if (!r || r.busy) return;
      const { durationMillis, metering = -160, isRecording } = recorder.getStatus();
      const now = Date.now();
      if (!isRecording) {
        // A call or another app took the microphone: end the part, so what was said is sent, and pause.
        r.stalledSince ??= now;
        if (now - r.stalledSince > 1500) { run.current = undefined; r.busy = true; cut(r, false); halt(r.owner, "Recording was interrupted, by a call or another app. What was said so far is kept; resume to carry on."); }
        return;
      }
      r.stalledSince = undefined;
      const reading = listen(r.heard, { elapsed: durationMillis, level: metering, now });
      r.heard = reading.heard;
      if (reading.cut) { r.busy = true; cut(r, true); return; }
      if (++tick % 10 === 0) clockStore.set({ owner: r.owner, seconds: Math.floor((r.baseMs + r.doneMs + durationMillis) / 1000) });
    }, 100);
    return () => clearInterval(timer);
  }, [wanted]); // eslint-disable-line react-hooks/exhaustive-deps
  // Once the visit's seconds have landed after the last cut (or no visit is open), the clock text reads them again.
  useEffect(() => { if (!run.current) clockStore.set(undefined); }, [id, encounter?.recordingSeconds]);

  // Leaving the app pauses the consultation: iOS stops the microphone in the background. ("inactive" is only a sheet over the app, like the permission prompt.)
  useEffect(() => {
    const sub = AppState.addEventListener("change", next => {
      const r = run.current;
      if (next === "background" && r) updateEncounter(c => c.recording === "recording" ? { ...c, recording: "paused" } : c, false, r.owner);
    });
    return () => sub.remove();
  }, [updateEncounter]);
  // Live mode switched off mid-recording: the recorder goes with this component, so the visit pauses.
  useEffect(() => () => { const r = run.current; if (r) halt(r.owner); clockStore.set(undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

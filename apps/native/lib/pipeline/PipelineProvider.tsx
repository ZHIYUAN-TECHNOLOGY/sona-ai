// Flow-scoped state for the consult pipeline. Wraps the (consult) route group so
// consultId, the live transcript, and the redaction result persist as the user
// moves consent -> recording -> privacy -> note -> sign -> complete. Drives the
// scripted STT today; swap `streamLockedTranscript` for a real executorch
// useSpeechToText stream after Gate 0 with no change to consumers.

import { useLLM } from "react-native-executorch";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  beginConsult,
  draftClinicalNote,
  editClinicalNote,
  persistRecordingStart,
  persistRecordingStop,
  persistSegment,
  runRedaction,
  type RedactionOutcome,
} from "./consultPipeline";
import { getConsult } from "../db";
import type { Speaker } from "../db/types";
import { streamLockedTranscript, type RawSegment, type Streamer } from "./mockStt";
import {
  finishRealCaptureClusters,
  startRealCapture,
  type CaptureController,
  type CaptureDiag,
} from "./realConsultStt";
import type { ClusterSegment } from "./sttAlign";
import { cleanupClusters } from "./cleanupTranscript";
import { getSttMode } from "./sttMode";
import { NOTE_MODEL } from "./model";
import type { DraftNote } from "./noteGen";
import { DEFAULT_TEMPLATE, templateById, templatePrompt } from "./templates";

export type PipelineStatus =
  | "idle"
  | "consented"
  | "recording"
  | "transcribing"
  | "transcribed"
  | "redacted"
  | "noted";

export type NoteStatus = "idle" | "generating" | "ready" | "error";

export interface PipelineState {
  consultId: string | null;
  status: PipelineStatus;
  segments: RawSegment[]; // live transcript as it streams in
  candidates: ClusterSegment[]; // real: transcribed lines tagged by anonymous cluster (pre-label)
  cleaning: boolean; // on-device LLM cleanup of the raw transcript is running
  captureDiag: CaptureDiag | null; // per-stage capture diagnostics (mic/STT/diarize)
  redaction: RedactionOutcome | null; // de-identified output + counts + re-ID map
  note: DraftNote | null; // re-identified SOAP note for the clinician view
  noteStatus: NoteStatus;
  noteError: string | null;
  llmReady: boolean; // on-device note model loaded
  llmProgress: number; // 0..1 model download progress
  templateId: string; // selected note template (drives the generation prompt)
  startConsult: (consentText: string) => Promise<void>;
  startRecording: () => void;
  stopRecording: () => Promise<"label" | "privacy">; // real → speaker-label step; mock → privacy
  cancelRecording: () => void; // abandon a live capture (leave screen w/o End) — mic off, no transcribe
  applySpeakerLabels: (labels: Record<number, Speaker>) => Promise<void>; // cluster → role
  updateCandidateText: (index: number, text: string) => void; // clinician edits a transcript line
  redact: () => Promise<void>;
  draftNote: () => Promise<void>;
  editNote: (markdown: string) => Promise<void>; // persist a clinician edit + reflect it
  setTemplate: (id: string) => void;
  reset: () => void;
}

const Ctx = createContext<PipelineState | null>(null);

export function PipelineProvider({ children }: { children: React.ReactNode }) {
  const [consultId, setConsultId] = useState<string | null>(null);
  const [status, setStatus] = useState<PipelineStatus>("idle");
  const [segments, setSegments] = useState<RawSegment[]>([]);
  const [candidates, setCandidates] = useState<ClusterSegment[]>([]);
  const candidatesRef = useRef<ClusterSegment[]>([]);
  const [cleaning, setCleaning] = useState(false);
  // Each real capture bumps captureSeq; cleanup runs once per capture (cleanedSeq catches up).
  const captureSeqRef = useRef(0);
  const cleanedSeqRef = useRef(0);
  const [captureDiag, setCaptureDiag] = useState<CaptureDiag | null>(null);
  const [redaction, setRedaction] = useState<RedactionOutcome | null>(null);
  const [note, setNote] = useState<DraftNote | null>(null);
  const [noteStatus, setNoteStatus] = useState<NoteStatus>("idle");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string>(DEFAULT_TEMPLATE.id);
  const templateRef = useRef<string>(DEFAULT_TEMPLATE.id);
  const streamer = useRef<Streamer | null>(null);
  const captureRef = useRef<CaptureController | null>(null); // real mic capture (USE_REAL_STT)
  const startingCapture = useRef(false); // guards against a double start spawning 2 recorders
  const stopRequested = useRef(false); // guards the async capture-start vs an early stop
  const seq = useRef(0);
  const idRef = useRef<string | null>(null);
  const redactionRef = useRef<RedactionOutcome | null>(null);
  // Transcript segments persist to SQLite asynchronously as they stream. Redaction
  // reads the transcript BACK from SQLite, so it must wait for every write to commit
  // first — otherwise it redacts a partial transcript (device disk I/O is slower than
  // the sim, so the last segments' writes can still be in flight at End-consult).
  const pendingWrites = useRef<Promise<unknown>[]>([]);

  // On-device note model — loaded ONLY AFTER transcription finishes. Loading the 1.3GB Qwen
  // concurrently with whisper's Metal encode starves it (memory/GPU contention) and whisper
  // emits timestamp-only garbage (proven by the launch self-test: same audio transcribes fine
  // without Qwen loading, fails during a consult). Sequence: record → transcribe → THEN load
  // Qwen while the clinician labels speakers (dead time). Configured in ./model (NOTE_MODEL).
  const [llmWanted, setLlmWanted] = useState(false);
  const llm = useLLM({ model: NOTE_MODEL, preventLoad: !llmWanted });

  const startConsult = useCallback(async (consentText: string) => {
    const consult = await beginConsult(consentText);
    idRef.current = consult.id;
    setConsultId(consult.id);
    setStatus("consented");
    setSegments([]);
    setCandidates([]);
    candidatesRef.current = [];
    captureSeqRef.current = 0;
    cleanedSeqRef.current = 0;
    setCaptureDiag(null);
    setRedaction(null);
    seq.current = 0;
    pendingWrites.current = [];
  }, []);

  // Scripted (mock) transcript stream — the demo default.
  const startMockStream = (id: string) => {
    streamer.current = streamLockedTranscript(
      (segment) => {
        setSegments((prev) => [...prev, segment]);
        const s = seq.current++;
        // .catch so a write failure never becomes an uncaught red screen; the rejection is
        // still surfaced via redact()'s allSettled if it matters.
        pendingWrites.current.push(persistSegment(id, s, segment).catch(() => {}));
      },
      {
        onDone: () => {
          pendingWrites.current.push(persistRecordingStop(id).catch(() => {}));
          setStatus("transcribed");
        },
      },
    );
  };

  const startRecording = useCallback(() => {
    const id = idRef.current;
    if (!id) return;
    setStatus("recording");
    void persistRecordingStart(id).catch(() => {}); // don't red-screen if the audit write races
    if (getSttMode() === "real") {
      // GUARD: a second start (double focus-fire, re-render) must never spawn a second
      // AudioRecorder — iOS kills the first recorder's session, truncating its file.
      if (captureRef.current || startingCapture.current) {
        console.log("[REC] startRecording IGNORED — capture already live/starting");
        return;
      }
      startingCapture.current = true;
      console.log("[REC] startRecording — starting capture");
      // Real mic capture; transcription runs at stopRecording. Fall back to the scripted
      // stream if the mic / native modules can't start (Expo Go, denied permission).
      stopRequested.current = false;
      startRealCapture()
        .then((c) => {
          startingCapture.current = false;
          console.log("[REC] capture STARTED");
          // If the user already ended before capture started, don't keep a live mic.
          if (stopRequested.current) {
            console.log("[REC] stopRequested during setup → stopping fresh capture");
            c.stop().catch(() => {});
            return;
          }
          captureRef.current = c;
        })
        .catch((e) => {
          startingCapture.current = false;
          console.log(`[REC] capture FAILED → mock fallback: ${String(e)}`);
          captureRef.current = null;
          startMockStream(id);
        });
      return;
    }
    startMockStream(id);
  }, []);

  // End recording. Real path: stop capture, transcribe + diarize on-device, persist the
  // aligned transcript. Mock path: the stream's onDone already advanced state.
  const stopRecording = useCallback(async (): Promise<"label" | "privacy"> => {
    const id = idRef.current;
    if (!id) return "privacy";
    console.log(`[REC] stopRecording — capture ${captureRef.current ? "live" : "ABSENT"}`);
    stopRequested.current = true; // if capture is still starting, its .then will stop it
    if (getSttMode() === "real" && captureRef.current) {
      const capture = captureRef.current;
      captureRef.current = null;
      setStatus("transcribing");
      try {
        // Transcribe + diarize on-device → lines tagged by anonymous cluster. Segments are
        // NOT persisted yet — the clinician labels the clusters (Dr/Patient) next, then
        // applySpeakerLabels writes the final transcript.
        const { candidates: cands, diag } = await finishRealCaptureClusters(capture);
        candidatesRef.current = cands;
        setCandidates(cands);
        setCaptureDiag(diag);
      } catch (e) {
        candidatesRef.current = [];
        setCandidates([]);
        setCaptureDiag({ seconds: 0, peak: 0, transcriptChars: 0, vadSegments: 0, sttError: String(e) });
      }
      captureSeqRef.current++; // a new capture's transcript is ready → eligible for one cleanup pass
      setLlmWanted(true); // transcription done → NOW load the note LLM (labeling covers the wait)
      setStatus("transcribed");
      return "label"; // persistRecordingStop is deferred to applySpeakerLabels (after segments)
    }
    // Mock / fallback path: stop any stray real capture (e.g. the Demo toggle was flipped
    // mid-consult so this isn't the real path), then let the scripted stream finalize itself
    // via onDone (persistRecordingStop + "transcribed") — exactly as the demo did before.
    if (captureRef.current) {
      captureRef.current.stop().catch(() => {});
      captureRef.current = null;
    }
    setLlmWanted(true); // mock/demo path: no whisper conflict — load the note LLM now
    return "privacy";
  }, []);

  // Abandon a live capture without transcribing — used when the clinician LEAVES the recording
  // screen without tapping End (tab switch, back-swipe). Releases the mic + audio session (via
  // capture.stop → setAudioSessionActivity(false)) so the orange mic indicator clears; the
  // captured audio is discarded. Idempotent and safe when nothing is capturing.
  const cancelRecording = useCallback(() => {
    console.log(`[REC] cancelRecording — capture ${captureRef.current ? "live → stopping" : "absent"}`);
    stopRequested.current = true; // if capture is still starting, its .then will stop it
    const cap = captureRef.current;
    captureRef.current = null;
    cap?.stop().catch(() => {});
    streamer.current?.cancel();
  }, []);

  // Apply the clinician's cluster → role labels to the transcribed candidates, building and
  // persisting the final transcript the redaction/note steps consume. Segments are written
  // FIRST, then the record-stop marker — so redaction (which awaits all writes) sees the full
  // transcript. Candidates whose cluster is −1 (no diarization overlap) fall back to "unknown".
  const applySpeakerLabels = useCallback(async (labels: Record<number, Speaker>) => {
    const id = idRef.current;
    if (!id) throw new Error("No active consult (idRef is null).");
    // Verify the consult row exists — the FK failure means a write referenced a consult that
    // isn't there. Surface the exact id so we can see WHY (instead of an opaque FK crash).
    const consult = await getConsult(id).catch(() => null);
    if (!consult) throw new Error(`Consult row missing: ${id}`);
    const segs: RawSegment[] = candidatesRef.current.map((c) => ({
      speaker: labels[c.cluster] ?? "unknown",
      text: c.text,
      lang: c.lang,
    }));
    // Persist SEQUENTIALLY (one SQLite connection). Await each, then the record-stop marker.
    for (let i = 0; i < segs.length; i++) {
      await persistSegment(id, i, segs[i]);
    }
    await persistRecordingStop(id);
    seq.current = segs.length;
    setSegments(segs);
  }, []);

  // Conservative on-device LLM cleanup of the raw transcript (fix ASR garbles, keep raw). Runs
  // ONCE per capture, only when the Qwen model is ready (STT has been unloaded by then, so they
  // don't co-reside). Best-effort: any failure leaves the raw text. Guarded by cleanedSeq so the
  // setCandidates it performs can't re-trigger itself.
  const runCleanup = useCallback(async () => {
    if (cleanedSeqRef.current >= captureSeqRef.current) return;
    const targetSeq = captureSeqRef.current;
    cleanedSeqRef.current = targetSeq; // mark attempted up-front → no re-entry / loop
    const cands = candidatesRef.current;
    if (cands.length === 0) return;
    setCleaning(true);
    try {
      const cleaned = await cleanupClusters(cands, llm);
      // Skip if a newer capture started while we were cleaning (stale result).
      if (captureSeqRef.current === targetSeq) {
        candidatesRef.current = cleaned;
        setCandidates(cleaned);
      }
    } finally {
      setCleaning(false);
    }
  }, [llm]);

  useEffect(() => {
    if (getSttMode() === "real" && llm.isReady && candidates.length > 0) void runCleanup();
  }, [candidates, llm.isReady, runCleanup]);

  // Clinician edits a transcript line on the Review screen. The edit becomes authoritative — mark
  // this capture cleaned so an in-flight/late cleanup can't clobber it — and flows to the note.
  const updateCandidateText = useCallback((index: number, text: string) => {
    cleanedSeqRef.current = captureSeqRef.current;
    const next = candidatesRef.current.map((c, i) => (i === index ? { ...c, text } : c));
    candidatesRef.current = next;
    setCandidates(next);
  }, []);

  const redact = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    // Wait for all transcript writes to commit before reading the transcript back,
    // so redaction always runs over the COMPLETE consult, never a partial one.
    await Promise.allSettled(pendingWrites.current);
    const result = await runRedaction(id);
    redactionRef.current = result;
    setRedaction(result);
    setStatus("redacted");
    setNote(null);
    setNoteStatus("idle");
    setNoteError(null);
  }, []);

  // Draft the SOAP note on-device from the de-identified transcript, re-identify
  // locally, persist, and expose it. Idempotent: no-op unless idle with a redaction
  // ready. The note screen calls this once the model is loaded.
  const draftNote = useCallback(async () => {
    const id = idRef.current;
    const red = redactionRef.current;
    if (!id || !red) return;
    setNoteStatus("generating");
    setNoteError(null);
    try {
      const prompt = templatePrompt(templateById(templateRef.current));
      const drafted = await draftClinicalNote(id, red.segments, llm, prompt);
      setNote(drafted);
      setNoteStatus("ready");
      setStatus("noted");
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : String(e));
      setNoteStatus("error");
    }
  }, [llm]);

  // Persist a clinician's manual edit of the drafted note (before signing) and reflect
  // it in the in-memory note so the review screen re-renders. On-device only.
  const editNote = useCallback(async (markdown: string) => {
    const id = idRef.current;
    if (!id) return;
    const { soap, orders } = await editClinicalNote(id, markdown);
    setNote((prev) => (prev ? { ...prev, soap, orders, markdown } : prev));
  }, []);

  const setTemplate = useCallback((id: string) => {
    templateRef.current = id;
    setTemplateId(id);
  }, []);

  const reset = useCallback(() => {
    streamer.current?.cancel();
    captureRef.current?.stop().catch(() => {}); // stop the mic if a real capture is live
    captureRef.current = null;
    idRef.current = null;
    redactionRef.current = null;
    setConsultId(null);
    setStatus("idle");
    setSegments([]);
    setCandidates([]);
    candidatesRef.current = [];
    captureSeqRef.current = 0;
    cleanedSeqRef.current = 0;
    setCleaning(false);
    setLlmWanted(false); // next consult transcribes BEFORE the LLM loads again
    setCaptureDiag(null);
    setRedaction(null);
    setNote(null);
    setNoteStatus("idle");
    setNoteError(null);
    seq.current = 0;
    pendingWrites.current = [];
  }, []);

  useEffect(
    () => () => {
      streamer.current?.cancel();
      captureRef.current?.stop().catch(() => {});
    },
    [],
  );

  return (
    <Ctx.Provider
      value={{
        consultId,
        status,
        segments,
        candidates,
        cleaning,
        captureDiag,
        redaction,
        note,
        noteStatus,
        noteError,
        llmReady: llm.isReady,
        llmProgress: llm.downloadProgress ?? 0,
        templateId,
        startConsult,
        startRecording,
        stopRecording,
        cancelRecording,
        applySpeakerLabels,
        updateCandidateText,
        redact,
        draftNote,
        editNote,
        setTemplate,
        reset,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useConsultPipeline(): PipelineState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConsultPipeline must be used within <PipelineProvider>");
  return ctx;
}

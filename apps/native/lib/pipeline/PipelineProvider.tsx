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
import type { Speaker } from "../db/types";
import { streamLockedTranscript, type RawSegment, type Streamer } from "./mockStt";
import {
  finishRealCaptureClusters,
  startRealCapture,
  type CaptureController,
} from "./realConsultStt";
import type { ClusterSegment } from "./sttAlign";
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
  applySpeakerLabels: (labels: Record<number, Speaker>) => Promise<void>; // cluster → role
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
  const [redaction, setRedaction] = useState<RedactionOutcome | null>(null);
  const [note, setNote] = useState<DraftNote | null>(null);
  const [noteStatus, setNoteStatus] = useState<NoteStatus>("idle");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string>(DEFAULT_TEMPLATE.id);
  const templateRef = useRef<string>(DEFAULT_TEMPLATE.id);
  const streamer = useRef<Streamer | null>(null);
  const captureRef = useRef<CaptureController | null>(null); // real mic capture (USE_REAL_STT)
  const stopRequested = useRef(false); // guards the async capture-start vs an early stop
  const seq = useRef(0);
  const idRef = useRef<string | null>(null);
  const redactionRef = useRef<RedactionOutcome | null>(null);
  // Transcript segments persist to SQLite asynchronously as they stream. Redaction
  // reads the transcript BACK from SQLite, so it must wait for every write to commit
  // first — otherwise it redacts a partial transcript (device disk I/O is slower than
  // the sim, so the last segments' writes can still be in flight at End-consult).
  const pendingWrites = useRef<Promise<unknown>[]>([]);

  // On-device note model. Loads once for the whole consult flow so the note screen
  // can draft without a cold start. Model is configured in ./model (NOTE_MODEL).
  const llm = useLLM({ model: NOTE_MODEL });

  const startConsult = useCallback(async (consentText: string) => {
    const consult = await beginConsult(consentText);
    idRef.current = consult.id;
    setConsultId(consult.id);
    setStatus("consented");
    setSegments([]);
    setCandidates([]);
    candidatesRef.current = [];
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
        pendingWrites.current.push(persistSegment(id, s, segment));
      },
      {
        onDone: () => {
          pendingWrites.current.push(persistRecordingStop(id));
          setStatus("transcribed");
        },
      },
    );
  };

  const startRecording = useCallback(() => {
    const id = idRef.current;
    if (!id) return;
    setStatus("recording");
    void persistRecordingStart(id);
    if (getSttMode() === "real") {
      // Real mic capture; transcription runs at stopRecording. Fall back to the scripted
      // stream if the mic / native modules can't start (Expo Go, denied permission).
      stopRequested.current = false;
      startRealCapture()
        .then((c) => {
          // If the user already ended before capture started, don't keep a live mic.
          if (stopRequested.current) {
            c.stop().catch(() => {});
            return;
          }
          captureRef.current = c;
        })
        .catch(() => {
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
    stopRequested.current = true; // if capture is still starting, its .then will stop it
    if (getSttMode() === "real" && captureRef.current) {
      const capture = captureRef.current;
      captureRef.current = null;
      setStatus("transcribing");
      try {
        // Transcribe + diarize on-device → lines tagged by anonymous cluster. Segments are
        // NOT persisted yet — the clinician labels the clusters (Dr/Patient) next, then
        // applySpeakerLabels writes the final transcript.
        const cands = await finishRealCaptureClusters(capture);
        candidatesRef.current = cands;
        setCandidates(cands);
      } catch {
        candidatesRef.current = [];
        setCandidates([]);
      }
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
    return "privacy";
  }, []);

  // Apply the clinician's cluster → role labels to the transcribed candidates, building and
  // persisting the final transcript the redaction/note steps consume. Segments are written
  // FIRST, then the record-stop marker — so redaction (which awaits all writes) sees the full
  // transcript. Candidates whose cluster is −1 (no diarization overlap) fall back to "unknown".
  const applySpeakerLabels = useCallback(async (labels: Record<number, Speaker>) => {
    const id = idRef.current;
    if (!id) return;
    const segs: RawSegment[] = candidatesRef.current.map((c) => ({
      speaker: labels[c.cluster] ?? "unknown",
      text: c.text,
      lang: c.lang,
    }));
    segs.forEach((s, i) => pendingWrites.current.push(persistSegment(id, i, s)));
    pendingWrites.current.push(persistRecordingStop(id));
    seq.current = segs.length;
    setSegments(segs);
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
        applySpeakerLabels,
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

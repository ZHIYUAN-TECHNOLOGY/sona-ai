// Flow-scoped state for the consult pipeline. Wraps the (consult) route group so
// consultId, the live transcript, and the redaction result persist as the user
// moves consent -> recording -> privacy -> note -> sign -> complete. Drives the
// scripted STT today; swap `streamLockedTranscript` for a real executorch
// useSpeechToText stream after Gate 0 with no change to consumers.

import { QWEN3_1_7B_QUANTIZED, useLLM } from "react-native-executorch";
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
  persistRecordingStart,
  persistRecordingStop,
  persistSegment,
  runRedaction,
  type RedactionOutcome,
} from "./consultPipeline";
import { streamLockedTranscript, type RawSegment, type Streamer } from "./mockStt";
import type { DraftNote } from "./noteGen";

export type PipelineStatus =
  | "idle"
  | "consented"
  | "recording"
  | "transcribed"
  | "redacted"
  | "noted";

export type NoteStatus = "idle" | "generating" | "ready" | "error";

export interface PipelineState {
  consultId: string | null;
  status: PipelineStatus;
  segments: RawSegment[]; // live transcript as it streams in
  redaction: RedactionOutcome | null; // de-identified output + counts + re-ID map
  note: DraftNote | null; // re-identified SOAP note for the clinician view
  noteStatus: NoteStatus;
  noteError: string | null;
  llmReady: boolean; // on-device note model loaded
  llmProgress: number; // 0..1 model download progress
  startConsult: (consentText: string) => Promise<void>;
  startRecording: () => void;
  redact: () => Promise<void>;
  draftNote: () => Promise<void>;
  reset: () => void;
}

const Ctx = createContext<PipelineState | null>(null);

export function PipelineProvider({ children }: { children: React.ReactNode }) {
  const [consultId, setConsultId] = useState<string | null>(null);
  const [status, setStatus] = useState<PipelineStatus>("idle");
  const [segments, setSegments] = useState<RawSegment[]>([]);
  const [redaction, setRedaction] = useState<RedactionOutcome | null>(null);
  const [note, setNote] = useState<DraftNote | null>(null);
  const [noteStatus, setNoteStatus] = useState<NoteStatus>("idle");
  const [noteError, setNoteError] = useState<string | null>(null);
  const streamer = useRef<Streamer | null>(null);
  const seq = useRef(0);
  const idRef = useRef<string | null>(null);
  const redactionRef = useRef<RedactionOutcome | null>(null);
  // Transcript segments persist to SQLite asynchronously as they stream. Redaction
  // reads the transcript BACK from SQLite, so it must wait for every write to commit
  // first — otherwise it redacts a partial transcript (device disk I/O is slower than
  // the sim, so the last segments' writes can still be in flight at End-consult).
  const pendingWrites = useRef<Promise<unknown>[]>([]);

  // On-device note model. Loads once for the whole consult flow so the note screen
  // can draft without a cold start. Same model benchmarked at Gate 0 (Qwen3-1.7B).
  const llm = useLLM({ model: QWEN3_1_7B_QUANTIZED });

  const startConsult = useCallback(async (consentText: string) => {
    const consult = await beginConsult(consentText);
    idRef.current = consult.id;
    setConsultId(consult.id);
    setStatus("consented");
    setSegments([]);
    setRedaction(null);
    seq.current = 0;
    pendingWrites.current = [];
  }, []);

  const startRecording = useCallback(() => {
    const id = idRef.current;
    if (!id) return;
    setStatus("recording");
    void persistRecordingStart(id);
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
      const drafted = await draftClinicalNote(id, red.segments, llm);
      setNote(drafted);
      setNoteStatus("ready");
      setStatus("noted");
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : String(e));
      setNoteStatus("error");
    }
  }, [llm]);

  const reset = useCallback(() => {
    streamer.current?.cancel();
    idRef.current = null;
    redactionRef.current = null;
    setConsultId(null);
    setStatus("idle");
    setSegments([]);
    setRedaction(null);
    setNote(null);
    setNoteStatus("idle");
    setNoteError(null);
    seq.current = 0;
    pendingWrites.current = [];
  }, []);

  useEffect(() => () => streamer.current?.cancel(), []);

  return (
    <Ctx.Provider
      value={{
        consultId,
        status,
        segments,
        redaction,
        note,
        noteStatus,
        noteError,
        llmReady: llm.isReady,
        llmProgress: llm.downloadProgress ?? 0,
        startConsult,
        startRecording,
        redact,
        draftNote,
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

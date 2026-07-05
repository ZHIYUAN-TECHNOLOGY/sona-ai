// Flow-scoped state for the consult pipeline. Wraps the (consult) route group so
// consultId, the live transcript, and the redaction result persist as the user
// moves consent -> recording -> privacy -> note -> sign -> complete. Drives the
// scripted STT today; swap `streamLockedTranscript` for a real executorch
// useSpeechToText stream after Gate 0 with no change to consumers.

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
  persistRecordingStart,
  persistRecordingStop,
  persistSegment,
  runRedaction,
  type RedactionOutcome,
} from "./consultPipeline";
import { streamLockedTranscript, type RawSegment, type Streamer } from "./mockStt";

export type PipelineStatus = "idle" | "consented" | "recording" | "transcribed" | "redacted";

export interface PipelineState {
  consultId: string | null;
  status: PipelineStatus;
  segments: RawSegment[]; // live transcript as it streams in
  redaction: RedactionOutcome | null; // de-identified output + counts + re-ID map
  startConsult: (consentText: string) => Promise<void>;
  startRecording: () => void;
  redact: () => Promise<void>;
  reset: () => void;
}

const Ctx = createContext<PipelineState | null>(null);

export function PipelineProvider({ children }: { children: React.ReactNode }) {
  const [consultId, setConsultId] = useState<string | null>(null);
  const [status, setStatus] = useState<PipelineStatus>("idle");
  const [segments, setSegments] = useState<RawSegment[]>([]);
  const [redaction, setRedaction] = useState<RedactionOutcome | null>(null);
  const streamer = useRef<Streamer | null>(null);
  const seq = useRef(0);
  const idRef = useRef<string | null>(null);

  const startConsult = useCallback(async (consentText: string) => {
    const consult = await beginConsult(consentText);
    idRef.current = consult.id;
    setConsultId(consult.id);
    setStatus("consented");
    setSegments([]);
    setRedaction(null);
    seq.current = 0;
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
        void persistSegment(id, s, segment);
      },
      {
        onDone: () => {
          void persistRecordingStop(id);
          setStatus("transcribed");
        },
      },
    );
  }, []);

  const redact = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    const result = await runRedaction(id);
    setRedaction(result);
    setStatus("redacted");
  }, []);

  const reset = useCallback(() => {
    streamer.current?.cancel();
    idRef.current = null;
    setConsultId(null);
    setStatus("idle");
    setSegments([]);
    setRedaction(null);
    seq.current = 0;
  }, []);

  useEffect(() => () => streamer.current?.cancel(), []);

  return (
    <Ctx.Provider
      value={{ consultId, status, segments, redaction, startConsult, startRecording, redact, reset }}
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

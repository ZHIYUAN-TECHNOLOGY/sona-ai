// Pure row builders — NO native-module imports, so these are unit-testable under
// plain node (see db.test.ts). index.ts wraps these with an expo-crypto UUID id;
// on their own they fall back to a crypto-free id, and every builder also accepts
// an explicit `id`/`now`/`ts` for deterministic tests.

import type {
  AuditEntry,
  AuditStage,
  Consult,
  Speaker,
  TranscriptSegment,
} from "./types";

/** Crypto-free fallback id. Runtime code injects a proper UUID via index.ts. */
export function fallbackId(): string {
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildConsult(input: {
  title: string;
  consentText: string;
  now?: number;
  id?: string;
}): Consult {
  const now = input.now ?? Date.now();
  return {
    id: input.id ?? fallbackId(),
    createdAt: now,
    updatedAt: now,
    status: "consented",
    title: input.title,
    consentText: input.consentText,
    audioHash: null,
    signedAt: null,
  };
}

export function buildTranscriptSegment(input: {
  consultId: string;
  seq: number;
  speaker: Speaker;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number | null;
  id?: string;
}): TranscriptSegment {
  return {
    id: input.id ?? fallbackId(),
    consultId: input.consultId,
    seq: input.seq,
    speaker: input.speaker,
    text: input.text,
    startMs: input.startMs,
    endMs: input.endMs,
    confidence: input.confidence ?? null,
  };
}

export function buildAudit(input: {
  consultId: string;
  stage: AuditStage;
  detail: string;
  ts?: number;
  id?: string;
}): AuditEntry {
  return {
    id: input.id ?? fallbackId(),
    consultId: input.consultId,
    ts: input.ts ?? Date.now(),
    stage: input.stage,
    detail: input.detail,
  };
}

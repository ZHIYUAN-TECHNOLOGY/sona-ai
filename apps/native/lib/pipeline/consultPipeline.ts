// Consult pipeline orchestrator. Ties the on-device pieces together for the
// slice: create consult -> persist streamed transcript -> redact (secure re-ID
// map) -> audit. Everything runs on-device; the re-ID map goes only to secure
// storage. Note-gen + sign + export land Day 3-4 behind the same seam.

import {
  appendAudit,
  appendTranscript,
  createConsult,
  getTranscript,
  setConsultStatus,
} from "../db";
import { saveReidMap } from "../secure/reidMap";
import type { RawSegment } from "./mockStt";
import { redactTranscript, type RedactionResult } from "./redaction";

export async function beginConsult(consentText: string, title = "GP follow-up") {
  const consult = await createConsult({ title, consentText });
  await appendAudit({
    consultId: consult.id,
    stage: "consent",
    detail: `Consent captured, spoken: "${consentText.slice(0, 48)}"`,
  });
  return consult;
}

export async function persistRecordingStart(consultId: string): Promise<void> {
  await setConsultStatus(consultId, "recording");
  await appendAudit({ consultId, stage: "record-start", detail: "Recording started, on-device" });
}

export async function persistSegment(
  consultId: string,
  seq: number,
  seg: RawSegment,
): Promise<void> {
  await appendTranscript({
    consultId,
    seq,
    speaker: seg.speaker,
    text: seg.text,
    startMs: seq * 1000,
    endMs: (seq + 1) * 1000,
    confidence: null,
  });
}

export async function persistRecordingStop(consultId: string): Promise<void> {
  await setConsultStatus(consultId, "transcribed");
  await appendAudit({ consultId, stage: "record-stop", detail: "Recording stopped" });
}

export interface RedactionOutcome extends RedactionResult {
  consultId: string;
}

/**
 * Run redaction over the stored raw transcript, seal the re-ID map to secure
 * storage, and audit it. Returns the de-identified result for the privacy gate.
 * The returned `segments` are the ONLY thing that may ever leave the device.
 */
export async function runRedaction(consultId: string): Promise<RedactionOutcome> {
  const stored = await getTranscript(consultId);
  const result = redactTranscript(stored.map((s) => ({ speaker: s.speaker, text: s.text })));

  await saveReidMap(consultId, result.reidMap); // device-only, secure enclave, never SQLite/export
  await setConsultStatus(consultId, "redacted");
  await appendAudit({
    consultId,
    stage: "redact",
    detail: `${result.highConfidenceCount} identifiers redacted on-device; re-ID map sealed in secure storage`,
  });
  if (result.uncertain.length > 0) {
    await appendAudit({
      consultId,
      stage: "redact",
      detail: `${result.uncertain.length} low-confidence name kept local, pending confirmation`,
    });
  }
  return { ...result, consultId };
}

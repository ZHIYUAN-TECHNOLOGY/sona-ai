// Consult pipeline orchestrator. Ties the on-device pieces together for the
// slice: create consult -> persist streamed transcript -> redact (secure re-ID
// map) -> audit. Everything runs on-device; the re-ID map goes only to secure
// storage. Note-gen + sign + export land Day 3-4 behind the same seam.

import {
  appendAudit,
  appendTranscript,
  createConsult,
  getTranscript,
  saveNote,
  setConsultStatus,
  setConsultTitle,
} from "../db";
import { getReidMap, saveReidMap, sealAudioDiscard } from "../secure/reidMap";
import { applyReidMap } from "../secure/reidMapCore";
import { NOTE_MODEL_NAME } from "./model";
import type { RawSegment } from "./mockStt";
import { getCorpus } from "../knowledge/corpus";
import {
  buildTranscript,
  generateNote,
  parseSoap,
  stripInlineMd,
  type DraftNote,
  type LlmLike,
} from "./noteGen";
import { buildGuidelineContext } from "./noteGrounding";
import { redactTranscript, type RedactionResult, type RedactedSegment } from "./redaction";

export async function beginConsult(consentText: string, title = "New consult") {
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

/**
 * Draft the SOAP note on-device from the DE-IDENTIFIED transcript, then re-identify
 * it locally for the clinician's view and persist it (re-identified) to the local
 * DB. The model sees only tokens (NAME_1, IC_1, …); the secure re-ID map is applied
 * here, on-device, and never crosses the boundary. Returns the re-identified note.
 */
export async function draftClinicalNote(
  consultId: string,
  segments: RedactedSegment[],
  llm: LlmLike,
  systemPrompt?: string,
): Promise<DraftNote> {
  // NOTE GROUNDING (RAG) IS OFF: injecting retrieved guidelines overwhelmed the 1.5B note
  // model — a 3-line cough consult retrieved "cancer & TB pathways" and the note became
  // oncology/TB fiction with [G1] citation tokens leaking into the text (Jul 2026).
  // Re-enable only after the note eval harness proves a net win.
  const NOTE_GROUNDING = false;
  const { context: guidelineContext, refs: guidelines } = NOTE_GROUNDING
    ? buildGuidelineContext(buildTranscript(segments), getCorpus(), 3)
    : { context: "", refs: [] as ReturnType<typeof buildGuidelineContext>["refs"] };
  const deident = await generateNote(llm, segments, systemPrompt, guidelineContext); // model sees de-identified text only

  const map = (await getReidMap(consultId)) ?? {};
  const soap = {
    subjective: applyReidMap(map, deident.soap.subjective),
    objective: applyReidMap(map, deident.soap.objective),
    assessment: applyReidMap(map, deident.soap.assessment),
    plan: applyReidMap(map, deident.soap.plan),
  };
  const orders = deident.orders.map((o) => ({ ...o, text: applyReidMap(map, o.text) }));
  // Re-identify the Markdown body too (same secure map, on-device) for rich display.
  const markdown = applyReidMap(map, deident.markdown);
  // Red flags are symptom phrases (no tokens) — the map is a no-op, but apply it for
  // defence in depth so a flag can never carry a token into the highlighter.
  const redFlags = deident.redFlags.map((f) => applyReidMap(map, f));

  await saveNote({ consultId, soap, orders, redFlags, deidentified: false }); // re-identified local record
  // The AI title is de-identified (generated from tokens, tokens stripped) — save it
  // AS-IS, never re-identified, so no patient name can reach a list screen.
  await setConsultTitle(consultId, deident.title);
  await setConsultStatus(consultId, "noted");
  await appendAudit({
    consultId,
    stage: "note-generate",
    detail: `SOAP note drafted on-device (${NOTE_MODEL_NAME}), re-identified locally for review`,
  });
  return {
    soap,
    orders,
    raw: deident.raw,
    title: deident.title,
    markdown,
    redFlags,
    guidelines,
    generationMs: deident.generationMs,
  };
}

/**
 * Persist a clinician's manual edit of the note. The clinician edits the rendered
 * Markdown (## sections + Orders bullets); we parse it back into structured SOAP +
 * orders (same tolerant parser used for the model draft), strip any inline marks, and
 * upsert with edited=true. An audit row records the on-device edit. The model's
 * red-flag tags are left as-is (saveNote preserves them). Fully on-device — nothing
 * is transmitted. Returns the parsed structure for the caller to reflect in the UI.
 */
export async function editClinicalNote(
  consultId: string,
  markdown: string,
): Promise<{ soap: DraftNote["soap"]; orders: DraftNote["orders"] }> {
  const parsed = parseSoap(markdown);
  const soap = {
    subjective: stripInlineMd(parsed.soap.subjective),
    objective: stripInlineMd(parsed.soap.objective),
    assessment: stripInlineMd(parsed.soap.assessment),
    plan: stripInlineMd(parsed.soap.plan),
  };
  const orders = parsed.orders.map((o) => ({ ...o, text: stripInlineMd(o.text) }));
  await saveNote({ consultId, soap, orders, deidentified: false, edited: true });
  await appendAudit({
    consultId,
    stage: "note-edit",
    detail: "Clinician edited the note on-device",
  });
  return { soap, orders };
}

/**
 * Sign the note and discard the raw audio. On sign the consult is marked signed,
 * the audio is sealed-then-discarded (only a hash is retained as tamper-evidence;
 * the audio itself never persists), and both events are written to the audit log.
 * Nothing is transmitted — the "0 bytes" proof shown on the complete screen.
 */
export async function signConsult(consultId: string, clinicianName: string): Promise<void> {
  await setConsultStatus(consultId, "signed");
  await appendAudit({ consultId, stage: "sign", detail: `Note signed by ${clinicianName}` });
  // Scripted demo has no captured audio file; the live-mic path seals the real
  // SHA-256 here before deleting the file. Either way, no audio is retained.
  await sealAudioDiscard(consultId, `scripted-demo:${consultId}`);
  await appendAudit({
    consultId,
    stage: "audio-discard",
    detail: "Raw audio discarded on sign. Only the signed note and audit log remain. 0 bytes transmitted.",
  });
}

/** Record an export action (FHIR/PDF/text) in the audit log. On-device artefact only. */
export async function recordExport(consultId: string, label: string): Promise<void> {
  await appendAudit({ consultId, stage: "export", detail: `${label} generated on-device` });
}

/** Mark the consult complete (final lifecycle state) after the complete screen loads. */
export async function markComplete(consultId: string): Promise<void> {
  await setConsultStatus(consultId, "complete");
}

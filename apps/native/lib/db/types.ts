// Canonical, source-of-truth domain types for the Sona on-device scribe.
// Every track (capture, redaction, note-gen, export, UI) imports these — do not
// redefine Consult / TranscriptSegment / ClinicalNote / AuditEntry elsewhere.
//
// On-device only: these types describe rows stored in the local SQLite DB
// (see ./index.ts). Raw audio, the raw transcript, and the re-identify map never
// leave the device (the re-ID map lives in secure storage, ../secure/reidMap.ts).

/**
 * Lifecycle stage of a consult. Mirrors the 6-screen demo flow:
 * consent → recording → redaction/privacy gate → note review → signed → complete.
 */
export type ConsultStatus =
  | "consented"
  | "recording"
  | "transcribed"
  | "redacted"
  | "noted"
  | "signed"
  | "complete";

/** How the patient arrived — shown on the consult card. */
export type VisitType = "walk-in" | "appointment";

/**
 * Optional patient context captured at consent. DEVICE-ONLY PHI (same posture as
 * the raw transcript): stored in local SQLite, shown to the clinician, and never
 * included in the de-identified model input or any export.
 */
export interface PatientDetails {
  patientName: string | null;
  patientPhone: string | null;
  /** Consultation room / bed, e.g. "Room 3". */
  room: string | null;
  visitType: VisitType | null;
}

/** A single patient encounter. The top-level entity everything else hangs off. */
export interface Consult extends PatientDetails {
  id: string;
  /** Epoch millis when the consult (consent) was created. */
  createdAt: number;
  /** Epoch millis of the last mutation. */
  updatedAt: number;
  status: ConsultStatus;
  /** Free-text label shown in lists, e.g. "GP follow-up". Never PII in the demo. */
  title: string;
  /** Verbatim consent line recorded at start, written to the audit log too. */
  consentText: string;
  /**
   * SHA-256 hash of the captured audio, sealed on sign. The audio file itself is
   * deleted on sign — only this hash is retained as tamper-evidence. Null until sealed.
   */
  audioHash: string | null;
  /** Epoch millis when the clinician signed. Null until signed. */
  signedAt: number | null;
}

/** Which voice a transcript segment belongs to. */
export type Speaker = "doctor" | "patient" | "unknown";

/**
 * One streamed/segmented chunk of the on-device STT transcript. This is the RAW
 * (pre-redaction) transcript and never leaves the device.
 */
export interface TranscriptSegment {
  id: string;
  consultId: string;
  /** Monotonic ordering within a consult (0-based). */
  seq: number;
  speaker: Speaker;
  text: string;
  /** Audio offset of this segment start, in millis from record start. */
  startMs: number;
  /** Audio offset of this segment end, in millis from record start. */
  endMs: number;
  /** STT confidence 0..1, when the engine provides it. */
  confidence: number | null;
}

/** One order / follow-up line extracted for the note's "Orders & follow-ups". */
export interface NoteOrder {
  /** review | test | safety-net | medication | other. */
  kind: "review" | "test" | "safety-net" | "medication" | "other";
  text: string;
}

/**
 * The generated (and clinician-editable) SOAP note. Stored re-identified for the
 * clinician's on-device view; only de-identified text is ever fed to the model
 * upstream. The `deidentified` flag records which form is persisted in `soap`.
 */
export interface ClinicalNote {
  id: string;
  consultId: string;
  createdAt: number;
  updatedAt: number;
  /** SOAP sections. */
  soap: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
  };
  /** Structured orders & follow-ups (renders under Plan). */
  orders: NoteOrder[];
  /**
   * Present red-flag / danger symptoms the model tagged (hybrid highlighter). Drives
   * the red highlight in the rendered note; empty when the model emitted none. These
   * are symptom phrases only (no PII), safe to persist alongside the note.
   */
  redFlags: string[];
  /**
   * True while the note still contains redaction tokens (NAME_1, IC_1, …); false
   * once locally re-identified for the clinician view. Persisted so the UI knows
   * which form it is showing.
   */
  deidentified: boolean;
  /** True once the clinician has hand-edited the generated note. */
  edited: boolean;
}

/**
 * Pipeline stage an audit entry was emitted from. The append-only audit log is
 * the "0 bytes transmitted" / provenance evidence shown on the complete screen.
 */
export type AuditStage =
  | "consent"
  | "record-start"
  | "record-stop"
  | "transcribe"
  | "redact"
  | "note-generate"
  | "note-edit"
  | "sign"
  | "audio-discard"
  | "export"
  | "network-check"
  | "doc-attach"
  | "image-discard";

/** Lifecycle of a scanned document. review → saved (standalone) or attached (consult). */
export type ScannedDocStatus = "review" | "saved" | "attached";

/**
 * A scanned paper document (Smart Scan): referral letter, lab result, prescription…
 * Captured with the native document scanner, OCR'd on-device, de-identified with the
 * same redactor as the transcript. `rawText` is device-only PHI (like the raw
 * transcript); only `redactedText`/`summary` may ever cross the boundary. Page images
 * are DESTROYED the moment OCR completes — `imageUris` is persisted empty and exists
 * only as a defensive seam (sign-time discard sweeps any stragglers from old rows).
 */
export interface ScannedDocument {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Linked consult, or null for a standalone document note. Signed consults never accept new docs. */
  consultId: string | null;
  /** PII-free list label, e.g. "Lab result · 2 pages". */
  title: string;
  /** Keyword-classified type: referral | lab-result | prescription | discharge | other. */
  docType: string;
  /** Page count at capture (images may be discarded later). */
  pages: number;
  /** Local page-image URIs; emptied on discard. Never leave the device. */
  imageUris: string[];
  /** Raw OCR text — device-only, never transmitted. */
  rawText: string;
  /** De-identified text (DOC_-namespaced tokens) — the only form that may cross the boundary. */
  redactedText: string;
  /** High-confidence identifiers redacted from the raw text. */
  identifiers: number;
  /** On-device AI summary (de-identified Markdown), or null before/without generation. */
  summary: string | null;
  status: ScannedDocStatus;
}

/** One append-only audit row. Never mutated after write. */
export interface AuditEntry {
  id: string;
  consultId: string;
  /** Epoch millis. */
  ts: number;
  stage: AuditStage;
  /** Human-readable detail, e.g. "de-identified text handed to note model". */
  detail: string;
}

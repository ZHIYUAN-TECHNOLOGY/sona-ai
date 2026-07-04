// Local types for the export module. These are defined here so the export
// functions stay pure and self-contained. When the persistence layer lands,
// reconcile SignedNote with the stored consult/note/signature rows (see the
// reconciliation notes in README/report). Keep this the single source of truth
// for the export boundary until then.

export interface Soap {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

// One order / follow-up line. Structurally compatible with lib/db NoteOrder so a
// ClinicalNote maps to a SignedNote without collapsing to a bare string (which
// would drop `kind` and, on an untyped boundary, render "[object Object]").
export interface ExportOrder {
  kind?: "review" | "test" | "safety-net" | "medication" | "other";
  text: string;
}

// A note that has been reviewed, re-identified locally, and signed by the
// clinician. Everything here is already re-identified (patientDisplayName is
// the real name, not a NAME_1 token) because export happens on-device after
// the re-ID step; nothing in this object should ever cross the network.
export interface SignedNote {
  consultId: string;
  patientDisplayName: string; // already re-identified locally
  clinicianName: string;
  mmcNo: string; // Malaysian Medical Council registration number
  signedAtISO: string; // ISO-8601 timestamp, e.g. 2026-07-05T09:30:00+08:00
  soap: Soap;
  orders: ExportOrder[]; // orders & follow-ups, structured (kind preserved)
}

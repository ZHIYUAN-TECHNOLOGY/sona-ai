import { effectivePatient, getPrescriptionChecks } from "@sona-ai/domain/prescribing";
import type { Encounter, NoteSections, Patient } from "@sona-ai/domain/types";

export type Sentence = { id: string; text: string };
export type VisitPatient = Omit<Patient, "time"> & { time?: string };
export type Row =Sentence & { label: string };

const SECTIONS: [keyof NoteSections, string][] = [
  ["subjective", "History"], ["objective", "Examination"], ["assessment", "Assessment"], ["plan", "Plan"],
];

/** The note as its four sections in order (empty where unwritten), then any other saved sentence, so a save never drops one. */
export function toRows(sentences: Sentence[]): Row[] {
  const byId = new Map(sentences.map(s => [s.id, s.text]));
  const keys = new Set<string>(SECTIONS.map(([id]) => id));
  return [
    ...SECTIONS.map(([id, label]) => ({ id, label, text: byId.get(id) ?? "" })),
    ...sentences.filter(s => !keys.has(s.id)).map(s => ({ ...s, label: "Other" })),
  ];
}

/** A pasted transcript as the draft's lines: one per non-empty line; "Doctor:" or "Patient:" at the start names the speaker. */
export function toLines(transcript: string) {
  return transcript.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
    const m = /^(doctor|dr|clinician|patient|pt)\s*:\s*(.+)$/i.exec(line);
    if (!m) return { text: line.slice(0, 4000) };
    return { text: m[2]!.slice(0, 4000), speaker: /^p/i.test(m[1]!) ? "patient" as const : "clinician" as const };
  });
}

/** The same checks the server runs before it writes a receipt, on the same record, so the page shows why an order is blocked. */
export function orderChecks(snapshot: { revision: number; state: object }, patient: VisitPatient) {
  const visit = { ...snapshot.state, revision: snapshot.revision } as Encounter;
  // `time` is the appointment's display time, which patients.list leaves out and no check reads.
  return getPrescriptionChecks(visit, effectivePatient({ time: "", ...patient, sources: patient.sources ?? [] }, visit));
}

/** The server's words for a refusal, with the checks it names as still open. */
export function refusal(error: unknown): { message: string; open: string[] } {
  const e = error as { message?: string; data?: { open?: string[] } } | null;
  return { message: e?.message ?? "Something went wrong. Try again.", open: e?.data?.open ?? [] };
}

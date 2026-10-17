import { appendSections, mergeMedicines, SCAN_SECTION_KEYS, type HandwrittenNote, type ScanMedicine, type ScanSections, type ScanTask } from "@sona-ai/domain/scan";
import { defaultMedications } from "@/features/encounter/clinical-state";
import type { Encounter, Patient, Task } from "@/features/encounter/types";
import { startingReply, wakingOf } from "@/features/live/waking";
import { readNoteSections, serializeNoteSections } from "@/features/scribe/model";

/**
 * Why a reading is not shown, in the judge build only. With no handwriting model answering, the server returns its
 * stand-in reading (source "fixture"), which is not this photo's words: there it is a failed read (with the wait,
 * when the model is starting) and nothing is offered for review. Elsewhere the stand-in shows, labelled a sample.
 */
export function unreadReason(judge: boolean, reading: { source: string; waking?: number }) {
  if (!judge || reading.source === "model") return undefined;
  const minutes = wakingOf(reading);
  return minutes ? startingReply(minutes) : "No handwriting model answered, so this photo was not read";
}

/** One reviewable item from a reading: a note section, a medicine, a task or the follow-up. */
export type ItemKey = `section:${keyof ScanSections}` | `med:${number}` | `task:${number}` | "followUp";
export type Kept = { sections: Partial<ScanSections>; medicines: ScanMedicine[]; tasks: ScanTask[]; followUp?: { in: string } };

/** Every item the reading offers (empty sections are not items); all start ticked. */
export function itemsOf(note: HandwrittenNote): ItemKey[] {
  return [
    ...SCAN_SECTION_KEYS.filter(k => note.sections[k].trim()).map(k => `section:${k}` as const),
    ...note.medicines.map((_, i) => `med:${i}` as const),
    ...note.tasks.map((_, i) => `task:${i}` as const),
    ...note.followUp ? ["followUp" as const] : [],
  ];
}

/** Only the ticked items, as scan.apply takes them (the doctor's edits are already in `note`). */
export function keptOf(note: HandwrittenNote, off: ReadonlySet<ItemKey>): Kept {
  return {
    sections: Object.fromEntries(SCAN_SECTION_KEYS.filter(k => note.sections[k].trim() && !off.has(`section:${k}`)).map(k => [k, note.sections[k]])),
    medicines: note.medicines.filter((_, i) => !off.has(`med:${i}`)),
    tasks: note.tasks.filter((_, i) => !off.has(`task:${i}`)),
    followUp: note.followUp && !off.has("followUp") ? note.followUp : undefined,
  };
}

/** The doctor's correction of an unsure word, everywhere it was read (sections and medicine lines). */
export function replaceWord(note: HandwrittenNote, word: string, to: string): HandwrittenNote {
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  const fix = (s: string) => s.replace(re, to);
  const fixOpt = (s?: string) => s === undefined ? s : fix(s);
  return {
    ...note,
    sections: { history: fix(note.sections.history), examination: fix(note.sections.examination), assessment: fix(note.sections.assessment), plan: fix(note.sections.plan) },
    medicines: note.medicines.map(m => ({ ...m, name: fix(m.name), dose: fixOpt(m.dose), frequency: fixOpt(m.frequency) })),
  };
}

/** What "Add to the record" will do, counted the way the done line says it. */
export const countsOf = (kept: Kept) => ({
  sections: Object.keys(kept.sections).length,
  medicines: kept.medicines.filter(m => m.change !== "continue").length,
  tasks: kept.tasks.length + (kept.followUp ? 1 : 0),
});

/**
 * Fixture mode's apply (live mode writes the same through scan.apply): sections appended to the note
 * draft (to save from the note screen), medicine changes as unconfirmed entries, and the tasks.
 */
export function applyLocally(encounter: Encounter, patient: Patient, kept: Kept, from: string, idPrefix: string): Encounter {
  const counts = countsOf(kept);
  let next = encounter;
  if (counts.sections) {
    const sections = appendSections(encounter.noteSectionDraft ?? encounter.noteSections ?? readNoteSections(encounter.note), kept.sections);
    next = { ...next, noteSectionDraft: sections, note: serializeNoteSections(sections), noteReviewed: false, noteSaveStatus: "idle" };
  }
  if (counts.medicines) next = { ...next, medicationEntries: mergeMedicines(encounter.medicationEntries ?? defaultMedications(patient), kept.medicines.filter(m => m.change !== "continue"), from) };
  const todo: Task[] = [
    ...kept.tasks.map(t => ({ title: t.title, owner: t.owner || "Attending doctor", due: t.due ?? "" })),
    ...kept.followUp ? [{ title: `Book follow-up in ${kept.followUp.in}`, owner: "Attending doctor", due: kept.followUp.in }] : [],
  ].map((t, i) => ({ ...t, id: `${idPrefix}-${i}`, completed: false, provenance: "clinician" as const }));
  if (todo.length) next = { ...next, tasks: [...next.tasks, ...todo] };
  return next;
}

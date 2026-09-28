import type { MedicationEntry, NoteSections } from "./types";

/**
 * "Scan a handwritten note": a photo of a ward-round note, drug chart or referral letter read into
 * the structured record. The reading is only ever a proposal: note sections are appended (never
 * replacing what the clinician wrote), medicine changes join reconciliation unconfirmed, and tasks
 * are created only when the doctor adds them. Shared by the server (scan.apply) and the app's
 * fixture mode, so both merge the same way.
 */
export type Confidence = "high" | "low";
export type MedicineChange = "new" | "changed" | "stopped" | "continue";
export type ScanSections = { history: string; examination: string; assessment: string; plan: string };
export type ScanMedicine = { name: string; dose?: string; frequency?: string; change: MedicineChange; confidence: Confidence };
export type ScanTask = { title: string; due?: string; owner?: string };
/**
 * What the handwriting model read. `lines` is the reading in order, split so each low-confidence word
 * is a run of its own (joined, they are `text`); those words are the ones to check against the photo.
 */
export type HandwrittenNote = {
  text: string;
  lines: { text: string; confidence: Confidence }[];
  sections: ScanSections;
  medicines: ScanMedicine[];
  tasks: ScanTask[];
  followUp?: { in: string };
};

export const SCAN_SECTION_KEYS = ["history", "examination", "assessment", "plan"] as const;
/** Where each scanned section lands in the consultation note. */
export const NOTE_KEY: Record<keyof ScanSections, keyof NoteSections> = { history: "subjective", examination: "objective", assessment: "assessment", plan: "plan" };

const run = (text: string, confidence: Confidence = "high") => ({ text, confidence });
const lines = [
  run("Ward round 29/9 · Amelia T. · bed 6\nHx: D6 cough. Fever settled overnight. Eating & drinking, less SOB.\nO/E: T 37.2 HR 88 RR 18 SpO2 97% RA. Few "),
  run("crepts", "low"),
  run(" R base.\nImp: CAP (RLL), improving. Pen allergy (rash).\nPlan: IV → PO clarithromycin 500 mg "),
  run("BD", "low"),
  run(", 7/7 total.\nRepeat CXR + FBC tmrw.\nSalbutamol PRN. TCA resp clinic 2/52."),
];

/**
 * The sample note (apps/native/assets/scan/sample-ward-note.png): a synthetic ward-round note for
 * Amelia, the demo patient. Clarithromycin, not co-amoxiclav, because her record lists a penicillin rash.
 */
export const SAMPLE_NOTE: HandwrittenNote = {
  text: lines.map(l => l.text).join(""),
  lines,
  sections: {
    history: "Day 6 of cough. Fever settled overnight. Eating and drinking, less short of breath.",
    examination: "T 37.2, HR 88, RR 18, SpO2 97% on room air. Few crepts at the right base.",
    assessment: "Community-acquired pneumonia (right lower lobe), improving. Penicillin allergy (rash).",
    plan: "Switch IV to oral clarithromycin 500 mg BD, 7 days in total. Repeat chest X-ray and FBC tomorrow. Salbutamol as needed. Review in respiratory clinic in 2 weeks.",
  },
  medicines: [{ name: "Clarithromycin", dose: "500 mg oral", frequency: "BD", change: "changed", confidence: "low" }],
  tasks: [{ title: "Repeat chest X-ray and FBC", due: "Tomorrow", owner: "Ward nurse" }],
  followUp: { in: "2 weeks" },
};

/** The words the model was unsure of (each its own run in `lines`). */
export const unsureWords = (note: Pick<HandwrittenNote, "lines">) => note.lines.filter(l => l.confidence === "low").map(l => l.text.trim()).filter(Boolean);

/** A section's text split around the unsure words, so the app can underline them. */
export function segments(text: string, unsure: string[]): { text: string; unsure: boolean }[] {
  const words = unsure.filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return text ? [{ text, unsure: false }] : [];
  return text.split(new RegExp(`\\b(${words.join("|")})\\b`)).filter(Boolean).map(part => ({ text: part, unsure: unsure.includes(part) }));
}

/** Appends each scanned section under what the note already says; a section left out is untouched. */
export function appendSections(current: NoteSections, add: Partial<ScanSections>): NoteSections {
  const next = { ...current };
  for (const key of SCAN_SECTION_KEYS) {
    const text = add[key]?.trim();
    if (text) next[NOTE_KEY[key]] = [current[NOTE_KEY[key]].trim(), text].filter(Boolean).join("\n");
  }
  return next;
}

const NOTE_KEYS = ["subjective", "objective", "assessment", "plan"] as const;
/** One sentence per written note section, keyed by the section, so a code or claim can cite it. */
export const noteSentences = (sections: NoteSections) => NOTE_KEYS.filter(key => sections[key].trim()).map(key => ({ id: key, text: sections[key].trim() }));
/** A saved note's sentences as sections; sentences the app did not write (the seeded note) are kept in the subjective section. */
export function noteSections(sentences: { id: string; text: string }[]): NoteSections {
  const sections: NoteSections = { subjective: "", objective: "", assessment: "", plan: "" };
  for (const s of sentences) {
    const key = NOTE_KEYS.find(k => k === s.id) ?? "subjective";
    sections[key] = [sections[key], s.text].filter(Boolean).join(key === s.id ? "\n" : " ");
  }
  return sections;
}

/** "Clarithromycin 500 mg oral BD". */
export const medicineLabel = (m: Pick<ScanMedicine, "name" | "dose" | "frequency">) => [m.name, m.dose, m.frequency].filter(Boolean).join(" ");
const ingredientOf = (name: string) => name.trim().split(/[\s,(]/)[0]!.toLowerCase();

/**
 * Medicine changes as unconfirmed reconciliation entries: a change to a medicine already listed
 * replaces that entry (unconfirmed again), anything else is added. "Continue" changes nothing.
 */
export function mergeMedicines(entries: MedicationEntry[], medicines: ScanMedicine[], from: string): MedicationEntry[] {
  const next = [...entries];
  for (const m of medicines) {
    if (m.change === "continue") continue;
    const ingredient = ingredientOf(m.name);
    const proposal = { name: medicineLabel(m), confirmed: false, change: m.change, from };
    const at = next.findIndex(e => e.ingredient.toLowerCase() === ingredient || ingredientOf(e.name) === ingredient);
    if (at >= 0) next[at] = { ...next[at]!, ...proposal };
    else next.push({ id: `scan-${ingredient}`, ingredient, formulation: /\b(iv|inj)/i.test(m.dose ?? "") ? "injection" : "tablet", ...proposal });
  }
  return next;
}

/** The done line: "Note updated · 1 medicine to confirm · 1 task added". */
export function scanDoneLine(done: { sections: number; medicines: number; tasks: number }) {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    done.sections && "Note updated",
    done.medicines && `${plural(done.medicines, "medicine", "medicines")} to confirm`,
    done.tasks && `${plural(done.tasks, "task", "tasks")} added`,
  ].filter(Boolean).join(" · ") || "Nothing added";
}

import type { DischargePlan } from "./discharge";
import type { FindingKind } from "./findings";

/**
 * Sona Care's words for the patient: the discharge plan and follow-ups without clinical shorthand.
 * ponytail: authored for the one demo plan (pneumonia on asthma); a model writes them per plan later.
 */
export type MedGroup = "new" | "changed" | "stopped" | "continue";
/** `take`: how to take one dose; `at`: daily times in Malaysia ("HH:MM"); `doses`: how many are left of a course (none = ongoing). As-needed medicines have no times. */
export type PatientMed = { name: string; line: string; take?: string; at?: string[]; doses?: number };

const MEDS: Record<string, { name?: string; line: string; take?: string; at?: string[]; doses?: number }> = {
  Azithromycin: { line: "Now a tablet once a day, for 2 more days", take: "1 tablet, with or without food", at: ["08:00"], doses: 2 },
  Paracetamol: { line: "For pain or fever: 1 g every 6 hours if you need it, no more than 4 g a day" },
  "Nebulised salbutamol": { name: "Salbutamol nebuliser", line: "Use your own inhaler instead, when you need it" },
  Cetirizine: { line: "Keep taking it as before", take: "1 tablet at night", at: ["21:00"] },
};

/** Take-home medicines grouped the way a patient reads a change: new, changed, stopped, carry on. */
export function patientMeds(plan: DischargePlan): Record<MedGroup, PatientMed[]> {
  const groups: Record<MedGroup, PatientMed[]> = { new: [], changed: [], stopped: [], continue: [] };
  for (const med of plan.meds) {
    const plain = MEDS[med.name];
    groups[med.change === "unchanged" ? "continue" : med.change].push({ name: plain?.name ?? med.name, line: plain?.line ?? med.detail, take: plain?.take, at: plain?.at, doses: plain?.doses });
  }
  return groups;
}

/** When to come back, from the leaflet plus the check-ins' urgent words (chest pain, fainting). */
export const WARNING_SIGNS = [
  "Breathing gets harder",
  "Your lips or fingertips turn blue",
  "The fever comes back",
  "Chest pain, or you feel faint",
];

const TESTS: [RegExp, { title: string; short: string }][] = [
  [/CT chest/i, { title: "CT scan of your chest", short: "CT scan" }],
  [/echocardiogram/i, { title: "Heart scan (echocardiogram)", short: "Heart scan" }],
  [/chest X-ray/i, { title: "Chest X-ray or ultrasound", short: "Chest X-ray" }],
];
const WHY: Record<FindingKind, string> = {
  nodule: "To check the small spot on your lung X-ray",
  cardiomegaly: "To check the size of your heart seen on your X-ray",
  effusion: "To check for fluid around your lung seen on your X-ray",
};

/** An appointment's kind ("clinic visit", "recall: CT chest") in plain words, with a short form for one-line rows. */
export function appointmentWords(kind: string, finding?: FindingKind) {
  const test = TESTS.find(([re]) => re.test(kind))?.[1];
  if (test) return { ...test, why: finding ? WHY[finding] : "A test your doctor asked for" };
  const name = kind.replace(/^recall:\s*/i, "");
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  return { title, short: title, why: finding ? WHY[finding] : "Your booked appointment" };
}

export type FollowUpStatus = "upcoming" | "due-soon" | "overdue";
const day = (d: Date) => Math.floor((d.getTime() + 8 * 3600_000) / 86_400_000);
/** Calendar days from today in Malaysia (negative once past), and the status: due soon within a week. */
export function followUpTiming(date: Date, now: Date): { inDays: number; status: FollowUpStatus } {
  const inDays = day(date) - day(now);
  return { inDays, status: inDays < 0 ? "overdue" : inDays <= 7 ? "due-soon" : "upcoming" };
}

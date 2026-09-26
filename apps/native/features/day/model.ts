import { testInSentence } from "@sona-ai/domain/handover";
import { defaultMedications } from "@/features/encounter/clinical-state";
import { demoTime } from "@/features/encounter/fixtures";
import type { Encounter, Patient, Task } from "@/features/encounter/types";

/**
 * "My day, ranked": today's visits, open follow-up tasks, a pending result and blockers found in
 * each visit, in one list ordered by urgency. Every item states why it sits where it does.
 *
 * ponytail: urgency is a transparent rule score over synthetic fixtures (results > blockers >
 * imminent visits > tasks). A model-ranked list replaces `score` when the backend exists; the
 * reason line stays mandatory so a ranking is never unexplained.
 */
export type DayTone = "urgent" | "soon" | "routine";
export type DayItem = {
  id: string; kind: "result" | "blocker" | "visit" | "task" | "check-in"; title: string; detail: string; reason: string; tone: DayTone; score: number;
  patientId?: string; open: { next?: string; view?: string };
};

// A synthetic lab result that arrived after Daniel's intake and has not been acted on.
export type PendingResult = { id?: string; patientId: string; test: string; value: string; flag: string; receivedAt: string };
export const PENDING_RESULT: PendingResult = { patientId: "SYN-1086", test: "Potassium", value: "3.1 mmol/L", flag: "Low", receivedAt: demoTime(-120) };
/** Keeps the demo result about two hours old when the demo schedule is refreshed. */
export { testInSentence };
export function refreshPendingResult(now = new Date()) { PENDING_RESULT.receivedAt = demoTime(-120, now); }

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h! * 60 + m!; };
/** Minutes from `now` to a clock time, taking the nearer side of midnight (00:15 is 30 min after 23:45, not a day before). */
const until = (hhmm: string, now: number) => ((minutes(hhmm) - now + 720) % 1440 + 1440) % 1440 - 720;
const ago = (from: number, now: number) => { const d = Math.max(0, now - from); return d < 60 ? `${d} min` : `${Math.floor(d / 60)} h`; };

/** `live` (live backend mode) replaces the fixture result and each visit's tasks with the server's. */
export function rankDay(patients: Patient[], encounters: Record<string, Encounter | undefined>, now: number, reviewed: Set<string> = new Set(),
  live?: { result: PendingResult | undefined; tasksOf: (patient: Patient) => Task[] }): DayItem[] {
  const items: DayItem[] = [];
  const result = live ? live.result : PENDING_RESULT;
  const resultPatient = result && patients.find(p => p.id === result.patientId);
  if (result && resultPatient && !reviewed.has("result")) items.push({
    id: "result", kind: "result", title: `${result.flag} ${testInSentence(result.test)} · ${resultPatient.name}`, detail: `${result.test} ${result.value}`,
    reason: `${result.flag} result · ${ago(minutes(result.receivedAt), now)} · no action yet`, tone: "urgent", score: 100, patientId: resultPatient.id, open: { next: "briefing" },
  });
  for (const patient of patients) {
    const encounter = encounters[patient.id];
    const start = until(patient.time, now);
    if (!patient.incomplete) {
      const unconfirmed = (encounter?.medicationEntries ?? defaultMedications(patient)).filter(entry => !entry.confirmed).length;
      if (unconfirmed) items.push({
        id: `blocker-${patient.id}`, kind: "blocker", title: `Confirm ${patient.name.split(" ")[0]}’s medicines`, detail: patient.medicines.join(" · "),
        reason: `${unconfirmed} unconfirmed · blocks prescribing`, tone: "soon", score: 70, patientId: patient.id, open: { next: "medication" },
      });
    }
    const started = Boolean(encounter?.requests.length);
    items.push({
      id: `visit-${patient.id}`, kind: "visit", title: `${patient.time} · ${patient.name}`, detail: patient.subtitle,
      reason: started ? "In progress" : start < -10 ? `Running ${ago(minutes(patient.time), now)} late` : start <= 0 ? "Due now" : start <= 30 ? `Starts in ${start} min` : patient.incomplete ? "History incomplete · allow extra time" : `Starts at ${patient.time}`,
      tone: !started && start <= 15 ? "soon" : "routine", score: started ? 40 : Math.max(20, 80 - Math.max(0, start)), patientId: patient.id, open: {},
    });
    for (const task of (live ? live.tasksOf(patient) : encounter?.tasks ?? []).filter(t => !t.completed)) items.push({
      id: `task-${task.id}`, kind: "task", title: task.title, detail: `${patient.name} · ${task.owner || "Unassigned"}`,
      reason: task.due ? `Due ${task.due}` : "No due date", tone: "routine", score: 30, patientId: patient.id, open: { view: "tasks" },
    });
  }
  return items.sort((a, b) => b.score - a.score);
}

/**
 * Visits whose pins would overlap on the ruler share one pin. A visit joins the current group when
 * it starts before that group's pin ends; `span` gives a group's pin width in minutes (it grows
 * with the group, so a wide "4 patients" pin also absorbs a visit a little later).
 */
export function groupVisits<T extends { at: number }>(visits: T[], span: (group: T[]) => number): T[][] {
  const groups: T[][] = [];
  for (const visit of [...visits].sort((a, b) => a.at - b.at)) {
    const last = groups.at(-1);
    if (last && visit.at < last[0]!.at + span(last)) last.push(visit); else groups.push([visit]);
  }
  return groups;
}

/**
 * Other days (a week around today). Today uses the live visits; the rest is an authored synthetic
 * clinic list, so a doctor can look back at completed visits and ahead at what to prepare.
 * Weekends are empty. ponytail: fixed demo schedule; the hospital scheduling feed replaces it.
 */
export type ScheduleVisit = { id: string; name: string; initials: string; time: string; reason: string; incomplete: boolean; patientId?: string };
const OTHER: [string, string, string, boolean][] = [
  ["Siti Aminah", "SA", "Diabetes review", false], ["Lim Wei Jie", "LW", "Post-op check", false], ["Ravi Kumar", "RK", "Heart failure follow-up", true],
  ["Nur Aisyah", "NA", "Asthma action plan", false], ["Tan Mei Ling", "TM", "Blood pressure review", false], ["Arjun Pillai", "AP", "New referral · history to take", true],
];
export const DAY_OFFSETS = [-3, -2, -1, 0, 1, 2, 3] as const;
export function dayOf(offset: number, today = new Date()) { const d = new Date(today); d.setDate(d.getDate() + offset); return d; }
export function scheduleFor(offset: number, patients: Patient[], today = new Date()): ScheduleVisit[] {
  if (offset === 0) return patients.map(p => ({ id: p.id, name: p.name, initials: p.initials, time: p.time, reason: p.subtitle, incomplete: p.incomplete, patientId: p.id }));
  const day = dayOf(offset, today).getDay();
  if (day === 0 || day === 6) return [];
  const mod = (n: number, k: number) => ((n % k) + k) % k;
  const count = 2 + mod(offset, 3);
  return Array.from({ length: count }, (_, i) => {
    const [name, initials, reason, incomplete] = OTHER[mod(i + offset, OTHER.length)]!;
    const m = 9 * 60 + i * 75 + mod(offset, 2) * 30;
    return { id: `d${offset}-${i}`, name, initials, reason, incomplete, time: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` };
  });
}
/** A past day lists what was seen; a future day lists what to prepare. */
export function rankOtherDay(offset: number, visits: ScheduleVisit[]): DayItem[] {
  return visits.map((v, i) => ({
    id: `other-${v.id}`, kind: "visit" as const, title: `${v.time} · ${v.name}`, detail: v.reason,
    reason: offset < 0 ? "Seen · note signed" : v.incomplete ? "Prepare · history to take" : "Prepare · review notes", tone: offset > 0 && v.incomplete ? "soon" as const : "routine" as const,
    score: offset > 0 && v.incomplete ? 60 - i : 40 - i, patientId: v.patientId, open: {},
  })).sort((a, b) => b.score - a.score);
}

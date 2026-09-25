import { defaultMedications } from "@/features/encounter/clinical-state";
import type { Encounter, Patient } from "@/features/encounter/types";

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
  id: string; kind: "result" | "blocker" | "visit" | "task"; title: string; detail: string; reason: string; tone: DayTone; score: number;
  patientId: string; open: { next?: string; view?: string };
};

// A synthetic lab result that arrived after Daniel's intake and has not been acted on.
export const PENDING_RESULT = { patientId: "SYN-1086", test: "Potassium", value: "3.1 mmol/L", flag: "Low", receivedAt: "08:40" };

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h! * 60 + m!; };
const ago = (from: number, now: number) => { const d = Math.max(0, now - from); return d < 60 ? `${d} min` : `${Math.floor(d / 60)} h`; };

export function rankDay(patients: Patient[], encounters: Record<string, Encounter | undefined>, now: number, reviewed: Set<string> = new Set()): DayItem[] {
  const items: DayItem[] = [];
  const result = PENDING_RESULT;
  const resultPatient = patients.find(p => p.id === result.patientId);
  if (resultPatient && !reviewed.has("result")) items.push({
    id: "result", kind: "result", title: `${result.flag} ${result.test.toLowerCase()} · ${resultPatient.name}`, detail: `${result.test} ${result.value}`,
    reason: `${result.flag} result · ${ago(minutes(result.receivedAt), now)} · no action yet`, tone: "urgent", score: 100, patientId: resultPatient.id, open: { next: "briefing" },
  });
  for (const patient of patients) {
    const encounter = encounters[patient.id];
    const start = minutes(patient.time) - now;
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
    for (const task of encounter?.tasks.filter(t => !t.completed) ?? []) items.push({
      id: `task-${task.id}`, kind: "task", title: task.title, detail: `${patient.name} · ${task.owner || "Unassigned"}`,
      reason: task.due ? `Due ${task.due}` : "No due date", tone: "routine", score: 30, patientId: patient.id, open: { view: "tasks" },
    });
  }
  return items.sort((a, b) => b.score - a.score);
}

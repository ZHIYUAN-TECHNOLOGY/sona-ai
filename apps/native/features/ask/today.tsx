import { useEncounter } from "@/features/encounter/store";
import { defaultMedications } from "@/features/encounter/clinical-state";
import { flagsFor } from "@/features/encounter/patient-sheet";
import { useDayPatients } from "@/features/encounter/quick-actions";
import { useLive } from "@/features/live";
import { useVisitTasks } from "@/features/live/server-day";
import { dueGroup } from "@/features/tasks/counts";
import { wardBeds } from "@/features/ward/model";
import { needsYou, overdue, soonest, type Answer } from "./answers";

/** Today's answers, from the same rules as the Patients, Tasks and Ward pages: who needs you, what's overdue, who can go home. */
export function useTodayAnswers(): Answer[] {
  const { patients, encounters } = useEncounter();
  const tasksOf = useVisitTasks();
  const { on: live } = useLive();
  const day = useDayPatients(patients);
  const needs = patients.flatMap(p => {
    const [flag] = flagsFor(p, (encounters[p.id]?.medicationEntries ?? defaultMedications(p)).filter(m => !m.confirmed).length);
    return flag ? [{ id: p.id, title: p.name, detail: flag.label, tone: flag.tone === "urgent" ? "urgent" as const : "soon" as const, op: `open:${p.id}` }] : [];
  }).sort((a, b) => Number(b.tone === "urgent") - Number(a.tone === "urgent"));
  const tasks = patients.flatMap(p => tasksOf(p).filter(t => !t.completed).map(t => ({ id: t.id, patientId: p.id, patientName: p.name, title: t.title, owner: t.owner, due: t.due, group: dueGroup(t.due) })));
  return [needsYou(needs), overdue(tasks, !live), soonest(wardBeds(day, encounters))];
}

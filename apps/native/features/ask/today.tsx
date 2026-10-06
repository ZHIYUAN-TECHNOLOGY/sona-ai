import { useEncounter } from "@/features/encounter/store";
import { useNeedsYou, useWardBeds } from "@/features/day/use-counts";
import { useLive } from "@/features/live";
import { useVisitTasks } from "@/features/live/server-day";
import { dueGroup } from "@/features/tasks/counts";
import { needsYou, overdue, soonest, type Answer } from "./answers";

/** Today's answers, from the same rules as the Patients, Tasks and Ward pages (day/counts): who needs you, what's overdue, who can go home. */
export function useTodayAnswers(): Answer[] {
  const { patients } = useEncounter();
  const tasksOf = useVisitTasks();
  const { on: live } = useLive();
  // Someone the app has no visit for (a Sona Care message from outside the roster) is listed but not opened.
  const needs = useNeedsYou().map(({ id, who, patient, flag }) => ({ id, title: who, detail: flag.label, tone: flag.tone === "urgent" ? "urgent" as const : "soon" as const, ...patient ? { op: `open:${patient.id}` } : {} }));
  const tasks = patients.flatMap(p => tasksOf(p).filter(t => !t.completed).map(t => ({ id: t.id, patientId: p.id, patientName: p.name, title: t.title, owner: t.owner, due: t.due, group: dueGroup(t.due) })));
  return [needsYou(needs), overdue(tasks, !live), soonest(useWardBeds())];
}

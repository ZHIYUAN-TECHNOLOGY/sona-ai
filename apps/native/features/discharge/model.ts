import { TYPICAL_WAIT_MINUTES, dischargeTasks, type DischargePlan, type DischargeState } from "@sona-ai/domain/discharge";
import type { Patient, Task } from "@/features/encounter/types";

export * from "@sona-ai/domain/discharge";

/** When a discharged patient became fit: the stored saving was counted from it, so it reads back; unknown when nothing was saved. */
export const fitAtOf = (state: DischargeState) => state.dischargedAt && state.savedMinutes
  ? new Date(new Date(state.dischargedAt).getTime() - (TYPICAL_WAIT_MINUTES - state.savedMinutes) * 60000) : undefined;

/** The discharge's follow-up tasks on the visit's list: this device's copies (same IDs) or the server's (same titles). */
export const followUpsOf = (tasks: Task[], patient: Patient, state: DischargeState, plan: DischargePlan) => {
  const made = dischargeTasks(patient, state, plan, new Date());
  return tasks.filter(t => made.some(m => m.id === t.id || m.title === t.title));
};

/** The days Sona Care checks in on: the visit's scheduled check-ins (the server may add a day), else this discharge's pick. */
export function checkInDaysFor(checkIns: { encounterId: string; day: number }[], encounterId: string, picked: number[]) {
  const days = checkIns.filter(c => c.encounterId === encounterId).map(c => c.day).sort((a, b) => a - b);
  return days.length ? days : picked;
}

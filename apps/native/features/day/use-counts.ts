import { useEncounter } from "@/features/encounter/store";
import type { Patient } from "@/features/encounter/types";
import { JUDGE, useLive } from "@/features/live";
import { useDemoOffset } from "@/features/live/demo-clock";
import { useFindings } from "@/features/live/findings-sync";
import { useServerData, useServerDay } from "@/features/live/server-day";
import { useServerBeds } from "@/features/live/ward-sync";
import { dayVisits } from "@/features/patients/record";
import { localDate } from "@/features/tasks/state";
import { wardBeds } from "@/features/ward/model";
import { needsYou, openTaskCount, patientResult, pendingResult, withFindingBlockers } from "./counts";

/** The hooks every page reads its counts through (the rules are in `counts.ts`). "Now" is the hospital's demo clock in live mode, as on Today. */

/**
 * Today's visits: in live mode at the server's appointment times, else the fixtures. In the judge build undefined
 * until the server's day arrives, so a count shows no number meanwhile and never the whole roster's (dayVisits).
 */
export function useDay(patients: Patient[]) {
  const server = useServerData();
  const offset = useDemoOffset();
  const today = useServerDay(server ? localDate(new Date(Date.now() + offset)) : undefined);
  return dayVisits(JUDGE, patients, today);
}

/** Today's visits as a list (see useDay); the judge build's is empty until the server's day arrives. */
export const useDayPatients = (patients: Patient[]) => useDay(patients) ?? [];

/**
 * The result waiting on a doctor, gone once acknowledged (on the server, or here in demo mode). With a
 * patient, that patient's newest waiting result, the same one their briefing leads with.
 */
export function usePendingResult(patientId?: string) {
  const server = useServerData();
  const { on } = useLive();
  const { resultAcks } = useEncounter();
  const offset = useDemoOffset();
  // Live mode before the server's results arrive: nothing yet, never the demo's fixture.
  if (on && !server) return undefined;
  if (!patientId) return pendingResult(server, resultAcks);
  const mine = patientResult(patientId, server, resultAcks, new Date(Date.now() + offset));
  return mine && !mine.ack ? mine.result : undefined;
}

/**
 * Every bed, and whether live mode is still reading them: the server's in live mode (one read shared by every
 * caller), none until it arrives and never the demo's fixture, so the ward's list never swaps the fixture's rows
 * for the server's under the eye; else the authored ward with the X-ray's open findings on Bed 6.
 */
export function useWard() {
  const { patients, encounters } = useEncounter();
  const { findings, live } = useFindings();
  const server = useServerBeds(findings);
  return live ? { beds: server ?? [], loading: !server } : { beds: withFindingBlockers(wardBeds(patients, encounters), findings), loading: false };
}

/** Every bed (see useWard). */
export const useWardBeds = () => useWard().beds;

/** The patients who need you, each with the most urgent reason. */
export function useNeedsYou() {
  const { patients, encounters } = useEncounter();
  return needsYou(patients, encounters, usePendingResult());
}

/** Open follow-ups: one visit's, or every visit's (the Tasks page's list, server tasks included in live mode). */
export function useOpenTasks(patient?: Patient) {
  const { patients, encounters } = useEncounter();
  return openTaskCount(patient ? [patient] : patients, encounters, useServerData());
}

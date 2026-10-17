import { useMemo } from "react";
import { useLive } from "@/features/live";
import { useServerPatients } from "@/features/live/patients-sync";
import { useServerBeds } from "@/features/live/ward-sync";
import { serverRows } from "./census";

/**
 * Connected mode's patient list beyond the visits this app opens (`open`): everyone else the hospital
 * record holds (patients.list), each at their bed (ward.beds); see serverRows. The judge build passes
 * nobody, for a row per person (rosterRows). Undefined when not connected, so the caller keeps its
 * sample-mode list; empty until the server answers, never a sample.
 */
export function useServerCensus(open: { id: string }[]) {
  const { on } = useLive();
  const people = useServerPatients();
  const beds = useServerBeds();
  // The visit store hands a new array each render: the ids are what the rows depend on.
  const ids = open.map(p => p.id).join(",");
  return useMemo(() => (on ? serverRows(Object.values(people ?? {}), beds ?? [], new Set(ids.split(","))) : undefined), [on, people, beds, ids]);
}

import { useSyncExternalStore } from "react";
import { readNoteSections } from "@/features/scribe/model";
import { useEncounter } from "@/features/encounter/store";
import type { Encounter, Patient } from "@/features/encounter/types";
import { continueList, planPin, replacePin, whatIsLeft, type Entry, type Pin } from "./continue";

/**
 * This session's Continue state: pins, when each visit was last touched, and the large-census demo
 * switch. Session-only, like the encounters it describes. A finished visit (nothing left) leaves
 * Continue by itself, so there is nothing to close by hand.
 */
type State = { pins: Pin[]; touched: Record<string, number>; census: boolean };
let state: State = { pins: [], touched: {}, census: false };
const started = Date.now();
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useContinueState = () => useSyncExternalStore(subscribe, () => state);

/** Working on a visit keeps it in Continue for the next 24 h. */
export const touch = (id: string) => set({ touched: { ...state.touched, [id]: Date.now() } });
export const setCensus = (census: boolean) => set({ census });
export const unpin = (id: string) => set({ pins: state.pins.filter(p => p.id !== id) });
/** Pin a patient; at the cap, returns the oldest pin for the caller to offer replacing (`replaceOldest`). */
export function pin(id: string): Pin | undefined {
  const plan = planPin(state.pins, id, Date.now());
  if ("pins" in plan) { set({ pins: plan.pins }); return undefined; }
  return plan.replace;
}
export const replaceOldest = (oldest: string, id: string) => set({ pins: replacePin(state.pins, oldest, id, Date.now()) });

const hasNote = (e: Encounter) => Object.values(e.noteSectionDraft ?? e.noteSections ?? readNoteSections(e.note)).some(v => String(v).trim().length > 0);
export const leftOn = (e: Encounter) => whatIsLeft({ answers: e.requests.length, hasNote: hasNote(e), noteReviewed: e.noteReviewed, recording: e.recording });

/** Continue for this clinician, with each entry's patient; `toSign` counts draft notes waiting for review (the wrap-up line). */
export function useContinue() {
  const { patient, patients, encounters } = useEncounter();
  const s = useContinueState();
  const worked = patients.filter(p => encounters[p.id]?.requests.length);
  const startedVisits = worked.map(p => ({ id: p.id, lastAt: s.touched[p.id] ?? started, left: leftOn(encounters[p.id]!) }));
  const entries = continueList({ current: patient?.id, pins: s.pins, started: startedVisits, now: Date.now() })
    .flatMap(e => { const p = patients.find(x => x.id === e.id); return p ? [{ ...e, patient: p, answers: encounters[p.id]?.requests.length ?? 0 }] : []; });
  const toSign = startedVisits.filter(v => v.left === "Draft note to sign").length;
  return { entries, toSign, pins: s.pins };
}
export type ContinueEntry = Entry & { patient: Patient; answers: number };

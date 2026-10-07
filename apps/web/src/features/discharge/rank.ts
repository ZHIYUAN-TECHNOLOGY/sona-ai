import { type Bed, type BedKind, bedKind } from "@sona-ai/domain/ward";

type WardBed = Pick<Bed, "bed" | "patientId" | "name" | "status" | "blockers">;
export type Standing = { kind: BedKind; bed: string; blockers: Bed["blockers"] };

/** Where each admitted patient stands for discharge, by patient id, counted as the ward counts (bedKind). */
export const standings = (beds: WardBed[]) =>
  new Map(beds.flatMap(b => (b.patientId ? [[b.patientId, { kind: bedKind(b), bed: b.bed, blockers: b.blockers }] as [string, Standing]] : [])));

export const countOf = (by: Map<string, Standing>, kind: BedKind) => [...by.values()].filter(s => s.kind === kind).length;

/** Ready to go first, then blocked (the fewest blockers first: closest to going home), on watch, then the rest. */
export function dischargeRank(s?: Standing): number {
  if (!s) return 40;
  return s.kind === "fit" ? 0 : s.kind === "blocked" ? 10 + Math.min(s.blockers.length, 9) : s.kind === "watch" ? 20 : 30;
}

/** The patient's guarantee-letter blocker, when the letter is what holds their bed. */
export const letterHold = (s?: Standing) => s?.blockers.find(b => b.kind === "gl");

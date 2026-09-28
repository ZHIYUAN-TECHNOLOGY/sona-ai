import type { Bed } from "@sona-ai/domain/ward";

export * from "@sona-ai/domain/ward";

/** A bed's place on the ward bar: blocked (fit but held) leads, then fit to go, watch, and the rest. */
export type BedKind = "blocked" | "fit" | "watch" | "other";
const ORDER: BedKind[] = ["blocked", "fit", "watch", "other"];
const LABEL: Record<BedKind, string> = { blocked: "blocked", fit: "fit to go", watch: "watch", other: "other" };

export const bedKind = (b: Bed): BedKind =>
  b.status === "fit" && b.name ? (b.blockers.length ? "blocked" : "fit") : b.status === "watch" ? "watch" : "other";

/** One segment per bed (grouped in ORDER), the legend's non-empty counts, and one spoken summary. */
export function bedBar(beds: Bed[]) {
  const kinds = beds.map(bedKind);
  const segments = ORDER.flatMap(k => kinds.filter(x => x === k));
  const legend = ORDER.map(kind => ({ kind, label: LABEL[kind], count: kinds.filter(x => x === kind).length })).filter(l => l.count);
  const label = `${beds.length} beds: ${legend.map(l => `${l.count} ${l.label}`).join(", ")}`;
  return { segments, legend, label };
}

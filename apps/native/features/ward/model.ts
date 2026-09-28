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

/** The ward's filter: every bed, or one kind that needs something. "other" beds only show under all. */
export type WardFilter = "all" | Exclude<BedKind, "other">;
const FILTERS: WardFilter[] = ["all", "blocked", "fit", "watch"];
const FILTER_LABEL: Record<WardFilter, string> = { all: "All", blocked: "Blocked", fit: "Fit to go", watch: "Watch" };
const count = (beds: Bed[], kind: BedKind) => beds.filter(b => bedKind(b) === kind).length;

/** A route param read as a filter ("other" opens all); anything else is no filter. */
export const asFilter = (x: unknown): WardFilter | undefined => x === "other" ? "all" : (FILTERS as unknown[]).includes(x) ? x as WardFilter : undefined;

/** Blocked first when anything is blocked (the one to act on), else every bed. */
export const defaultFilter = (beds: Bed[]): WardFilter => count(beds, "blocked") ? "blocked" : "all";

/** Segments with their counts; empty kinds drop out, except the selected one (so its empty line can show). */
export const filterSegments = (beds: Bed[], selected: WardFilter) =>
  FILTERS.map(key => ({ key, label: FILTER_LABEL[key], count: key === "all" ? beds.length : count(beds, key) }))
    .filter(s => s.key === "all" || s.count || s.key === selected);

/** The beds under a filter, in bar order (blocked, fit, watch, other). */
export const filterBeds = (beds: Bed[], filter: WardFilter) =>
  ORDER.flatMap(k => beds.filter(b => bedKind(b) === k)).filter(b => filter === "all" || bedKind(b) === filter);

const bedsAre = (n: number) => n === 1 ? "1 bed is" : `${n} beds are`;
/** One calm line for an empty filter, pointing at what is there instead. */
export function emptyLine(beds: Bed[], filter: WardFilter) {
  const fit = count(beds, "fit"), blocked = count(beds, "blocked");
  if (filter === "blocked") return `Nothing blocked.${fit ? ` ${bedsAre(fit)} fit to go.` : ""}`;
  if (filter === "fit") return `Nobody fit to go yet.${blocked ? ` ${bedsAre(blocked)} blocked.` : ""}`;
  if (filter === "watch") return "Nobody on watch.";
  return "No beds on this ward yet.";
}

/** A bed's list row: "Bed 2 · Nurul", when it frees up, and (fit beds) what holds it or "Ready". */
export function bedRow(b: Bed) {
  const kind = bedKind(b), n = b.blockers.length;
  return {
    kind,
    title: `${b.bed} · ${b.name ? b.name.split(" ")[0] : "No patient"}`,
    when: b.status === "fit" && b.name ? `Out ${b.predicted.toLowerCase()}` : b.predicted,
    flag: kind === "blocked" ? `${n} ${n === 1 ? "blocker" : "blockers"}` : kind === "fit" ? "Ready" : undefined,
  };
}

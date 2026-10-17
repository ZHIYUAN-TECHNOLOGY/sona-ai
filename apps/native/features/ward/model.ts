import { bedKind, clockLabel, type Bed, type BedForecast, type BedKind, type Owner } from "@sona-ai/domain/ward";
import { hhmm } from "@/features/tasks/state";

export * from "@sona-ai/domain/ward";

/** The ward bar's order: blocked (fit but held) leads, then fit to go, watch, and the rest. Kinds are the domain's one rule (bedKind). */
const ORDER: BedKind[] = ["blocked", "fit", "watch", "other"];
const LABEL: Record<BedKind, string> = { blocked: "blocked", fit: "fit to go", watch: "watch", other: "other" };

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

/** Who was told once a blocker takes (or loses) an owner: "Billing notified · 14:05"; demo mode says it was simulated. */
export const ownerReceipt = (owner: Owner | undefined, at: Date, simulated: boolean) =>
  `${owner ? `${owner} notified` : "Owner cleared"} · ${hhmm(at)}${simulated ? " · simulated, nothing sent" : ""}`;

const HOUR = 3_600_000, SPAN = 3;
/**
 * The forecast's next 24 h as eight 3-hour windows from the hour it is now ("Now", then "3 pm", "6 pm", …): each
 * window's beds (a bed free already counts in Now) and the most urgent kind among them (bar order), for the ward's chart.
 */
export function freeingWindows(f: BedForecast, beds: Bed[]) {
  const start = Math.floor(new Date(f.now).getTime() / HOUR) * HOUR;
  const kindOf = (id: string) => { const b = beds.find(x => x.bed === id); return b ? bedKind(b) : "other"; };
  return Array.from({ length: 24 / SPAN }, (_, i) => {
    const from = start + i * SPAN * HOUR, to = from + SPAN * HOUR;
    const entries = f.timeline.filter(e => { const t = new Date(e.at).getTime(); return t < to && (i === 0 || t >= from); });
    const kinds = entries.map(e => kindOf(e.bed));
    return { label: i ? clockLabel(new Date(from)) : "Now", from: new Date(from), to: new Date(to), entries, kind: ORDER.find(k => kinds.includes(k)) ?? "other" };
  });
}

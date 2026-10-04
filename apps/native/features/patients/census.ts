/**
 * The patient list at any census size (docs/design-direction.md, "At scale"): nothing lists everyone
 * by default. Views carry counts, "Needs you" groups rows by urgency with the large groups folded,
 * and "All" is A–Z. Pure; the Patients screen renders `listItems` in one virtualised list.
 */
import { bedKind, type Bed } from "@sona-ai/domain/ward";

export type Group = "needs" | "next" | "waiting" | "done";
export type Tone = "urgent" | "soon" | "good" | "calm";
/** One patient row. `open` is false for rows with no visit to open here: the synthetic census, and in connected mode the ward's other patients (serverRows). */
export type Row = { id: string; name: string; initials: string; where: string; group: Group; reason: string; tone: Tone; mine: boolean; ward: boolean; clinic: boolean; open: boolean };
export type View = "needs" | "continue" | "mine" | "ward" | "clinic" | "all";
export type Item =
  | { key: string; kind: "header"; title: string; count: number }
  | { key: string; kind: "row"; row: Row }
  | { key: string; kind: "more"; group: Group; hidden: number };

/** Urgency groups, most urgent first, with how many rows each shows before "Show more" (0: folded). */
export const GROUPS: { id: Group; title: string; shown: number }[] = [
  { id: "needs", title: "Needs you now", shown: 6 },
  { id: "next", title: "Next hour", shown: 3 },
  { id: "waiting", title: "Waiting", shown: 0 },
  { id: "done", title: "Done today", shown: 0 },
];
const RANK: Record<Group, number> = { needs: 0, next: 1, waiting: 2, done: 3 };
const TONE_RANK: Record<Tone, number> = { urgent: 0, soon: 1, good: 2, calm: 3 };
/** Most urgent group first; inside a group, red before amber, then by time or bed (Bed 2 before Bed 12). */
const byUrgency = (a: Row, b: Row) => RANK[a.group] - RANK[b.group] || TONE_RANK[a.tone] - TONE_RANK[b.tone] || a.where.localeCompare(b.where, undefined, { numeric: true });

/**
 * Connected mode's rows for everyone the hospital record holds beyond the visits this app opens
 * (`open`): each person from the server's patient list, at their bed from the server's ward. They wait
 * (a held discharge belongs to the blocker's owner on the Ward page, so "Needs you" still counts what
 * Today counts): amber when fit but held, green when fit and ready, the reason they are in otherwise.
 * Sample visits in connected mode: listed, not opened (the visit store there holds the two demo visits).
 * The judge build opens them: its store takes the server's roster, and `rosterRows` joins the two lists.
 */
export function serverRows(
  people: { id: string; name: string; initials: string; complaint: string }[],
  beds: { patientId?: string; bed: string; status: Bed["status"]; name?: string; blockers: unknown[] }[],
  open: ReadonlySet<string>,
): Row[] {
  return people.filter(p => !open.has(p.id)).map(p => {
    const bed = beds.find(b => b.patientId === p.id), kind = bed ? bedKind(bed) : "other", n = bed?.blockers.length ?? 0;
    const why = p.complaint.replace(/\.$/, "");
    const [reason, tone]: [string, Tone] = kind === "blocked" ? [`${n} ${n === 1 ? "blocker" : "blockers"} · ${why}`, "soon"] : kind === "fit" ? [`Fit to go · ${why}`, "good"] : [why, "calm"];
    return { id: p.id, name: p.name, initials: p.initials, where: bed?.bed ?? "", group: "waiting", reason, tone, mine: false, ward: Boolean(bed), clinic: false, open: false };
  });
}

/**
 * The judge build's list: one row for each person on the hospital record (`ward`: serverRows for everyone).
 * Someone the Patients page ranks from their visit (they need you, are booked today or are being seen: `visits`)
 * keeps that row, and joins the ward tab when they hold a bed, so the tab and the Ward page count the same
 * people. Everyone else keeps the ward's row, which opens their visit when the server holds one (`open`).
 */
export function rosterRows(visits: Row[], ward: Row[], open: ReadonlySet<string>): Row[] {
  return ward.map(w => {
    const visit = visits.find(v => v.id === w.id);
    return visit ? { ...visit, ward: w.ward } : { ...w, open: open.has(w.id) };
  });
}

export const inView = (rows: Row[], view: Exclude<View, "continue">) =>
  view === "mine" ? rows.filter(r => r.mine) : view === "ward" ? rows.filter(r => r.ward) : view === "clinic" ? rows.filter(r => r.clinic) : view === "needs" ? rows.filter(r => r.group === "needs") : rows;

/** The flat list for a view: "Needs you" is every row in urgency groups; "All" is A–Z with letter headers; the rest are ranked by urgency. */
export function listItems(rows: Row[], view: Exclude<View, "continue">, opened: ReadonlySet<Group>): Item[] {
  if (view === "needs") return GROUPS.flatMap(g => {
    const group = rows.filter(r => r.group === g.id).sort(byUrgency);
    if (!group.length) return [];
    const shown = opened.has(g.id) ? group : group.slice(0, g.shown);
    const hidden = group.length - shown.length;
    return [{ key: `h:${g.id}`, kind: "header" as const, title: g.title, count: group.length }, ...shown.map(row => ({ key: `r:${row.id}`, kind: "row" as const, row })),
      ...(hidden ? [{ key: `m:${g.id}`, kind: "more" as const, group: g.id, hidden }] : [])];
  });
  if (view === "all") {
    const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    return sorted.flatMap((row, i) => {
      const letter = row.name[0]!.toUpperCase();
      const first = i === 0 || sorted[i - 1]!.name[0]!.toUpperCase() !== letter;
      return [...(first ? [{ key: `h:${letter}`, kind: "header" as const, title: letter, count: sorted.filter(r => r.name[0]!.toUpperCase() === letter).length }] : []), { key: `r:${row.id}`, kind: "row" as const, row }];
    });
  }
  return inView(rows, view).sort(byUrgency).map(row => ({ key: `r:${row.id}`, kind: "row" as const, row }));
}

/** Letters present in the A–Z view, for the index on the right edge. */
export const letters = (rows: Row[]) => [...new Set(rows.map(r => r.name[0]!.toUpperCase()))].sort();

const MALAY = ["Ahmad", "Muhammad", "Nur", "Siti", "Aisyah", "Hafiz", "Zulkifli", "Rosli", "Azlan", "Farah", "Hidayah", "Izzat", "Mariam", "Rahim", "Syafiq", "Nabila"];
const MALAY_2 = ["Hakim", "Aina", "Izwan", "Sofea", "Rashid", "Amani", "Firdaus", "Zahra", "Iskandar", "Balqis"];
const SURNAME = ["Tan", "Lim", "Lee", "Wong", "Ng", "Chong", "Goh", "Ong", "Teo", "Chan", "Yap", "Low"];
const GIVEN = ["Wei Ming", "Mei Ling", "Kok Leong", "Hui Min", "Jia Hui", "Chee Keong", "Siew Lan", "Boon Hock", "Xin Yi", "Kah Wai"];
const INDIAN = ["Ravi", "Priya", "Suresh", "Kavitha", "Arjun", "Deepa", "Ganesh", "Lakshmi", "Vijay", "Anita"];
const INDIAN_2 = ["Kumar", "Devi", "Nair", "Pillai", "Raj", "Menon", "Rao"];
const NEEDS: [string, Tone][] = [["Low potassium · no action yet", "urgent"], ["Troponin rising · 2nd result", "urgent"], ["Worse at day-2 check-in", "urgent"], ["2 medicines to confirm", "soon"], ["Allergy unconfirmed", "soon"], ["GL denied · appeal due today", "soon"], ["History to complete", "soon"], ["Unsigned note from yesterday", "soon"]];
const WAITING = ["Stable · day 3", "Awaiting bloods", "Physio this afternoon", "Awaiting imaging", "Booked · record complete"];

/**
 * A deterministic synthetic census for reviewing the list at scale (Settings → demo tools): about
 * 11% need attention, 6% are due in the next hour, a third wait and the rest are done. Every name
 * and reason is fictional; these rows have no full record, so they don't open.
 */
export function syntheticCensus(n: number, seed = 11): Row[] {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
  const used = new Set<string>();
  const rows: Row[] = [];
  let bed = 1, clinic = 10 * 60;
  while (rows.length < n) {
    const r = rnd();
    const name = r < 0.42 ? `${pick(MALAY)} ${pick(MALAY_2)}` : r < 0.76 ? `${pick(SURNAME)} ${pick(GIVEN)}` : `${pick(INDIAN)} ${pick(INDIAN_2)}`;
    if (used.has(name)) { if (used.size > 600) break; continue; }
    used.add(name);
    const i = rows.length;
    const group: Group = i < Math.round(n * 0.11) ? "needs" : i < Math.round(n * 0.17) ? "next" : i < Math.round(n * 0.55) ? "waiting" : "done";
    const onWard = rnd() < 0.4;
    const where = onWard ? `Bed 4B-${String(bed++).padStart(2, "0")}` : `Clinic ${String(Math.floor(clinic / 60)).padStart(2, "0")}:${String(clinic % 60).padStart(2, "0")}`;
    if (!onWard) clinic += 10;
    const [reason, tone] = group === "needs" ? pick(NEEDS) : group === "next" ? ["Record complete · ready", "good" as Tone] : group === "waiting" ? [pick(WAITING), "calm" as Tone] : ["Seen · note signed", "good" as Tone];
    rows.push({ id: `SYN-C${String(i + 1).padStart(3, "0")}`, name, initials: name.split(" ").map(w => w[0]).join("").slice(0, 2), where, group, reason, tone, mine: group === "needs" || group === "next", ward: onWard, clinic: !onWard, open: false });
  }
  return rows;
}

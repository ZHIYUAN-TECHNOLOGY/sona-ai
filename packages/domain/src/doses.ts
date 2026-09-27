/**
 * The take-home dose schedule, shared by Sona Care (what to take next) and the server (what the care
 * team sees): every dose of a medicine from discharge, keyed by medicine and due time, in Malaysia time.
 */
/** A take-home medicine as the plan gives it: how to take one dose, daily times (Malaysia, "HH:MM") and, for a course, how many doses are left. */
export type ScheduledMed = { name: string; line: string; take?: string; at?: string[]; doses?: number };

const MYT = 8 * 3600_000, DAY = 86_400_000;
/** A dose not taken this long after it was due counts as missed (before that it is only late). */
export const MISSED_AFTER = 6 * 3600_000;

/** Every dose of one medicine after the patient left hospital, up to `until`. */
export function doseSlots(med: ScheduledMed, out: Date, until: Date): Date[] {
  const all: Date[] = [];
  const first = Math.floor((out.getTime() + MYT) / DAY) * DAY - MYT; // midnight of discharge day, Malaysia time
  for (let day = first; day <= until.getTime(); day += DAY)
    for (const hhmm of med.at ?? []) {
      const [h, m] = hhmm.split(":").map(Number);
      const due = new Date(day + (h! * 60 + m!) * 60_000);
      if (due > out && due <= until) all.push(due);
    }
  return med.doses === undefined ? all : all.slice(0, med.doses);
}

export const doseKey = (name: string, dueAt: Date) => `${name}@${dueAt.toISOString()}`;

/** A dose key's medicine and due time, or undefined if it is not one. */
export function parseDoseKey(key: string): { name: string; dueAt: Date } | undefined {
  const at = key.lastIndexOf("@");
  if (at < 1) return undefined;
  const dueAt = new Date(key.slice(at + 1));
  return Number.isNaN(dueAt.getTime()) ? undefined : { name: key.slice(0, at), dueAt };
}

export type Adherence = { due: number; taken: number; missed: { name: string; dueAt: Date }[]; late: { name: string; dueAt: Date }[] };

/**
 * Since discharge, up to `now`: how many doses were due and taken, which are missed (not taken
 * MISSED_AFTER past due) and which are late (due, not taken, still inside that window).
 */
export function adherence(meds: ScheduledMed[], dischargedAt: string | Date | undefined, taken: string[], now: Date): Adherence {
  if (!dischargedAt) return { due: 0, taken: 0, missed: [], late: [] };
  const done = new Set(taken);
  const due = meds.flatMap(med => doseSlots(med, new Date(dischargedAt), now).map(dueAt => ({ name: med.name, dueAt, key: doseKey(med.name, dueAt) })));
  const open = due.filter(d => !done.has(d.key));
  const strip = ({ name, dueAt }: { name: string; dueAt: Date }) => ({ name, dueAt });
  return {
    due: due.length, taken: due.length - open.length,
    missed: open.filter(d => now.getTime() - d.dueAt.getTime() >= MISSED_AFTER).map(strip),
    late: open.filter(d => now.getTime() - d.dueAt.getTime() < MISSED_AFTER).map(strip),
  };
}

/** The care team's one line: "1 Azithromycin dose missed", "2 doses missed (Azithromycin, Cetirizine)", or undefined when nothing is. */
export function missedLine(a: Pick<Adherence, "missed">): string | undefined {
  if (!a.missed.length) return undefined;
  const names = [...new Set(a.missed.map(m => m.name))];
  return names.length === 1 ? `${a.missed.length} ${names[0]} dose${a.missed.length > 1 ? "s" : ""} missed` : `${a.missed.length} doses missed (${names.join(", ")})`;
}

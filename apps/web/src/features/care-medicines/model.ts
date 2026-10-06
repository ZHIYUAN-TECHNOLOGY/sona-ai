import { doseKey, doseSlots, MISSED_AFTER, type ScheduledMed } from "@sona-ai/domain/doses";

/** The dose rules of the phone app's Medicine tab (apps/care/features/doses/model.ts), for the web page. */
export type Lang = "en" | "ms" | "zh";
export type Dose = { name: string; line: string; dueAt: Date; key: string; taken: boolean };
export type Part = "Morning" | "Afternoon" | "Evening" | "Night";

const MYT = 8 * 3600_000, DAY = 86_400_000, TZ = "Asia/Kuala_Lumpur";
const dayOf = (d: Date) => Math.floor((d.getTime() + MYT) / DAY);

export const langOf = (tag: string | undefined): Lang => (tag?.toLowerCase().startsWith("ms") ? "ms" : tag?.toLowerCase().startsWith("zh") ? "zh" : "en");

const dosesOf = (meds: ScheduledMed[], out: Date, until: Date, taken: Set<string>): Dose[] =>
  meds.flatMap(med => doseSlots(med, out, until).map(dueAt => {
    const key = doseKey(med.name, dueAt);
    return { name: med.name, line: med.take ?? med.line, dueAt, key, taken: taken.has(key) };
  })).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

/** Every dose due today (Malaysia time), earliest first. */
export function dosesToday(meds: ScheduledMed[], dischargedAt: string, taken: string[], now: Date): Dose[] {
  const today = dayOf(now);
  return dosesOf(meds, new Date(dischargedAt), new Date((today + 1) * DAY - MYT - 1), new Set(taken)).filter(d => dayOf(d.dueAt) === today);
}

/** The earliest dose not taken and not yet missed, looking two days ahead. */
export function nextDose(meds: ScheduledMed[], dischargedAt: string, taken: string[], now: Date): Dose | undefined {
  return dosesOf(meds, new Date(dischargedAt), new Date(now.getTime() + 2 * DAY), new Set(taken))
    .find(d => !d.taken && d.dueAt.getTime() > now.getTime() - MISSED_AFTER);
}

/** Doses taken on each of the last seven days, of those due by now, oldest first. */
export function weekTaken(meds: ScheduledMed[], dischargedAt: string, taken: string[], now: Date, lang: Lang) {
  const today = dayOf(now), all = dosesOf(meds, new Date(dischargedAt), now, new Set(taken));
  const label = new Intl.DateTimeFormat(lang, { timeZone: TZ, weekday: "short" });
  return Array.from({ length: 7 }, (_, i) => today - 6 + i).map(day => {
    const due = all.filter(d => dayOf(d.dueAt) === day);
    return { x: label.format(new Date(day * DAY - MYT + DAY / 2)), y: due.filter(d => d.taken).length, due: due.length };
  });
}

/** More than two hours ahead: too early to mark. */
export const early = (dueAt: Date, now: Date) => dueAt.getTime() - now.getTime() > 2 * 3600_000;
/** Within half an hour, or past: time to take it. */
export const dueSoon = (dueAt: Date, now: Date) => dueAt.getTime() - now.getTime() <= 30 * 60_000;

export const timeOf = (d: Date, lang: Lang) => new Intl.DateTimeFormat(lang, { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d);

export function whenWords(dueAt: Date, now: Date, lang: Lang) {
  const ahead = dayOf(dueAt) - dayOf(now), time = timeOf(dueAt, lang);
  return ahead === 0 ? `today at ${time}` : ahead === 1 ? `tomorrow at ${time}` : ahead === -1 ? `yesterday at ${time}`
    : new Intl.DateTimeFormat(lang, { timeZone: TZ, weekday: "long", hour: "numeric", minute: "2-digit" }).format(dueAt);
}

export function partOf(dueAt: Date): Part {
  const h = new Date(dueAt.getTime() + MYT).getUTCHours();
  return h < 12 ? "Morning" : h < 17 ? "Afternoon" : h < 21 ? "Evening" : "Night";
}

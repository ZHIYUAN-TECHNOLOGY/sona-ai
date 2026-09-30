import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { DOCTORS, type Doctor } from "@sona-ai/domain/doctors";
import { formatDate, type Lang } from "@/lib/i18n";
import "./strings";

/**
 * Doctors at the patient's hospital, for Find a doctor and booking (after the Life OS Doctors screens).
 * SYNTHETIC sample data for the demo hospital: invented names, never real clinicians. The screens read
 * the hospital's directory and free slots from the API (care.doctors), and so does the assistant's
 * doctor search (care.doctors.list with the question). A booking is a request the care team confirms
 * (care.bookings).
 */
export { DOCTORS, type Doctor };
/** A doctor as the API lists them, with their free clinic slots over the next two weeks. */
export type ListedDoctor = Awaited<ReturnType<AppRouterClient["care"]["doctors"]["list"]>>[number];

export type Filter = "all" | "care-team" | "top-rated" | "for-you";
/** The list for a filter: all; your care team; best rated first; or matched to words from the plan (e.g. "pneumonia"). */
export function listFor<T extends Doctor>(list: T[], filter: Filter, planWords = "") {
  if (filter === "care-team") return list.filter(d => d.careTeam);
  if (filter === "top-rated") return [...list].sort((a, b) => b.rating - a.rating);
  if (filter === "for-you") return matchDoctors(list, planWords);
  return list;
}

/** Doctors whose tags or specialty appear in the words (a question or the plan), best rated first; the care team first on a tie. */
export function matchDoctors<T extends Doctor>(list: T[], words: string) {
  const w = words.toLowerCase();
  return list.filter(d => d.tags.some(t => w.includes(t)) || w.includes(d.specialty.toLowerCase()))
    .sort((a, b) => Number(!!b.careTeam) - Number(!!a.careTeam) || b.rating - a.rating);
}

export type Slot = { date: Date; label: string };
/** A free time as a slot: its moment and "9:00 AM" in Malaysia time. */
export const slotOf = (at: Date | string, lang: Lang = "en"): Slot => {
  const date = new Date(at);
  return { date, label: formatDate(lang, date, "time") };
};

/** Doctors whose name or specialty contains the query (any case); the whole list for an empty query. */
export function searchDoctors<T extends Doctor>(list: T[], query: string) {
  const q = query.trim().toLowerCase();
  return q ? list.filter(d => d.name.toLowerCase().includes(q) || d.specialty.toLowerCase().includes(q)) : list;
}

/** The avatar's initials, title left out: "Dr. Lim Wei Jie" → "LW". */
export const initials = (name: string) => name.replace(/^Dr\.?\s+/i, "").split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");

/** The name on two lines after the kit ("Dr. Marc / lee"): title and first name, then the rest. */
export function nameLines(name: string): [string, string] {
  const words = name.split(" ");
  const cut = /^Dr\.?$/i.test(words[0] ?? "") ? 2 : 1;
  return [words.slice(0, cut).join(" "), words.slice(cut).join(" ")];
}

/** A clinic day's chip in Malaysia time: "Mon" over "28", and the spoken "Monday 28 September". */
export function dayParts(day: Date | string, lang: Lang = "en") {
  const date = String(new Date(new Date(day).getTime() + 8 * 3600_000).getUTCDate());
  return { weekday: formatDate(lang, day, "weekday"), date, spoken: formatDate(lang, day, "long") };
}

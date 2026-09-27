/**
 * Doctors at the patient's hospital, for Find a doctor and booking (after the Life OS Doctors screens).
 * SYNTHETIC sample data for the demo hospital: invented names, never real clinicians. Booking sends a
 * request to the care team (they confirm by message); nothing here books a real slot.
 * ponytail: a fixture; move to the API (clinicians, rooms, slots) when the hospital directory exists.
 */
export type Doctor = {
  id: string; name: string; specialty: string; years: number; rating: number; reviews: number;
  room: string; languages: string[]; about: string; careTeam?: boolean; tags: string[];
  /** Weekdays with clinic sessions (0 Sun … 6 Sat) and the session times, Malaysia time. */
  days: number[]; times: string[];
};

export const DOCTORS: Doctor[] = [
  { id: "lim", name: "Dr. Lim Wei Jie", specialty: "Respiratory", years: 12, rating: 4.8, reviews: 214, room: "Clinic 3B, Level 3", languages: ["English", "Malay", "Mandarin"], careTeam: true,
    about: "Looks after lungs and breathing, including recovery after pneumonia.", tags: ["pneumonia", "lung", "breath", "breathing", "cough", "chest"], days: [1, 3, 4], times: ["09:00", "10:30", "14:00", "15:30"] },
  { id: "aisyah", name: "Dr. Aisyah Rahman", specialty: "Cardiology", years: 15, rating: 4.9, reviews: 302, room: "Heart Centre, Level 2", languages: ["English", "Malay"],
    about: "Heart specialist: blood pressure, palpitations and chest pain follow-up.", tags: ["heart", "blood pressure", "palpitation", "chest"], days: [2, 4], times: ["08:30", "11:00", "14:30"] },
  { id: "priya", name: "Dr. Priya Nair", specialty: "General medicine", years: 9, rating: 4.7, reviews: 188, room: "Medical Clinic, Level 1", languages: ["English", "Malay", "Tamil"], careTeam: true,
    about: "Your ward doctor's team for general check-ups after you go home.", tags: ["general", "fever", "check-up", "tired"], days: [1, 2, 3, 4, 5], times: ["09:30", "11:30", "15:00"] },
  { id: "tan", name: "Dr. Tan Mei Ling", specialty: "Endocrinology", years: 11, rating: 4.6, reviews: 142, room: "Diabetes Clinic, Level 2", languages: ["English", "Mandarin", "Cantonese"],
    about: "Diabetes and hormone care, including blood sugar and HbA1c reviews.", tags: ["diabetes", "sugar", "thyroid", "hba1c"], days: [3, 5], times: ["10:00", "13:30"] },
  { id: "arjun", name: "Dr. Arjun Menon", specialty: "Rehabilitation", years: 8, rating: 4.7, reviews: 97, room: "Rehab Centre, Ground floor", languages: ["English", "Malay"],
    about: "Helps you get your strength and breathing back with guided exercise.", tags: ["exercise", "walk", "strength", "physio", "rehab"], days: [1, 2, 4, 5], times: ["09:00", "11:00", "16:00"] },
  { id: "farah", name: "Dr. Farah Idris", specialty: "Family medicine", years: 7, rating: 4.5, reviews: 121, room: "Family Clinic, Level 1", languages: ["English", "Malay"],
    about: "Everyday health for you and your family, close to home.", tags: ["family", "child", "general", "vaccine"], days: [1, 3, 5, 6], times: ["08:30", "10:00", "14:00"] },
];

export const doctorById = (id: string | undefined) => DOCTORS.find(d => d.id === id);

export type Filter = "all" | "care-team" | "top-rated" | "for-you";
/** The list for a filter: all; your care team; best rated first; or matched to words from the plan (e.g. "pneumonia"). */
export function listFor(filter: Filter, planWords = "") {
  if (filter === "care-team") return DOCTORS.filter(d => d.careTeam);
  if (filter === "top-rated") return [...DOCTORS].sort((a, b) => b.rating - a.rating);
  if (filter === "for-you") return matchDoctors(planWords);
  return DOCTORS;
}

/** Doctors whose tags or specialty appear in the words (a question or the plan), best rated first; the care team first on a tie. */
export function matchDoctors(words: string) {
  const w = words.toLowerCase();
  return DOCTORS.filter(d => d.tags.some(t => w.includes(t)) || w.includes(d.specialty.toLowerCase()))
    .sort((a, b) => Number(!!b.careTeam) - Number(!!a.careTeam) || b.rating - a.rating);
}

const MYT = 8 * 3600_000, DAY = 86_400_000;
export type Slot = { date: Date; label: string };
/** The next `days` clinic days from tomorrow, each with its session times as dates (Malaysia time). */
export function slots(doctor: Doctor, now: Date, days = 14): { day: Date; times: Slot[] }[] {
  const today = Math.floor((now.getTime() + MYT) / DAY);
  return Array.from({ length: days }, (_, i) => today + 1 + i)
    .filter(d => doctor.days.includes(new Date(d * DAY).getUTCDay()))
    .map(d => ({ day: new Date(d * DAY - MYT + 12 * 3600_000), times: doctor.times.map(t => {
      const [h, m] = t.split(":").map(Number);
      const date = new Date(d * DAY - MYT + (h! * 60 + m!) * 60_000);
      return { date, label: date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }) };
    }) }));
}

/** The message a booking request sends to the care team, so they can confirm it. */
export function bookingText(doctor: Doctor, slot: Date, reason?: string) {
  const day = slot.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" }).replace(",", "");
  const when = `${day}, ${slot.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" })}`;
  return `Booking request: ${doctor.name} (${doctor.specialty}), ${when}.${reason?.trim() ? ` Reason: ${reason.trim()}.` : ""} Please confirm.`;
}

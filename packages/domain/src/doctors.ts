/**
 * The demo hospital's clinicians as patients see them in Find a doctor: SYNTHETIC sample data with
 * invented names, never real clinicians. Seeded into the doctors table; Sona Care reads them from the API.
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


import { fixture, rows } from "./fixture";

// Follow-ups (/care/follow-ups): visits, the patient's booking requests, the clinic clock and visit prep.
// Every column here is unbounded text in the schema (doctors, booking_requests, appointments).

const DAY = 86_400_000, MYT = 8 * 3600_000;
/** `days` from today at "HH:MM" Malaysia time. */
export const at = (days: number, hhmm = "09:00") => {
  const [h, m] = hhmm.split(":").map(Number);
  const midnight = Math.floor((Date.now() + MYT) / DAY) * DAY - MYT;
  return new Date(midnight + days * DAY + (h! * 60 + m!) * 60_000);
};

export const LONG_DOCTOR = "Dato' Dr. Muhammad Hafiz bin Abdul Rahman Al-Haj";
export const LONG_ROOM = "Klinik Pakar Respiratori, Aras 3, Blok C (Bangunan Baharu)";

const visit = (id: string, days: number, hhmm: string, title: string, why: string, status: "upcoming" | "due-soon" | "attended" | "missed" = days <= 1 ? "due-soon" : "upcoming") =>
  ({ id, date: at(days, hhmm), title, short: title, why, inDays: days, status });

// Twelve visits on one day (a day of scans, bloods and clinics), then far-off and past visits.
const SAME_DAY = ["08:00", "08:30", "09:00", "09:15", "10:00", "10:45", "11:30", "13:00", "14:00", "14:30", "15:15", "16:00"];
const SAME_DAY_TITLES = ["Ujian fungsi paru-paru (spirometri) dan ujian tindak balas bronkodilator", "Blood test", "Chest X-ray", "ECG", "Klinik Pakar Respiratori", "Echocardiogram", "Dietitian", "Pharmacy counselling", "Physiotherapy", "Sleep clinic", "Ophthalmology", "Diabetes education"];

export default [
  fixture("care.clock", { worst: { offsetMs: 0 } }),
  fixture("care.followUps", {
    worst: [
      ...[-40, -21, -9, -2].map((d, i) => visit(`past-${i}`, d, "10:30", i === 0 ? "Pemeriksaan semula selepas discaj dari wad perubatan" : "Clinic review", "To check how you are healing.", i % 2 ? "missed" : "attended")),
      ...SAME_DAY.map((t, i) => visit(`day-${i}`, 0, t, SAME_DAY_TITLES[i]!, i === 0
        ? "Doktor mahu melihat sama ada paru-paru anda semakin pulih selepas jangkitan, dan sama ada dos inhaler perlu diubah sebelum anda kembali bekerja."
        : "Booked by your care team.")),
      visit("recall:finding-1", 1, "09:00", "Repeat chest X-ray", "A shadow on your last X-ray should be checked again."),
      visit("discharge-review", 287, "09:00", "Discharge review", "To check how you are doing since you went home."),
    ],
    empty: [],
    one: [visit("discharge-review", 1, "09:00", "Discharge review", "To check how you are doing since you went home.")],
    huge: rows(1000, i => visit(`v-${i}`, i - 500, "09:00", i % 3 ? "Clinic review" : "Ujian darah (kiraan darah penuh dan fungsi buah pinggang)", "Booked by your care team.", i < 500 ? (i % 2 ? "missed" : "attended") : undefined)),
  }),
  fixture("care.bookings.list", {
    worst: [
      booking("b-1", "day-0", "confirmed", 0, "08:00"),
      booking("b-2", null, "requested", 2, "14:30"),
      booking("b-3", null, "requested", 3, "08:00", "Batuk berdahak tidak berhenti sejak saya keluar wad, dan saya rasa semput bila naik tangga ke rumah."),
      booking("b-4", null, "declined", 4, "16:00", null, "Dr. Hafiz is on leave that week. Please choose a time with Dr. Tan Mei Ling instead, or call the clinic on 03-9145 5555 and we will help you."),
      ...rows(8, i => booking(`b-more-${i}`, null, "requested", 5 + i, "11:00")),
    ],
    empty: [],
    one: [booking("b-1", null, "requested", 2, "14:30")],
    huge: rows(1000, i => booking(`b-${i}`, null, i % 5 ? "requested" : "declined", 1 + (i % 30), "11:00")),
  }),
  fixture("care.visitPrep.get", {
    worst: {
      appointment: { id: "day-0", startsAt: at(0, "08:00"), kind: "clinic" },
      questions: [
        "Bolehkah saya berhenti mengambil inhaler biru jika saya tidak lagi semput pada waktu malam selama seminggu?",
        "Is it safe to go back to my job at the palm oil mill next Monday, or should I wait until the cough is gone?",
        "我的血糖最近很高，这和新的药有关系吗？",
      ],
      shareReadings: true,
      doctorWillSee: "Siti Nur Aisyah binti Mohd Khairuddin asks: (1) Bolehkah saya berhenti mengambil inhaler biru jika saya tidak lagi semput pada waktu malam selama seminggu? (2) Is it safe to go back to my job at the palm oil mill next Monday, or should I wait until the cough is gone? (3) 我的血糖最近很高，这和新的药有关系吗？ Readings shared for the last 7 days: 28 readings, oxygen 91-97%, blood sugar 6.8-14.2 mmol/L.",
    },
    empty: { appointment: null, questions: [], shareReadings: false, doctorWillSee: null },
    one: { appointment: { id: "discharge-review", startsAt: at(1, "09:00"), kind: "review" }, questions: ["Can I drive?"], shareReadings: false, doctorWillSee: null },
  }),
];

function booking(id: string, appointmentId: string | null, status: "requested" | "confirmed" | "declined", days: number, hhmm: string, reason: string | null = null, note: string | null = null) {
  return {
    id, patientId: "p-1", patientName: "Siti Nur Aisyah binti Mohd Khairuddin", doctorId: "d-0", doctorName: LONG_DOCTOR,
    specialty: "Perubatan Respiratori (Pulmonologi)", room: LONG_ROOM, startsAt: at(days, hhmm), reason, status,
    taskId: null, title: null, appointmentId, createdAt: at(-1), decidedAt: status === "requested" ? null : at(-1, "15:00"), note,
  };
}

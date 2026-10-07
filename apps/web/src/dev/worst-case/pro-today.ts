import { dateKey } from "@/features/today/time";

import { fixture, rows } from "./fixture";

// /pro/today and /pro/schedule read the same day.list (one call per date). Rows are built for whatever date is asked,
// in the hospital's time (+08:00), so "now" splits them into earlier and upcoming. /pro/visit lists the same rows.
// patients.list (encounters to open) is in pro-patients.ts: p-9 and p-13 have no visit record, so their rows offer nothing to open.
const NAMES = [
  "Siti Nur Aisyah binti Mohd Khairuddin", "J", "Christopher Alexander Montgomery III", "Đặng Thị Ngọc Hân", "王秀英",
  "Seán O'Brien-Ó Súilleabháin", "Muthukumaran a/l Subramaniam Pillai", "Nurul Izzati binti Abdul Rahman", "Lim Wei Jie",
  "María José de la Cruz y Fernández", "Jo", "Aleksandra Wiśniewska-Kowalczyk", "Tan Sri Dato' Seri Haji Mohd Zulkifli bin Abdullah",
];
const KINDS = [
  "Visit: Dr Wiśniewska-Kowalczyk, Cardiothoracic and Vascular Surgery", "Follow-up", "New patient consultation (interpreter: Tamil)",
  "Post-discharge review after CABG, wound check and medication reconciliation", "ECG", "Telephone review",
];
// Three at 09:00 share a start; one at 06:45 and one at 21:30 stretch the grid past 08:00–17:00.
const TIMES = ["06:45", "08:00", "09:00", "09:00", "09:00", "09:15", "10:30", "11:00", "12:45", "14:00", "15:30", "16:15", "17:40", "21:30"];

const at = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`);
const visit = (date: string, i: number, time: string) => ({
  id: `a-${date}-${i}`, patientId: `p-${i % 40}`, patientName: NAMES[i % NAMES.length]!, initials: "SN",
  incomplete: i % 4 === 0, kind: KINDS[i % KINDS.length]!, startsAt: at(date, time),
});
const minute = (i: number) => `${String(7 + Math.floor(i / 70) % 15).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`;
const today = dateKey(new Date());

const request = (i: number) => ({
  id: `br-${i}`, patientId: `p-${i}`, patientName: NAMES[(i + 2) % NAMES.length]!, doctorId: `d-${i % 3}`,
  doctorName: i % 2 ? "Dato' Dr Muhammad Haziq Iskandar bin Abdul Rahman" : "Dr Lim",
  specialty: i % 2 ? "Paediatric Cardiology and Congenital Heart Disease" : "Cardiology",
  room: i % 3 === 0 ? "" : i % 3 === 1 ? "Klinik Pakar Kardiologi, Aras 3, Blok Rawatan Harian, Bilik 3.14" : "R2",
  startsAt: new Date(at(today, "10:00").getTime() + (i + 1) * 86_400_000),
  // Patients write up to 200 characters (bookings.ts requestInput); null when they wrote nothing.
  reason: i % 3 === 2 ? null : i % 3 === 0
    ? "Saya rasa sesak nafas bila naik tangga sejak minggu lepas, kaki bengkak sikit. Boleh jumpa doktor lebih awal? My daughter will come with me to translate, she works until 5 pm."
    : "Chest pain again\nsince Saturday",
  status: "requested" as const, taskId: `br-${i}`, title: null, appointmentId: null, createdAt: at(today, "07:00"), decidedAt: null, note: null,
});

export default [
  fixture("day.list", {
    worst: ({ date }) => TIMES.map((t, i) => visit(date, i, t)),
    empty: [],
    one: ({ date }) => (date === today ? [visit(date, 0, "11:00")] : []),
    huge: ({ date }) => rows(1000, i => visit(date, i, minute(i))),
  }),
  fixture("bookings.list", { worst: rows(5, request), empty: [], one: [request(1)], huge: rows(1000, request) }),
];

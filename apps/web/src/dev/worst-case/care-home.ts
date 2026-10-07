import { doseKey } from "@sona-ai/domain/doses";

import { at } from "./care-follow-ups";
import { fixture, rows } from "./fixture";

// Home (/care/home): the discharge plan, today's doses, check-ins and the latest message. Visits and the clock
// are in care-follow-ups.ts. Medicine names, warning signs and messages are unbounded text.

const out = at(-3, "10:30");
const EVERY_HOUR = rows(14, h => `${String(7 + h).padStart(2, "0")}:00`);
const MEDS = [
  { name: "Amoxicillin/Clavulanate potassium (Augmentin) 625 mg", line: "Satu tablet tiga kali sehari selepas makan, selama 5 hari lagi", take: "1 tablet selepas makan", at: ["08:00", "14:00", "22:00"] },
  { name: "Salbutamol 100 mcg metered-dose inhaler (Ventolin Evohaler)", line: "Two puffs every hour while awake for the first days, then as needed", at: EVERY_HOUR },
  { name: "Budesonide/Formoterol 160/4.5 mcg (Symbicort Turbuhaler)", line: "Two puffs morning and night, rinse your mouth after", at: ["08:00", "20:00"] },
  { name: "Metformin", line: "1,000 mg twice a day after food", at: ["08:00", "20:00"] },
  { name: "Ais", line: "As needed" },
];
const SIGNS = [
  "Sesak nafas yang teruk semasa berehat, atau tidak dapat bercakap dalam ayat penuh",
  "Sakit dada yang tidak hilang selepas berehat selama 10 minit",
  "Bibir atau hujung jari menjadi kebiruan",
  "Batuk berdarah",
  "Demam melebihi 38°C lebih daripada dua hari",
  "Sangat mengantuk, keliru, atau sukar dikejutkan",
];
const LEAFLETS = [
  { language: "ms" as const, label: "BM", name: "Bahasa Melayu", text: "Risalah anda.", source: "fixture" as const },
  { language: "en" as const, label: "EN", name: "English", text: "Your leaflet.", source: "fixture" as const },
];
const plan = (medicines: typeof MEDS, warningSigns: string[]) => ({
  status: "discharged" as const, dischargedAt: out.toISOString(), language: "ms" as const, leaflets: LEAFLETS,
  medicines: { new: medicines.slice(0, 2), changed: medicines.slice(2, 3), continue: medicines.slice(3), stopped: [] },
  warningSigns, followUp: { title: "Discharge review", date: at(1) }, checkIns: [1, 3, 7].map(day => ({ day, date: at(day - 3) })),
});

const checkIn = (i: number, days: number, replied: boolean, sent = true) => ({
  id: `ci-${i}`, patientId: "p-1", encounterId: "enc-1", day: i + 1, language: "ms" as const, message: "Bagaimana keadaan anda hari ini?",
  dueAt: at(days, "09:00"), sentAt: sent ? at(days, "09:00") : null,
  replies: replied ? [{ id: `r-${i}`, text: "Ok", label: "fine" as const, source: "patient", decidedBy: "rules" as const, receivedAt: at(days, "10:00"), task: null }] : [],
});

const message = (i: number, from: "patient" | "care-team", text: string) => ({ id: `m-${i}`, from, text, createdAt: at(-1, "18:00"), seenAt: null, attachment: null });
const LONG_MESSAGE = "Salam Puan Siti, ini Dr. Hafiz dari Klinik Pakar Respiratori. Kami telah melihat bacaan oksigen anda semalam (91% pada waktu malam) dan jawapan semakan harian anda. Sila teruskan inhaler merah pagi dan malam, dan gunakan inhaler biru apabila perlu sahaja. Jika bacaan oksigen anda di bawah 92% lagi malam ini, atau anda rasa semakin semput, sila datang ke Jabatan Kecemasan atau hubungi 999. Kami akan menghubungi anda esok pagi untuk bertanya khabar.";

export default [
  fixture("care.discharge", {
    worst: plan(MEDS, SIGNS),
    empty: { status: "in-hospital" as const },
    one: plan([{ name: "Metformin", line: "One tablet after dinner", at: ["20:00"] }], ["Chest pain"]),
  }),
  // A few of today's doses already taken.
  fixture("care.doses.list", {
    worst: [doseKey(MEDS[2]!.name, at(0, "08:00")), doseKey(MEDS[1]!.name, at(0, "07:00"))],
    empty: [],
    one: [],
  }),
  fixture("care.checkIns.list", {
    worst: [checkIn(0, -2, false), checkIn(1, -1, false), checkIn(2, 0, false), checkIn(3, 4, false, false)],
    empty: [],
    one: [checkIn(0, 0, false)],
    huge: rows(1000, i => checkIn(i, i - 990, i % 7 !== 0, i < 995)),
  }),
  fixture("care.messages.list", {
    worst: [message(0, "patient", "Doktor, saya masih batuk."), message(1, "care-team", LONG_MESSAGE)],
    empty: [],
    one: [message(0, "patient", "Ok")],
    huge: rows(1000, i => message(i, i % 2 ? "care-team" : "patient", i % 3 ? "Terima kasih." : LONG_MESSAGE)),
  }),
];

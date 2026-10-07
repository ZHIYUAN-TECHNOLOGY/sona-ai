import { at, LONG_DOCTOR, LONG_ROOM } from "./care-follow-ups";
import { fixture, rows } from "./fixture";

// Care team (/care/care-team) and the booking card on Follow-ups: the hospital's doctors with free slots.
// doctors.name/room/about, languages and tags are unbounded (packages/db/src/schema/clinical.ts).

const LANGUAGES = ["Bahasa Melayu", "English", "Mandarin", "Cantonese", "Hokkien", "Tamil", "Telugu", "Punjabi", "Iban", "Kadazandusun"];
const NAMES = [LONG_DOCTOR, "Dr. Tan Mei Ling", "Dr. Jo", "Dr. Sivasubramaniam a/l Ramakrishnan", "Prof. Dr. Nurul Ain Syafiqah binti Wan Ahmad Zulkifli", "Dr. 林志伟", "Dr. Gurpreet Kaur a/p Harjinder Singh", "Dr. Ólafur Darri Ólafsson", "Dr. Lim", "Dr. Nguyễn Thị Ngọc Hân", "Datin Dr. Rajeswari Krishnamoorthy", "Dr. Ahmad", "Dr. Christopher Alexander Montgomery III", "Dr. Wong Kar Wai", "Dr. Siti"];
const SPECIALTIES = ["Perubatan Respiratori (Pulmonologi)", "Cardiology", "GP", "Endocrinology, Diabetes and Metabolism"];
const ABOUT = "Dr. Hafiz merawat pesakit dewasa yang mengalami penyakit paru-paru kronik, termasuk asma, COPD dan bronkiektasis, dan telah bertugas di Hospital Pakar Universiti Kebangsaan Malaysia selama lebih 20 tahun. He also runs the pulmonary rehabilitation clinic on Tuesdays and Thursdays, where patients learn breathing exercises, how to use their inhalers properly and how to pace themselves at home after a stay in hospital.";

const slots = (n: number) => rows(n, d => ({ day: at(d + 1, "00:00"), times: rows(12, t => at(d + 1, `${8 + Math.floor(t / 2)}:${t % 2 ? "30" : "00"}`)) }));

const doctor = (i: number, careTeam = true) => ({
  id: `d-${i}`, hospitalId: "h-1", name: NAMES[i % NAMES.length]!, specialty: SPECIALTIES[i % SPECIALTIES.length]!, years: 20 + i, rating: 4.8, reviews: 1284,
  room: i % 3 ? `Klinik ${i + 1}, Aras 2` : LONG_ROOM, languages: LANGUAGES, about: i % 4 === 2 ? "" : ABOUT,
  tags: i === 0 ? ["breathing", "breath", "asthma", "chronic obstructive pulmonary disease", "inhaler technique", "sleep apnoea"] : i % 4 === 2 ? [] : ["diabetes", "insulin"],
  days: [1, 2, 3, 4, 5], times: ["08:00", "17:00"], careTeam, nextSlots: i % 5 === 4 ? [] : slots(10),
});

export default [
  fixture("care.doctors.list", {
    worst: rows(15, i => doctor(i)),
    empty: [],
    one: [{ ...doctor(8), specialty: "Cardiology", languages: ["English"], tags: ["heart"], about: "Looks after your heart." }],
    huge: rows(1000, i => doctor(i, i < 200)),
  }),
  fixture("care.trainingConsent", {
    worst: { consented: true, at: at(-3) },
    empty: { consented: false, at: null },
  }),
];

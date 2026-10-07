import { fixture, rows } from "./fixture";

// /pro/review: after-visit summaries (its replies come from pro-messages.ts). Limits: an approved edit is 1-4000
// chars (review.ts approve); the drafted text, whatChanged, sources and checks are unbounded.
const now = Date.UTC(2026, 9, 7, 1, 0);
const NAMES = ["Muthukumaran a/l Rajagopalan Subramaniam", "Jo", "王秀英", "Christopher Alexander Montgomery III", "Đặng Thị Ngọc Hân", "Siti Nur Aisyah binti Mohd Khairuddin"];

const TEXT = (
  "Puan, semasa lawatan hari ini kami dapati paras potassium anda tinggi (6.8 mmol/L) [1], jadi kami telah memberhentikan spironolactone [2]. "
  + "Teruskan furosemide 40 mg setiap pagi [2], dan timbang berat badan anda setiap hari sebelum sarapan. Jika berat naik lebih daripada 2 kg dalam tiga hari, hubungi kami. "
  + "Ujian darah semula di Klinik Kardiologi, Hospital Canselor Tuanku Muhriz, pada Khamis 15 Oktober jam 8.30 pagi [3]. "
  + "See https://www.hospital-pakar-ukm.example.com/sona-care/discharge/9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f/medicines?lang=ms for the full list [4] [9].\n\n"
  + "Jika sakit dada, sesak nafas teruk atau pengsan, hubungi 999 serta-merta."
);
// Ten failed checks, the most the checker could plausibly raise at once, with a passed one between.
const CHECKS = [
  ["Every medicine in the summary is on the visit's list", "Mentions \"atorvastatin 40 mg\", which is not on the visit's medicine list"],
  ["Every dose matches the prescription", "Says furosemide 40 mg; the prescription is 20 mg twice daily"],
  ["The stopped medicine is named", null],
  ["Every follow-up has a date and a place", "\"Ujian darah semula\" has a date but the clinic room is missing"],
  ["Written in the patient's discharge language (ms)", "Two sentences are in English"],
  ["No unexplained abbreviations", "Uses \"GTN\", \"INR\", \"eGFR\" and \"U&E\" without saying what they are"],
  ["Reading age 12 or under", "Reading age 16: three sentences are over 35 words"],
  ["Every claim cites a source", "The sentence about weighing every day cites no source"],
  ["Every cited source exists", "Cites [9]; the summary has sources 1 to 4"],
  ["Says when to call 999", null],
  ["No links outside the hospital's domain", "Links to a page outside hospital-pakar-ukm.example.com"],
  ["No other patient's details", "Names \"Encik Rahman, bed 12\""],
] as const;

const summary = (i: number) => ({
  id: `vs-e-${i}-3`, kind: "visit-summary" as const, patient: { id: `p-${i}`, name: NAMES[i % NAMES.length]! }, encounterId: `e-${i}`,
  text: i % 3 === 1 ? "Ok, no change." : TEXT,
  whatChanged: i % 3 === 1 ? [] : [
    "Spironolactone 25 mg once daily: stopped, because the potassium was 6.8 mmol/L",
    "Furosemide: from 20 mg twice daily to 40 mg every morning",
    "New: daily weight before breakfast, call if up by more than 2 kg in three days",
  ],
  sources: i % 3 === 1 ? [] : [
    { n: 1, kind: "note" as const, ref: "s-plan", text: "Plan: K+ 6.8 mmol/L on 6 Oct (haemolysed sample excluded; repeat 6.7). Stop spironolactone. Repeat U&E in one week at the cardiology clinic, HCTM, with Dr Aleksandra Wiśniewska-Kowalczyk." },
    { n: 2, kind: "prescription" as const, ref: "rx-1", text: "Spironolactone 25 mg OD: stopped · Furosemide 40 mg OM (was 20 mg BD)" },
    { n: 3, kind: "follow-up" as const, ref: "appt-1", text: "Klinik Kardiologi, Hospital Canselor Tuanku Muhriz, Aras 3, Bilik 3.14 · Thu 15 Oct, 08:30" },
    { n: 4, kind: "note" as const, ref: "s-meds", text: "https://www.hospital-pakar-ukm.example.com/sona-care/discharge/9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f/medicines?lang=ms" },
  ],
  checks: i % 3 === 2 ? CHECKS.map(([label], n) => ({ id: `c-${n}`, label, ok: true })) : CHECKS.map(([label, detail], n) => ({ id: `c-${n}`, label, ok: !detail, ...(detail && { detail }) })),
  origin: i % 2 ? "fixture" as const : "model" as const,
  createdAt: new Date(now - i * 53 * 60_000),
});

export default [
  fixture("review.list", { worst: rows(6, summary), empty: [], one: rows(1, i => ({ ...summary(i), checks: [{ id: "c-0", label: CHECKS[0][0], ok: false, detail: CHECKS[0][1] }] })), huge: rows(1000, summary) }),
];

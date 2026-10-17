import { fixture, rows } from "./fixture";

// /pro/messages (and the review queue's drafted replies): the inbox, one thread, its draft and a medicine photo.
// Limits: a message is 1-1000 chars (messages.ts `text`), a reading's name 120 / dose 60 / frequency 120. A thread,
// the inbox and a draft's text are unbounded.
const now = new Date(Date.UTC(2026, 9, 7, 1, 0));
const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000);

// 1,000 characters, the schema's limit: a worried patient typing in Malay on a phone, with an emoji.
const MALAY = (
  "Doktor, saya rasa dada saya sakit lagi sejak pagi tadi 😟 Sakitnya macam ditekan, kadang-kadang menjalar ke lengan kiri dan rahang. "
  + "Saya dah makan ubat GTN bawah lidah dua kali tapi masih tak hilang sepenuhnya. Semalam tekanan darah saya 168/102 dan nadi 112. "
  + "Saya juga rasa sesak nafas bila naik tangga, kaki bengkak sikit, dan tak boleh tidur baring, kena tidur bersandar pada tiga bantal. "
  + "Anak saya tanya patutkah kami terus ke Jabatan Kecemasan Hospital Canselor Tuanku Muhriz atau tunggu temujanji klinik Khamis ini? "
  + "Saya juga tak pasti sama ada patut teruskan spironolactone sebab doktor wad kata potassium saya tinggi masa discaj. "
  + "Ubat furosemide pula saya makan pagi tapi kena ke tandas banyak kali sampai tak boleh keluar rumah. Boleh tak saya tukar masa makan ke tengah hari? "
  + "Maaf kalau mesej ini panjang, saya cuma risau dan tak tahu siapa lagi nak tanya. Terima kasih banyak doktor dan jururawat semua."
).slice(0, 1000);
const URL_ONLY = "https://www.hospital-pakar-ukm.example.com/sona-care/discharge/9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f/medicines?lang=ms&tab=changes&highlight=spironolactone";
const CHINESE = "医生您好，我出院后第三天开始脚踝肿得很厉害，晚上睡觉需要垫两个枕头，早上起来体重比出院时多了两公斤。请问需要回医院复诊吗？";

const NAMES = ["Siti Nur Aisyah binti Mohd Khairuddin", "Christopher Alexander Montgomery III", "Jo", "王秀英", "Đặng Thị Ngọc Hân", "Seán O'Brien-Ó Súilleabháin", "Muthukumaran a/l Rajagopalan Subramaniam"];
const name = (i: number) => NAMES[i % NAMES.length]!;
const TEXTS = [MALAY, URL_ONLY, "Photo of my medicine", CHINESE, "Terima kasih, saya faham.", "Can I drive to the clinic myself or should someone take me?", "ok"];

const thread = (i: number) => ({
  patientId: `p-${i}`, name: name(i), initials: "SN", bed: i % 3 === 0 ? `Wad 4B Kardiologi (Lelaki), Katil ${i + 12}` : null,
  lastText: TEXTS[i % TEXTS.length]!, lastFrom: i % 7 === 4 ? "care-team" as const : "patient" as const, lastAt: at(i * 47),
  lastPhoto: i % 7 === 2 ? "Amlodipine besylate / Perindopril arginine (Coveram) 10 mg/5 mg" : null,
  // Row 5 waited 40 days: the oldest; row 4 is handled.
  waitingSince: i % 7 === 4 ? null : at(i % 7 === 5 ? 40 * 1440 : i * 47), waiting: i % 7 === 4 ? 0 : 1 + (i % 3) * 41,
  unread: i === 0 ? 1284 : i % 7 === 4 ? 0 : 1 + (i % 4),
  label: i % 7 === 4 ? null : i % 7 === 0 ? "urgent" as const : i % 7 === 6 ? "admin" as const : "clinical" as const,
  reason: i % 7 === 5 ? null : "Chest pain spreading to the left arm and jaw, not settled by two doses of GTN",
  handled: i % 7 === 4,
});
const inbox = (n: number) => ({ now, threads: rows(n, thread) });

const STAFF = ["Dr Aleksandra Wiśniewska-Kowalczyk", "Nurse Jo", "Dr Muthukumaran a/l Rajagopalan Subramaniam"];
// A 300-message thread over three weeks: the patient's long Malay message, a bare URL, a medicine photo, Chinese, and care-team replies.
const message = (patient: string, i: number, n: number) => {
  const fromPatient = i % 3 !== 1;
  const kind = i % 6;
  return {
    id: `m-${i}`, from: fromPatient ? "patient" as const : "care-team" as const,
    text: fromPatient ? (kind === 0 ? MALAY : kind === 2 ? URL_ONLY : kind === 3 ? CHINESE : "Photo of my medicine") : "Terima kasih Puan. Sila datang ke Jabatan Kecemasan sekarang dan bawa semua ubat anda.",
    createdAt: at((n - 1 - i) * 101), seenAt: fromPatient && i < n - 2 ? at((n - 1 - i) * 101 - 5) : null,
    attachment: fromPatient && kind === 5
      ? {
          kind: "medicine-photo" as const, key: `photos/p-0/${i}.jpg`, sampleReading: i % 12 === 5,
          reading: { name: "Amlodipine besylate / Perindopril arginine (Coveram)", dose: "10 mg/5 mg", frequency: "Once daily in the morning, after breakfast, swallowed whole" },
          ...(i % 12 === 11 && { decision: { status: "added" as const, reading: { name: "Coveram" }, by: "u-1", at: at((n - 1 - i) * 101 - 30).toISOString() } }),
        }
      : null,
    triage: fromPatient ? (kind === 0 ? "urgent" as const : "clinical" as const) : null,
    triageReason: fromPatient ? "Chest pain spreading to the left arm and jaw, not settled by two doses of GTN; breathless lying flat" : null,
    ...(fromPatient && { triagedBy: kind === 3 ? { source: "none" as const } : { source: "model" as const, model: "medgemma-27b-it-sona-triage-v3", decidedBy: "model" as const } }),
    rule: !fromPatient && i % 30 === 1 ? "call-999" as const : undefined,
    author: fromPatient ? patient.split(" ")[0]! : STAFF[i % STAFF.length]!,
    unanswered: fromPatient && i >= n - 2,
  };
};
const threadOf = (n: number) => ({ patientId }: { patientId: string }) => {
  const i = Number(patientId.slice(2)) || 0;
  return {
    patient: { id: patientId, name: name(i), bed: i % 3 === 0 ? `Wad 4B Kardiologi (Lelaki), Katil ${i + 12}` : null, encounterId: `e-${i}` },
    messages: rows(n, m => message(name(i), m, n)),
  };
};

// 1,200 characters: a model's draft longer than the 1,000 a reply may be.
const DRAFT = (
  "Puan Siti, terima kasih kerana memberitahu kami. Sakit dada yang menjalar ke lengan kiri dan rahang, yang tidak hilang selepas dua dos GTN, "
  + "boleh jadi tanda serangan jantung. Sila hubungi 999 atau pergi ke Jabatan Kecemasan Hospital Canselor Tuanku Muhriz sekarang juga, jangan tunggu temujanji klinik hari Khamis. "
  + "Jangan memandu sendiri; minta anak puan atau ambulans bawa puan. Bawa semua ubat puan dan surat discaj bersama. "
  + "Tentang spironolactone: berhenti dahulu sehingga kami periksa semula paras potassium puan di hospital, kerana paras itu tinggi semasa discaj. "
  + "Tentang furosemide: puan boleh makan pada waktu pagi seperti biasa; jika terlalu kerap ke tandas, kami akan bincang menukar masa atau dos selepas puan diperiksa. "
  + "Sesak nafas bila baring dan kaki bengkak juga perlu diperiksa hari ini, jadi beritahu doktor kecemasan tentang semua ini. "
  + "Kami telah memaklumkan pasukan kardiologi wad 4B bahawa puan mungkin datang. Jika sakit dada berkurangan dalam perjalanan, teruskan juga ke hospital. "
  + "Puan tidak menyusahkan kami sama sekali; ini memang soalan yang betul untuk ditanya. Kami akan hubungi puan semula selepas puan diperiksa."
).padEnd(1200, " Terima kasih.").slice(0, 1200);
const draft = {
  messageId: "m-298", label: "urgent" as const, reason: "Chest pain spreading to the left arm and jaw, not settled by two doses of GTN; breathless lying flat",
  triagedBy: { source: "model" as const, model: "medgemma-27b-it-sona-triage-v3", decidedBy: "rules" as const },
  text: DRAFT, source: "model" as const, model: "medgemma-27b-it-sona-reply-v3-lora-2026-10-02",
};

// A 4000×200 panorama, the widest a phone photo of a blister strip gets.
const PANORAMA = btoa("<svg xmlns='http://www.w3.org/2000/svg' width='4000' height='200'><rect width='4000' height='200' fill='#cfd8dc'/><text x='40' y='120' font-size='80'>Coveram 10 mg/5 mg</text></svg>");

export default [
  fixture("messages.inbox", { worst: inbox(24), empty: inbox(0), one: inbox(1), huge: inbox(1000) }),
  fixture("messages.thread", { worst: threadOf(300), empty: threadOf(0), one: threadOf(1), huge: threadOf(300) }),
  fixture("messages.draft", { worst: draft, empty: null, one: { messageId: "m-0", label: "admin" as const, reason: "Asks for nothing", triagedBy: { source: "fixture" as const }, text: "Ok.", source: "fixture" as const, waking: 90 } }),
  fixture("messages.photo", { worst: { contentType: "image/svg+xml", dataBase64: PANORAMA } }),
];

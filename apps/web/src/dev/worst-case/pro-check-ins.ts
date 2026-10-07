import { fixture, rows } from "./fixture";

// /pro/check-ins: the check-ins, the patient names they are joined to, and one visit's follow-up timeline.
// Limits: a recorded reply is 1-1000 chars (checkInReplySchema); check-in days 1-30, up to six per visit
// (checkInDaysSchema); Sona's message, the reply count and the timeline are unbounded.
const now = Date.UTC(2026, 9, 7, 1, 0);
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000);
const NAMES = ["王秀英", "Siti Nur Aisyah binti Mohd Khairuddin", "Jo", "Christopher Alexander Montgomery III", "Đặng Thị Ngọc Hân", "Muthukumaran a/l Rajagopalan Subramaniam", "Seán O'Brien-Ó Súilleabháin"];

const REPLIES = [
  { text: "胸口又开始闷痛，走几步就喘不过气，晚上要坐着才能睡。脚也肿得穿不下鞋。", label: "urgent" as const },
  { text: ("Saya rasa makin teruk sejak semalam 😟 kaki bengkak sampai lutut, berat naik 3 kg dalam dua hari, dan saya kena tidur bersandar pada tiga bantal. "
    + "Ubat furosemide saya makan pagi tapi tak banyak membantu. Anak saya tanya patutkah kami terus ke Jabatan Kecemasan Hospital Canselor Tuanku Muhriz atau tunggu temujanji Khamis. ").repeat(3).slice(0, 1000), label: "worse" as const },
  { text: "ok", label: "fine" as const },
  { text: "https://www.hospital-pakar-ukm.example.com/sona-care/check-in/9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f?day=3&lang=zh", label: "fine" as const },
  { text: "好多了，谢谢医生。", label: "fine" as const },
];
const MESSAGE = {
  zh: "您好，这是Sona，代表心脏科病房4B的护理团队。今天是您出院后的第3天。您的呼吸、脚踝肿胀和体重怎么样？请用几句话回复，我们会转告护理团队。",
  ms: "Selamat pagi, ini Sona dari pasukan jagaan Wad 4B Kardiologi. Hari ini hari ke-7 selepas anda keluar wad. Bagaimana pernafasan, bengkak kaki dan berat badan anda? Balas dalam beberapa ayat.",
  en: "Hello, this is Sona for the Ward 4B cardiology care team. How are you feeling today?",
};
const LANG = ["zh", "ms", "en"] as const;
const DAYS = [1, 3, 7, 14, 30];

const checkIn = (i: number) => {
  const language = LANG[i % 3]!;
  const r = REPLIES[i % REPLIES.length]!;
  // Every fifth is sent with no reply yet; every seventh is scheduled, not sent (the page hides those).
  const sent = i % 7 !== 6, replied = sent && i % 5 !== 4;
  const day = DAYS[i % DAYS.length]!;
  return {
    // p-8's record is not in patients.list (pro-patients.ts): the list falls back to showing the id.
    id: `ci-${i}`, patientId: i === 8 ? "p-unlisted" : `p-${i}`, encounterId: `e-${i}`, day, language, message: MESSAGE[language],
    dueAt: at(i * 61 - 60), sentAt: sent ? at(i * 61) : null,
    replies: replied
      ? [
          // A patient who answered twice: the first, closed; the newest, still flagged.
          ...(i % 4 === 1 ? [{ id: `cr-${i}-0`, text: "Okay sahaja.", label: "fine" as const, source: "fixture", decidedBy: "rules" as const, receivedAt: at(i * 61 - 20), task: null }] : []),
          {
            id: `cr-${i}`, ...r, source: r.label === "urgent" ? "medgemma-27b-it-sona-checkin-v2" : "fixture", decidedBy: r.label === "urgent" ? "rules" as const : "model" as const,
            receivedAt: at(i * 61 - 30),
            task: r.label === "fine" ? null : { id: `t-${i}`, title: `Call back ${NAMES[i % NAMES.length]} about worsening breathlessness and ankle swelling on day ${day}`, completed: i % 9 === 8 },
          },
        ]
      : [],
  };
};


const followUp = {
  timeline: [
    { at: at(3 * 1440).toISOString(), text: "Discharged from Wad 4B Kardiologi (Lelaki). Sona will check in on days 1, 3, 7, 14 and 30, in Chinese, the patient's discharge language.", tone: "neutral" as const },
    { at: at(2 * 1440).toISOString(), text: "Day 1 sent. 王秀英 replied \"还好\"; read as fine by the rules.", tone: "neutral" as const },
    { at: at(60).toISOString(), text: "Day 3 reply read as urgent: chest tightness, breathless on walking, sleeping upright. Flagged for the care team and told to call 999 if it is an emergency.", tone: "red" as const },
    { at: at(60).toISOString(), text: "Day 3 reply read as urgent: chest tightness, breathless on walking, sleeping upright. Flagged for the care team and told to call 999 if it is an emergency.", tone: "red" as const },
  ],
  next: { at: at(-4 * 1440).toISOString(), text: "Day 7 check-in, unless the care team books a clinic visit first." },
};

export default [
  fixture("checkIns.list", { worst: rows(24, checkIn), empty: [], one: rows(1, checkIn), huge: rows(1000, checkIn) }),
  fixture("checkIns.followUp", { worst: followUp, empty: null, one: { timeline: followUp.timeline.slice(0, 1), next: null } }),
];

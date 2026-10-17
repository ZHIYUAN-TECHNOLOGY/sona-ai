import { fixture, rows } from "./fixture";

// Sona Care check-ins: 30 of them (answered, today's, planned), a 1,000-character Tamil reply (the schema's max),
// a long Malay question, an urgent reply, and a long task title in "What happens next".
const DAY = 86_400_000, now = Date.now();
const at = (days: number) => new Date(now + days * DAY);

// A Tamil reply at checkInReplySchema's limit (1,000 characters): what a worried patient types on day 3.
const TAMIL = ("நேற்று இரவு முழுவதும் தூக்கம் வரவில்லை. மூச்சு விடுவதில் கொஞ்சம் சிரமம் இருந்தது, குறிப்பாக படிக்கட்டு ஏறும்போது. "
  + "காலையில் கால்கள் வீங்கியிருந்தன, மருத்துவர் சொன்னபடி உப்பைக் குறைத்துவிட்டேன். மாத்திரைகளை நேரத்திற்கு எடுத்துக்கொள்கிறேன், "
  + "ஆனால் ஃபுரோசெமைடு எடுத்த பிறகு அடிக்கடி சிறுநீர் கழிக்க வேண்டியுள்ளது. என் மகள் இரத்த அழுத்தத்தை அளந்தாள்: 148/92. "
  + "எடை இரண்டு நாட்களில் ஒன்றரை கிலோ கூடியுள்ளது. இது சாதாரணமா, அல்லது நான் மருத்துவமனைக்கு வர வேண்டுமா? ").repeat(3).slice(0, 1000);

const ASK = {
  ms: "Selamat pagi. Ini hari ketiga anda di rumah selepas keluar dari wad kardiologi. Adakah anda rasa sesak nafas, bengkak di kaki atau berat badan naik lebih daripada 1 kg sejak semalam? Balas dengan perkataan anda sendiri.",
  en: "How are you today?",
  zh: "您今天感觉怎么样？有没有气喘、脚肿或体重增加？",
} as const;

type Label = "fine" | "worse" | "urgent";
const reply = (id: string, text: string, label: Label, days: number, task?: string) => ({
  id: `r-${id}`, text, label, source: "fixture", decidedBy: "rules" as const, receivedAt: at(days),
  task: task ? { id: `t-${id}`, title: task, completed: false } : null,
});
const checkIn = (i: number, days: number, sent: boolean, replies: ReturnType<typeof reply>[] = [], language: keyof typeof ASK = "en") => ({
  id: `ci-${i}`, patientId: "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f", encounterId: "enc-9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f",
  day: i, language, message: ASK[language], dueAt: at(days), sentAt: sent ? at(days) : null, replies,
});

// Day 1 … 30, discharged 3 days ago: three answered (one urgent, one 1,000 characters in Tamil, one "Ok"), day 4 is today's, the rest planned.
const WORST = [
  checkIn(1, -3, true, [reply("1", TAMIL, "worse", -3, "Call Puan Siti Nur Aisyah binti Mohd Khairuddin about breathlessness, ankle swelling and 1.5 kg weight gain since discharge")], "zh"),
  checkIn(2, -2, true, [reply("2", "Sakit dada sejak pagi tadi, rasa berat dan berpeluh.", "urgent", -2)], "ms"),
  checkIn(3, -1, true, [reply("3", "Ok", "fine", -1)]),
  checkIn(4, 0, true, [], "ms"),
  ...rows(26, i => checkIn(i + 5, i + 1, false)),
];

export default [
  fixture("care.checkIns.list", {
    worst: WORST,
    empty: [],
    one: [checkIn(1, 0, true)],
    huge: rows(1000, i => checkIn(i + 1, i - 500, i < 500, i < 499 ? [reply(String(i), i % 7 ? "Ok" : TAMIL, i % 11 ? "fine" : "worse", i - 500)] : [])),
  }),
  // The server answers with the check-in and the reply it just read: "worse" with a long task, "urgent" for chest pain.
  fixture("care.checkIns.reply", {
    worst: ({ checkInId, text }) => {
      const urgent = /chest|dada|நெஞ்சு|胸/i.test(text);
      const base = WORST.find(c => c.id === checkInId) ?? WORST[3]!;
      return { ...base, replies: [reply(checkInId, text, urgent ? "urgent" : "worse", 0, urgent ? undefined : "Call Puan Siti Nur Aisyah binti Mohd Khairuddin about breathlessness, ankle swelling and 1.5 kg weight gain since discharge")] };
    },
    one: ({ checkInId, text }) => ({ ...checkIn(1, 0, true), id: checkInId, replies: [reply(checkInId, text, "fine", 0)] }),
  }),
];

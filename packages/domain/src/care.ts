import type { DischargePlan, Language } from "./discharge";
import type { FindingKind } from "./findings";

/**
 * Sona Care's words for the patient: the discharge plan and follow-ups without clinical shorthand, in
 * English, Malay or Chinese. Each string falls back to English when a language is missing.
 * ponytail: authored per condition rule (see discharge.ts); a model writes them per plan later.
 */
export type MedGroup = "new" | "changed" | "stopped" | "continue";
/** `take`: how to take one dose; `at`: daily times in Malaysia ("HH:MM"); `doses`: how many are left of a course (none = ongoing). As-needed medicines have no times. */
export type PatientMed = { name: string; line: string; take?: string; at?: string[]; doses?: number };

/** One string in the patient's languages; English is always there to fall back to. */
type Words = { en: string; ms?: string; zh?: string };
const say = (words: Words, lang: Language = "en") => words[lang] ?? words.en;

const CONTINUE: Words = { en: "Keep taking it as before", ms: "Teruskan makan seperti biasa", zh: "照常继续服用" };
/**
 * Plain words for each take-home medicine, keyed by the plan's own instruction (MedChange.detail), so
 * the same medicine on a different regimen never borrows another's words. Names stay as written.
 */
const MEDS: Record<string, { name?: string; line: Words; take?: Words; at?: string[]; doses?: number }> = {
  // Amelia's authored plan.
  "IV 500 mg to oral 500 mg daily, 2 more days": {
    line: { en: "Now a tablet once a day, for 2 more days", ms: "Kini sebiji tablet sehari, selama 2 hari lagi", zh: "现在改为每天一片，再服两天" },
    take: { en: "1 tablet, with or without food", ms: "1 tablet, sebelum atau selepas makan", zh: "每次一片，饭前饭后都可以" }, at: ["08:00"], doses: 2,
  },
  "1 g every 6 h as needed, max 4 g a day": {
    line: { en: "For pain or fever: 1 g every 6 hours if you need it, no more than 4 g a day", ms: "Untuk sakit atau demam: 1 g setiap 6 jam jika perlu, tidak lebih daripada 4 g sehari", zh: "疼痛或发烧时：需要时每6小时1克，每天不超过4克" },
  },
  "Back to her own inhaler as needed": {
    name: "Salbutamol nebuliser", line: { en: "Use your own inhaler instead, when you need it", ms: "Guna inhaler anda sendiri, apabila perlu", zh: "需要时改用您自己的吸入器" },
  },
  "Patient-reported, continue": { line: CONTINUE, take: { en: "1 tablet at night", ms: "1 tablet pada waktu malam", zh: "晚上一片" }, at: ["21:00"] },
  // Other patients' plans (discharge.ts condition rules). Synthetic regimens: need clinical review before real use.
  "IV to oral 500 mg twice daily, to finish 10 days (check against sensitivities)": {
    line: { en: "A tablet twice a day, until the 10 days are finished", ms: "Sebiji tablet dua kali sehari, sehingga cukup 10 hari", zh: "每天两次，每次一片，直到服满十天" },
  },
  "400 mg every 8 h with food, for 3 days": { line: { en: "400 mg every 8 hours with food, for 3 days", ms: "400 mg setiap 8 jam bersama makanan, selama 3 hari", zh: "每8小时400毫克，随餐服用，共三天" } },
  "Ward-only pain relief, not needed at home": { line: { en: "Only used in hospital, not needed at home", ms: "Hanya digunakan di hospital, tidak perlu di rumah", zh: "只在医院使用，回家后不需要" } },
  "IV to oral 300 mg four times daily, 5 more days": { line: { en: "300 mg four times a day, for 5 more days", ms: "300 mg empat kali sehari, selama 5 hari lagi", zh: "每天四次，每次300毫克，再服五天" } },
  "IV to oral 500 mg four times daily, 5 more days": { line: { en: "500 mg four times a day, for 5 more days", ms: "500 mg empat kali sehari, selama 5 hari lagi", zh: "每天四次，每次500毫克，再服五天" } },
  "IV to oral 500 mg daily, to complete 5 days": { line: { en: "500 mg once a day, until 5 days in all are finished", ms: "500 mg sekali sehari, sehingga cukup 5 hari semuanya", zh: "每天一次，每次500毫克，共服满五天" } },
  "IV to oral 1 g three times daily, to complete 5 days": { line: { en: "1 g three times a day, until 5 days in all are finished", ms: "1 g tiga kali sehari, sehingga cukup 5 hari semuanya", zh: "每天三次，每次1克，共服满五天" } },
  "IV to oral 40 mg each morning; weigh daily": { line: { en: "40 mg each morning, and weigh yourself every day", ms: "40 mg setiap pagi, dan timbang berat badan setiap hari", zh: "每天早上40毫克，并每天称体重" } },
  "5 mg twice daily, for atrial fibrillation (start as the stroke team planned)": {
    line: { en: "5 mg twice a day, starting when the stroke team told you", ms: "5 mg dua kali sehari, mula seperti yang diberitahu pasukan strok", zh: "每天两次，每次5毫克，按中风团队交代的时间开始" },
  },
  "40 mg at night": { line: { en: "40 mg at night", ms: "40 mg pada waktu malam", zh: "晚上40毫克" } },
  "Continue as before": { line: CONTINUE },
};

/** Take-home medicines grouped the way a patient reads a change: new, changed, stopped, carry on. An unknown instruction reads as written. */
export function patientMeds(plan: DischargePlan, lang: Language = "en"): Record<MedGroup, PatientMed[]> {
  const groups: Record<MedGroup, PatientMed[]> = { new: [], changed: [], stopped: [], continue: [] };
  for (const med of plan.meds) {
    const plain = MEDS[med.detail];
    groups[med.change === "unchanged" ? "continue" : med.change].push({
      name: plain?.name ?? med.name, line: plain ? say(plain.line, lang) : med.detail, take: plain?.take && say(plain.take, lang), at: plain?.at, doses: plain?.doses,
    });
  }
  return groups;
}

const FAINT: Words = { en: "Chest pain, or you feel faint", ms: "Sakit dada, atau rasa hendak pitam", zh: "胸痛，或感觉快要晕倒" };
const FEVER: Words = { en: "The fever comes back", ms: "Demam kembali", zh: "再次发烧" };
const REVIEW: Words = { en: "Clinic review", ms: "Semakan klinik", zh: "门诊复诊" };
/**
 * After each condition: the clinic review the discharge books (what it is called and why), and when to
 * come back, from the leaflet plus the check-ins' urgent words (chest pain, fainting).
 * Pneumonia is Amelia's authored plan; the others follow the leaflets in discharge.ts and need clinical
 * review before real use.
 */
const AFTER: Record<string, { title: Words; why: Words; signs: Words[] }> = {
  pneumonia: {
    title: REVIEW, why: { en: "To see how you're doing after your pneumonia", ms: "Untuk melihat keadaan anda selepas radang paru-paru", zh: "看看您肺炎后恢复得怎样" },
    signs: [
      { en: "Breathing gets harder", ms: "Pernafasan menjadi lebih sukar", zh: "呼吸变得更困难" },
      { en: "Your lips or fingertips turn blue", ms: "Bibir atau hujung jari menjadi biru", zh: "嘴唇或指尖发紫" },
      FEVER, FAINT,
    ],
  },
  pyelonephritis: {
    title: REVIEW, why: { en: "To go through your urine test result and see how you're doing", ms: "Untuk melihat keputusan ujian air kencing dan keadaan anda", zh: "看看尿液检查结果和您的恢复情况" },
    signs: [FEVER, { en: "Pain in your back or side", ms: "Sakit di belakang atau di sisi badan", zh: "腰背或侧腰疼痛" }, { en: "You keep vomiting", ms: "Muntah berterusan", zh: "持续呕吐" }, FAINT],
  },
  appendicitis: {
    title: { en: "Surgical clinic", ms: "Klinik pembedahan", zh: "外科门诊" }, why: { en: "To check your wounds after the operation", ms: "Untuk memeriksa luka anda selepas pembedahan", zh: "检查手术后的伤口" },
    signs: [{ en: "You have a fever", ms: "Anda demam", zh: "发烧" }, { en: "Tummy pain gets worse", ms: "Sakit perut bertambah teruk", zh: "腹痛加剧" }, { en: "A wound turns red or leaks", ms: "Luka menjadi merah atau berair", zh: "伤口红肿或渗液" }],
  },
  cellulitis: {
    title: { en: "Wound clinic", ms: "Klinik luka", zh: "伤口门诊" }, why: { en: "To check the infection in your leg is clearing", ms: "Untuk memastikan jangkitan pada kaki anda semakin pulih", zh: "确认腿部感染正在好转" },
    signs: [{ en: "The redness spreads", ms: "Kemerahan merebak", zh: "红肿扩散" }, { en: "You get a fever", ms: "Anda demam", zh: "发烧" }, { en: "The leg becomes very painful", ms: "Kaki menjadi sangat sakit", zh: "腿部剧痛" }],
  },
  "heart-failure": {
    title: { en: "Heart failure clinic", ms: "Klinik kegagalan jantung", zh: "心衰门诊" },
    why: { en: "To check your weight, fluid and kidney blood test", ms: "Untuk menyemak berat badan, cecair dan ujian darah buah pinggang anda", zh: "检查体重、体液和肾功能验血" },
    signs: [
      { en: "Your weight goes up by 2 kg in 3 days", ms: "Berat badan naik 2 kg dalam 3 hari", zh: "三天内体重增加两公斤" },
      { en: "Your ankles swell", ms: "Buku lali bengkak", zh: "脚踝肿胀" },
      { en: "You are breathless lying flat", ms: "Sesak nafas ketika berbaring", zh: "平躺时气喘" }, FAINT,
    ],
  },
  stroke: {
    title: { en: "Stroke clinic", ms: "Klinik strok", zh: "中风门诊" }, why: { en: "To check how your recovery is going", ms: "Untuk menyemak kemajuan pemulihan anda", zh: "看看您的康复进展" },
    signs: [
      { en: "Your face droops: call 999", ms: "Muka senget: hubungi 999", zh: "脸部下垂：请拨打999" },
      { en: "An arm or leg goes weak: call 999", ms: "Lengan atau kaki menjadi lemah: hubungi 999", zh: "手脚无力：请拨打999" },
      { en: "Your speech changes: call 999", ms: "Percakapan berubah: hubungi 999", zh: "说话异常：请拨打999" },
    ],
  },
};
const GENERIC = {
  title: REVIEW, why: { en: "To see how you're doing since you went home", ms: "Untuk melihat keadaan anda sejak pulang ke rumah", zh: "看看您出院后的情况" },
  signs: [{ en: "You feel worse", ms: "Anda berasa lebih teruk", zh: "感觉更差" }, { en: "You have a fever", ms: "Anda demam", zh: "发烧" }, { en: "You find it hard to breathe", ms: "Anda sukar bernafas", zh: "呼吸困难" }, FAINT],
};
const after = (plan: DischargePlan) => AFTER[plan.condition ?? ""] ?? GENERIC;

/** When to come back or call, for the patient's own condition. */
export const warningSigns = (plan: DischargePlan, lang: Language = "en") => after(plan).signs.map(s => say(s, lang));
/** The clinic review the discharge booked, named for the condition ("Wound clinic"), with why. */
export function reviewWords(plan: DischargePlan, lang: Language = "en") {
  const { title, why } = after(plan);
  return { title: say(title, lang), short: say(title, lang), why: say(why, lang) };
}

const TESTS: [RegExp, { title: Words; short: Words }][] = [
  [/CT chest/i, { title: { en: "CT scan of your chest", ms: "Imbasan CT dada anda", zh: "胸部CT扫描" }, short: { en: "CT scan", ms: "Imbasan CT", zh: "CT扫描" } }],
  [/echocardiogram/i, { title: { en: "Heart scan (echocardiogram)", ms: "Imbasan jantung (ekokardiogram)", zh: "心脏超声检查" }, short: { en: "Heart scan", ms: "Imbasan jantung", zh: "心脏超声" } }],
  [/chest X-ray/i, { title: { en: "Chest X-ray or ultrasound", ms: "X-ray dada atau ultrasound", zh: "胸部X光或超声" }, short: { en: "Chest X-ray", ms: "X-ray dada", zh: "胸部X光" } }],
];
const WHY: Record<FindingKind, Words> = {
  nodule: { en: "To check the small spot on your lung X-ray", ms: "Untuk memeriksa tompok kecil pada X-ray paru-paru anda", zh: "检查肺部X光上的小阴影" },
  cardiomegaly: { en: "To check the size of your heart seen on your X-ray", ms: "Untuk memeriksa saiz jantung anda yang dilihat pada X-ray", zh: "检查X光上看到的心脏大小" },
  effusion: { en: "To check for fluid around your lung seen on your X-ray", ms: "Untuk memeriksa cecair di sekeliling paru-paru yang dilihat pada X-ray", zh: "检查X光上看到的肺部周围积液" },
};
const ASKED: Words = { en: "A test your doctor asked for", ms: "Ujian yang diminta oleh doktor anda", zh: "医生安排的检查" };
const BOOKED: Words = { en: "Your booked appointment", ms: "Temu janji yang telah ditempah", zh: "您已预约的就诊" };
/** The words an appointment kind starts with ("clinic visit", "Visit: Dr. Lim, …", "Clinic review · …"); the rest (a doctor, a reason) stays as written. */
const LEADS: [RegExp, Words][] = [
  [/^clinic visit/i, { en: "Clinic visit", ms: "Lawatan klinik", zh: "门诊" }],
  [/^clinic review/i, REVIEW],
  [/^visit(?=:)/i, { en: "Visit", ms: "Lawatan", zh: "就诊" }],
];

/** An appointment's kind ("clinic visit", "recall: CT chest") in plain words, with a short form for one-line rows. */
export function appointmentWords(kind: string, finding?: FindingKind, lang: Language = "en") {
  const why = say(finding ? WHY[finding] : ASKED, lang);
  const test = TESTS.find(([re]) => re.test(kind))?.[1];
  if (test) return { title: say(test.title, lang), short: say(test.short, lang), why };
  const name = kind.replace(/^recall:\s*/i, "");
  const lead = LEADS.find(([re]) => re.test(name));
  const title = lead ? name.replace(lead[0], say(lead[1], lang)) : name.charAt(0).toUpperCase() + name.slice(1);
  return { title, short: title, why: finding ? why : say(BOOKED, lang) };
}

/** A past visit is attended once a doctor opened or saved the patient's visit that day, else missed (call the clinic). */
export type FollowUpStatus = "upcoming" | "due-soon" | "attended" | "missed";
/** The calendar day in Malaysia, as a number, so two times can be compared by day. */
export const malaysianDay = (d: Date) => Math.floor((d.getTime() + 8 * 3600_000) / 86_400_000);
/**
 * Calendar days from today in Malaysia (negative once past), and the status: due soon within a week,
 * including all of the visit's own day; only once that day has ended is it attended or missed.
 */
export function followUpTiming(date: Date, now: Date, attended = false): { inDays: number; status: FollowUpStatus } {
  const inDays = malaysianDay(date) - malaysianDay(now);
  return { inDays, status: inDays < 0 ? (attended ? "attended" : "missed") : inDays <= 7 ? "due-soon" : "upcoming" };
}

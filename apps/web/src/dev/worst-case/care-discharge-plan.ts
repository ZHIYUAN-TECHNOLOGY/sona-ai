import { fixture, rows } from "./fixture";

// Sona Care's discharge plan (care.discharge, also read by Medicines), follow-ups and check-ins.
// Worst: a Chinese-language plan, 400 days after discharge, 18 take-home medicines four times a day, 12 warning signs.
const DAY = 86_400_000, NOW = Date.now();
const ago = (days: number) => new Date(NOW - days * DAY);
const FOUR = ["08:00", "12:00", "18:00", "22:00"];
const PATIENT = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f", VISIT = "enc-9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";

type Med = { name: string; line: string; take?: string; at?: string[]; doses?: number; endsAt?: Date; finished?: boolean };
const four = (name: string, line: string, take = "每次一片，饭后服用"): Med => ({ name, line, take, at: FOUR });

/** Medicines a patient takes on their own; Medicines' fixtures mark some of their doses taken. */
export const WORST_MEDS: Record<"new" | "changed" | "continue" | "stopped", Med[]> = {
  new: [
    { name: "Amoxicillin/clavulanic acid (Augmentin) 625 mg", line: "每天四次，每次一片，共七天", take: "每次一片，饭后服用", at: FOUR, doses: 28, endsAt: ago(393), finished: true },
    four("Perindopril arginine/amlodipine (Coveram) 10 mg/5 mg", "每天四次，每次一片（医生按您的血压调整过）"),
    four("Metformin hydrochloride extended-release (Glucophage XR) 1000 mg", "每天四次，随餐服用，不要咬碎"),
    four("Insulin glargine (Lantus SoloStar) 100 units/mL", "每天四次，每次按血糖记录本上的单位注射", "按记录本上的单位，在腹部皮下注射"),
    four("Apixaban (Eliquis) 5 mg", "每天四次，每次一片"),
    four("Potassium chloride slow-release (Slow-K) 600 mg", "每天四次，每次一片，整片吞服"),
  ],
  changed: [
    four("Furosemide (Lasix) 40 mg", "剂量改了：每天四次，每次半片，并每天称体重"),
    four("Bisoprolol 2.5 mg", "剂量改了：每天四次，每次一片"),
  ],
  continue: [
    four("Paracetamol 1 g", "疼痛或发烧时：需要时每6小时1克，每天不超过4克"),
    four("Spironolactone 25 mg", "照常继续服用"),
    four("Atorvastatin 40 mg", "照常继续服用"),
    four("Omeprazole 20 mg", "照常继续服用，饭前半小时"),
    four("Ipratropium/salbutamol (Combivent UDV) 2.5 mL nebuliser", "照常继续使用", "用雾化器吸入一支"),
    four("Lactulose 10 mL", "照常继续服用"),
    four("Ferrous fumarate 200 mg", "照常继续服用"),
    four("Glyceryl trinitrate (GTN) 0.5 mg sublingual tablet", "胸痛时舌下含一片", "胸痛时舌下含一片，五分钟后可再含一片"),
    { name: "Ventolin Evohaler", line: "需要时改用您自己的吸入器" },
  ],
  stopped: [
    { name: "Prednisolone 5 mg", line: "停药：不要再服用" },
    { name: "Senna 7.5 mg", line: "停药：不要再服用" },
  ],
};

const WARNING_SIGNS = [
  "胸口疼痛、压迫感，或痛感扩散到左手臂、下巴或背部",
  "呼吸困难，躺下时更喘，或晚上因为喘不过气而醒来",
  "嘴唇或指甲发紫",
  "发烧超过38摄氏度，并且发冷发抖",
  "一天内体重增加超过1公斤，或一周内增加超过2公斤",
  "脚踝、小腿或肚子肿得越来越厉害",
  "咳出血或粉红色泡沫痰",
  "心跳很快、不规则，或感觉快要晕倒",
  "突然一边脸、手或脚无力或麻木，说话不清楚",
  "大便呈黑色或带血，或呕吐物像咖啡渣",
  "一整天都没有小便，或小便非常少",
  "感到非常困倦、意识不清，家人叫不醒",
];

const LEAFLET_ZH = "您因心力衰竭加重和肺部感染住院十二天。住院期间，医生用静脉利尿剂帮您排出身体里多余的水分，并用抗生素治疗肺炎。您的呼吸已经好转，体重比入院时减轻了四公斤。出院后请每天早上称体重并记录下来；如果一天内增加超过一公斤，请联系医院。请按时服用所有药物，不要自己停药。饮食上请少盐，每天喝水不超过1.5升。请记得在复诊时带上您的血压和血糖记录本，以及所有药物。";

const leaflets = (text: string) => [
  { language: "zh" as const, label: "中文", name: "Chinese", text, source: "model" as const, model: "gemma-3-27b-it", approvedBy: "Dr. Nurul Ain binti Abdul Rahman", approvedAt: ago(400).toISOString() },
  { language: "ms" as const, label: "BM", name: "Bahasa Melayu", text: "Anda dimasukkan ke wad kerana kegagalan jantung dan jangkitan paru-paru.", source: "fixture" as const },
  { language: "en" as const, label: "EN", name: "English", text: "You were in hospital for heart failure and a chest infection.", source: "fixture" as const },
];

const plan = (days: number, medicines: typeof WORST_MEDS, warningSigns: string[], checkIns: number[], text?: string) => ({
  status: "discharged" as const, dischargedAt: ago(days).toISOString(), language: "zh" as const,
  leaflets: text ? leaflets(text) : [],
  medicines, warningSigns,
  followUp: checkIns.length ? { title: "心脏科门诊复诊", date: new Date(NOW + 3 * DAY) } : null,
  checkIns: checkIns.map(day => ({ day, date: new Date(ago(days).getTime() + day * DAY) })),
});

export const WORST_DISCHARGED_DAYS = 400, ONE_DISCHARGED_DAYS = 1;
export const ONE_MEDS: typeof WORST_MEDS = { new: [{ name: "Paracetamol 1 g", line: "For pain or fever", take: "2 tablets", at: ["08:00"] }], changed: [], continue: [], stopped: [] };
const NONE: typeof WORST_MEDS = { new: [], changed: [], continue: [], stopped: [] };

const visit = (id: string, days: number, title: string, why: string) => {
  const inDays = Math.round(days);
  return { id, date: new Date(NOW + days * DAY), title, short: title, why, inDays, status: inDays < 0 ? "missed" as const : inDays <= 7 ? "due-soon" as const : "upcoming" as const };
};

const checkIn = (day: number, sent: boolean, i = day) => ({
  id: `ci-${i}`, patientId: PATIENT, encounterId: VISIT, day, language: "zh" as const, message: "您好，今天感觉怎么样？呼吸和脚肿有没有变化？",
  dueAt: ago(WORST_DISCHARGED_DAYS - day), sentAt: sent ? ago(WORST_DISCHARGED_DAYS - day) : null, replies: [],
});

export default [
  fixture("care.discharge", {
    worst: plan(WORST_DISCHARGED_DAYS, WORST_MEDS, WARNING_SIGNS, [2, 7, 14, 30, 60, 90, 180, 365], LEAFLET_ZH),
    empty: plan(0, NONE, [], []),
    one: plan(ONE_DISCHARGED_DAYS, ONE_MEDS, ["Fever over 38°C"], [2], "You had a chest infection."),
  }),
  fixture("care.followUps", {
    worst: [
      visit("recall:f-1", -12, "Echocardiogram (heart ultrasound) at the Cardiology Clinic, Block C, Level 3", "Your doctor asked for this test to see how well your heart pumps after the change in your water tablets."),
      visit("discharge-review", 3, "心脏科门诊复诊", "检查您的心脏和药物。"),
      visit("appt-2", 21, "Renal profile and HbA1c blood test", "To check your kidneys and sugar on the new medicines."),
      visit("appt-3", 120, "Diabetes clinic", "A routine review."),
    ],
    empty: [],
    one: [visit("discharge-review", 6, "Clinic review", "To check you are getting better.")],
    huge: rows(40, i => visit(`appt-${i}`, i * 9 - 30, `Clinic review ${i + 1}`, "A routine review.")),
  }),
  fixture("care.checkIns.list", {
    worst: [checkIn(2, true), checkIn(7, true), checkIn(14, true), checkIn(30, true), checkIn(60, true), checkIn(90, true), checkIn(180, true), checkIn(365, true), checkIn(400, false)],
    empty: [],
    one: [checkIn(2, false)],
  }),
];

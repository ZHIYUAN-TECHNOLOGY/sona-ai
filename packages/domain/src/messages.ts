import { readReply } from "./check-ins";
import type { Language } from "./discharge";

/**
 * The care team's inbox: each patient message is triaged (urgent, clinical or admin) so the nurse
 * reads the urgent ones first, and a reply is drafted for a human to check before sending. These
 * are the rule-based stand-ins behind the model seam (models.ts triageMessage and draftReply).
 * ponytail: keyword rules; they cannot read negation ("no chest pain"). A model replaces them, and
 * the urgent words stay as its safety floor.
 */
export type MessageLabel = "urgent" | "clinical" | "admin";
export const LABEL_RANK: Record<MessageLabel, number> = { urgent: 3, clinical: 2, admin: 1 };

// The check-in urgent words (readReply) plus breathlessness, which in a message waits for no one.
// Malay word order varies ("sakit dada", "dada saya sakit", "dada rasa sakit"), so allow up to two words between.
const URGENT = /chest pain|pain in (my )?chest|chest (is )?(hurting|tight)|sakit(\s+\S+){0,2}\s+dada|dada(\s+\S+){0,2}\s+(sakit|sesak|ketat)|breathless|short(ness)? of breath|can'?t breathe|cannot breathe|sesak nafas|susah bernafas|tak boleh bernafas|pengsan|faint|coughing blood|batuk darah|胸痛|呼吸困难|气促|气短|喘不过气|晕倒|咳血/i;
const CLINICAL = /medicine|medication|tablet|pill|dose|antibiotic|inhaler|side effect|fever|cough|pain|rash|vomit|dizzy|swollen|ubat|\bpil\b|\bdos\b|antibiotik|demam|batuk|sakit|ruam|muntah|pening|bengkak|药|剂量|抗生素|发烧|咳嗽|痛|皮疹|呕吐|头晕|肿/i;
const ADMIN = /visit|appointment|\bbook|reschedul|\bbill|invoice|payment|letter|medical certificate|sick leave|insurance|claim|temu ?janji|lawatan|\bbil\b|bayaran|surat|sijil|cuti sakit|insurans|复诊|预约|账单|付款|证明信|信件|病假|证明|保险/i;
// "Cuti sakit" (sick leave) is admin, not a pain.
const ADMIN_PHRASES = /cuti sakit|sijil sakit/gi;

/** The label and the words that decided it, for the chip's reason. Unclear messages go to a clinician. */
export function triageByRules(text: string): { label: MessageLabel; reason: string } {
  const urgent = text.match(URGENT)?.[0] ?? (readReply(text) === "urgent" ? "an emergency sign" : undefined);
  if (urgent) return { label: "urgent", reason: `Mentions “${urgent.toLowerCase()}”: possible emergency` };
  const clinical = text.replace(ADMIN_PHRASES, "").match(CLINICAL)?.[0];
  if (clinical) return { label: "clinical", reason: `Mentions “${clinical.toLowerCase()}”` };
  const admin = text.match(ADMIN)?.[0] ?? text.match(/\bMC\b/)?.[0];
  if (admin) return { label: "admin", reason: `About “${admin.trim().toLowerCase()}”` };
  return { label: "clinical", reason: "Not clearly admin, so a clinician reads it" };
}

/** What a draft may say: only the patient's own plan (medicine lines already in their language) and their next visit. */
export type DraftPlan = { medicines: { name: string; line: string }[]; nextVisit?: string };
export const DRAFT_MAX = 280;

const T = {
  urgent: {
    en: (n: string) => `Hi ${n}, please call 999 or go to the nearest emergency department now. Don't wait for a reply here. Your care team will call you.`,
    ms: (n: string) => `Hai ${n}, sila hubungi 999 atau pergi ke jabatan kecemasan terdekat sekarang. Jangan tunggu balasan di sini. Pasukan penjagaan anda akan menelefon anda.`,
    zh: (n: string) => `${n}您好，请立即拨打999或前往最近的急诊部。不要在这里等回复。医护团队会给您打电话。`,
  },
  medicine: {
    en: (n: string, name: string, line: string) => `Hi ${n}, about your ${name}: ${line}. If anything else worries you, a nurse can call you today.`,
    ms: (n: string, name: string, line: string) => `Hai ${n}, tentang ${name} anda: ${line}. Jika ada perkara lain yang merisaukan, jururawat boleh menelefon anda hari ini.`,
    zh: (n: string, name: string, line: string) => `${n}您好，关于您的${name}：${line}。如果还有其他担心，护士今天可以给您打电话。`,
  },
  clinical: {
    en: (n: string) => `Hi ${n}, thank you for telling us. A nurse will call you today to talk it through. If you feel much worse, call 999.`,
    ms: (n: string) => `Hai ${n}, terima kasih kerana memberitahu kami. Jururawat akan menelefon anda hari ini. Jika anda rasa lebih teruk, hubungi 999.`,
    zh: (n: string) => `${n}您好，谢谢您告诉我们。护士今天会给您打电话详细了解。如果感觉明显变差，请拨打999。`,
  },
  visit: {
    en: (n: string, at: string) => `Hi ${n}, your next visit is ${at}. If you need another time, you can book it in Sona Care or reply here.`,
    ms: (n: string, at: string) => `Hai ${n}, lawatan anda yang seterusnya ialah ${at}. Jika perlu masa lain, tempah dalam Sona Care atau balas di sini.`,
    zh: (n: string, at: string) => `${n}您好，您下次复诊是${at}。如需改时间，可以在 Sona Care 预约，或在这里回复。`,
  },
  admin: {
    en: (n: string) => `Hi ${n}, thank you. Our team will look into this and reply here. Your visits and bookings are in Sona Care.`,
    ms: (n: string) => `Hai ${n}, terima kasih. Pasukan kami akan menyemak perkara ini dan membalas di sini. Lawatan dan tempahan anda ada dalam Sona Care.`,
    zh: (n: string) => `${n}您好，谢谢。我们的团队会跟进，并在这里回复。您的复诊和预约都在 Sona Care 里。`,
  },
};

/**
 * A short, kind, safe reply by template: urgent sends them to 999 now; clinical quotes their own plan
 * when they name one of their medicines, else a nurse calls; admin points to their next visit. Never
 * advice beyond the plan. A person checks it before it is sent.
 */
export function draftByRules({ text, label, patientFirstName: n, plan, language: l }: { text: string; label: MessageLabel; patientFirstName: string; plan?: DraftPlan; language: Language }): string {
  const lower = text.toLowerCase();
  const med = plan?.medicines.find(m => m.name.toLowerCase().split(/\W+/).some(w => w.length >= 5 && lower.includes(w)));
  const draft = label === "urgent" ? T.urgent[l](n)
    : label === "clinical" ? (med ? T.medicine[l](n, med.name, med.line.replace(/[.。]$/, "")) : T.clinical[l](n))
    : plan?.nextVisit ? T.visit[l](n, plan.nextVisit) : T.admin[l](n);
  return draft.length > DRAFT_MAX ? `${draft.slice(0, DRAFT_MAX - 1).trimEnd()}…` : draft;
}

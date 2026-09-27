import type { Language } from "./discharge";

/**
 * Demo flow 7, after-discharge check-ins (docs/research/ops-demo-flows.md). Messages go out on day 2
 * and day 7 in the leaflet's language through a simulated inbox; no real patient is contacted.
 */
export const CHECK_IN_DAYS = [2, 7] as const;
export type CheckInDay = (typeof CHECK_IN_DAYS)[number];
/** How a reply was read: worse or urgent replies become a flagged task on the doctor's day. */
export type ReplyLabel = "fine" | "worse" | "urgent";
export type CheckInLanguage = Language;

/** A check-in as the server lists it and the app's fixture holds it. */
export type Reply = { id: string; text: string; label: ReplyLabel; source: string; receivedAt: Date; task: { id: string; title: string; completed: boolean } | null };
export type CheckIn = { id: string; patientId: string; encounterId: string; day: number; language: Language; message: string; dueAt: Date; sentAt: Date | null; replies: Reply[] };

// ponytail: every demo hospital keeps Malaysian time; read it from the hospital row once one is elsewhere.
const OFFSET_HOURS = 8, SEND_HOUR = 10;

/** Day N counts from the discharge's calendar day in Malaysia; each message goes at 10:00 local. */
export function checkInSchedule(dischargedAt: Date): { day: CheckInDay; dueAt: Date }[] {
  const local = new Date(dischargedAt.getTime() + OFFSET_HOURS * 3600_000);
  return CHECK_IN_DAYS.map(day => ({ day, dueAt: new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day, SEND_HOUR - OFFSET_HOURS)) }));
}

// ponytail: one demo hospital; the name comes from the hospital row once there are more.
const HOSPITAL = "Demo General Hospital";
/** Short and plain, so it reads on any phone; every message points emergencies to 999. */
export function checkInMessage(firstName: string, language: Language): string {
  return {
    en: `Hi ${firstName}, this is ${HOSPITAL} checking in after your discharge. How are you feeling today? Reply here; for an emergency call 999.`,
    ms: `Hai ${firstName}, ini ${HOSPITAL} bertanya khabar selepas anda keluar wad. Bagaimana keadaan anda hari ini? Balas di sini; jika kecemasan, hubungi 999.`,
    zh: `${firstName}您好，这里是${HOSPITAL}，出院后回访。您今天感觉怎么样？请在此回复；如有紧急情况，请拨打999。`,
  }[language];
}

/**
 * The stub reader behind `classifyReply` (and the app's fixture): keywords in the three languages.
 * ponytail: a keyword rule standing in for Gemma; it cannot read negation ("no fever").
 */
export function readReply(text: string): ReplyLabel {
  if (/chest pain|sakit dada|cannot breathe|can't breathe|tak boleh bernafas|sesak nafas teruk|pengsan|faint|胸痛|呼吸困难|晕倒/i.test(text)) return "urgent";
  // "worse", "teruk" and "更差" cover Sona Care's quick "Worse" answer in each language.
  return /fever|demam|发烧|breath|sesak|pain|sakit|worse|teruk|更差/i.test(text) ? "worse" : "fine";
}

const SYMPTOMS: [RegExp, string][] = [
  [/chest pain|sakit dada|胸痛/i, "chest pain"], [/fever|demam|发烧/i, "fever returned"], [/breath|nafas|呼吸/i, "breathing worse"],
];
/**
 * Worse and urgent replies become a flagged task named by what the patient said (the model's short
 * symptom when it gave one, else a keyword match); urgent ranks above worse. Fine replies are only logged.
 */
export function replyFlag(firstName: string, label: ReplyLabel, text: string, read?: string): { title: string; label: "worse" | "urgent"; score: number } | undefined {
  if (label === "fine") return undefined;
  const symptom = read?.trim().toLowerCase().replace(/[.!]+$/, "") || (SYMPTOMS.find(([pattern]) => pattern.test(text))?.[1] ?? "feeling worse");
  // Above an unacknowledged lab result (100): a patient at home who is getting worse comes first.
  return { title: `${firstName}: ${symptom} after discharge`, label, score: label === "urgent" ? 120 : 105 };
}

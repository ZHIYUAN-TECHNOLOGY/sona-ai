/** Pure helpers for the Sona Care discharge plan and check-in pages. */

export type Lang = "en" | "ms" | "zh";

/** The browser's language as the server knows it; English otherwise. */
export function langOf(tag: string | undefined): Lang {
  const two = tag?.slice(0, 2).toLowerCase();
  return two === "ms" || two === "zh" ? two : "en";
}

export const browserLang = () => langOf(typeof navigator === "undefined" ? undefined : navigator.language);

export const dayWords = (at: Date | string) =>
  new Date(at).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

type Asked = { sentAt: Date | string | null; dueAt: Date | string; replies: unknown[] };

/** Sent and unanswered: the newest one is the question to answer now. */
export function currentCheckIn<T extends Asked>(list: T[]): T | undefined {
  return list.filter(c => c.sentAt && !c.replies.length).at(-1);
}

/** The next one not yet sent. */
export function nextCheckIn<T extends Asked>(list: T[]): T | undefined {
  return list.find(c => !c.sentAt);
}

export type Lead = { tone: "soon" | "done" | "info"; title: string; text: string; to?: "/care/check-ins" };

type Visit = { title: string; date: Date | string; inDays: number; status: string };
type Med = { name: string; take?: string | false; finished?: boolean };

/** The one thing that matters most today: a waiting check-in, a visit today or tomorrow, a missed visit, else the first medicine to take. */
export function leadOf(input: { checkInWaiting: boolean; visits: Visit[]; meds: Med[] }): Lead {
  if (input.checkInWaiting) return { tone: "soon", title: "Your care team is asking how you are", text: "Answer today's check-in. It takes a minute.", to: "/care/check-ins" };
  const soon = input.visits.find(v => v.inDays === 0 || v.inDays === 1);
  if (soon) return { tone: "soon", title: `${soon.title} is ${soon.inDays === 0 ? "today" : "tomorrow"}`, text: `${dayWords(soon.date)}. Bring your medicines with you.` };
  const missed = input.visits.find(v => v.status === "missed");
  if (missed) return { tone: "soon", title: `You missed: ${missed.title}`, text: "Call the clinic to book a new time." };
  const med = input.meds.find(m => !m.finished && m.take);
  if (med) return { tone: "info", title: `Take your ${med.name}`, text: String(med.take) };
  return { tone: "done", title: "Nothing is due today", text: "Rest, and keep taking your medicines as planned." };
}

/** What happens after a reply, from the label the server gave it. */
export function afterReply(label: "fine" | "worse" | "urgent", task: { title: string } | null) {
  if (label === "urgent") return { tone: "urgent" as const, title: "Call the hospital now", text: "Call 999 or go to the nearest emergency department. Your care team has been told." };
  if (label === "worse") return { tone: "soon" as const, title: "Your care team has been told", text: task ? `They will follow up: ${task.title}` : "They will call you. Keep your phone near you." };
  return { tone: "done" as const, title: "Thank you. Your reply was sent", text: "Your care team will see it." };
}

/** WAV bytes as base64 for care.transcribe. */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Where the lead's next step goes: the check-in, the visits, or the medicines. Nothing when nothing is due. */
export function nextOf(lead: Lead) {
  if (lead.to) return { label: "Answer now", to: lead.to };
  if (lead.tone === "soon") return { label: "See follow-ups", to: "/care/follow-ups" as const };
  if (lead.tone === "info") return { label: "See medicines", to: "/care/medicines" as const };
  return undefined;
}

/** The opening sentence of a leaflet, for a one-line summary. */
export const firstSentence = (text: string) => (text.match(/^[\s\S]*?[.!?。](?=\s|$)/)?.[0] ?? text).trim();

/** Whole days from then to now; never negative. */
export const daysSince = (at: Date | string, now: Date) => Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 86_400_000));

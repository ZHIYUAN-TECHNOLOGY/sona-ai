import { pushTokens } from "@sona-ai/db/schema/clinical";
import { appointmentWords } from "@sona-ai/domain/care";
import { and, eq, inArray } from "drizzle-orm";

import type { Context } from "./context";
import { lastDischarge } from "./routers/care-plan";

/**
 * Sona Care push notifications through Expo's push service: one batch per patient to every phone they
 * registered. A push never fails the write that caused it (errors are logged and dropped), and a
 * phone Expo reports as DeviceNotRegistered (app deleted, permission off) is forgotten.
 */
export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export type Push = { title: string; body: string; data: { url: string } };
type PushContext = Pick<Context, "db" | "fetch">;

/** A phone for this patient account; a token that moves to another account (a shared phone) follows it. */
export async function registerPushToken(db: Context["db"], row: { token: string; platform: string; userId: string; hospitalId: string; patientId: string }) {
  const { token: _, ...rest } = row;
  await db.insert(pushTokens).values(row).onConflictDoUpdate({ target: pushTokens.token, set: { ...rest, updatedAt: new Date() } });
}

export async function unregisterPushToken(db: Context["db"], token: string, userId: string) {
  await db.delete(pushTokens).where(and(eq(pushTokens.token, token), eq(pushTokens.userId, userId)));
}

export async function notifyPatient(context: PushContext, hospitalId: string, patientId: string, push: Push) {
  try {
    const phones = await context.db.select({ token: pushTokens.token }).from(pushTokens).where(and(eq(pushTokens.hospitalId, hospitalId), eq(pushTokens.patientId, patientId)));
    if (!phones.length) return;
    const response = await (context.fetch ?? fetch)(EXPO_PUSH_URL, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(phones.map(p => ({ to: p.token, sound: "default", ...push }))),
      // The write that caused it waits for the push; a slow push service must not hold it up.
      signal: AbortSignal.timeout(5000),
    });
    // One ticket per message, in order.
    const { data = [] } = (await response.json()) as { data?: { status: string; details?: { error?: string } }[] };
    const gone = phones.filter((_, i) => data[i]?.details?.error === "DeviceNotRegistered").map(p => p.token);
    if (gone.length) await context.db.delete(pushTokens).where(inArray(pushTokens.token, gone));
  } catch (error) {
    console.error("push failed", error);
  }
}

/** What happened, for the patient: the moments Sona Care pushes. */
export type PatientNews =
  | { kind: "check-in"; day: number }
  | { kind: "booked"; at: Date }
  | { kind: "added"; test: string; at: Date }
  | { kind: "reply" };
type Lang = "en" | "ms";

const DAYS = { en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], ms: ["Ahd", "Isn", "Sel", "Rab", "Kha", "Jum", "Sab"] };
const MONTHS = { en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], ms: ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"] };
/** "Thu 1 Oct, 9:00 AM" in Kuala Lumpur, spelled out rather than via Intl (Worker and Bun ICU differ). */
export function when(at: Date, lang: Lang) {
  const t = new Date(at.getTime() + 8 * 3600_000);
  const h = t.getUTCHours(), m = String(t.getUTCMinutes()).padStart(2, "0");
  const half = lang === "ms" ? (h < 12 ? "PG" : "PTG") : h < 12 ? "AM" : "PM";
  return `${DAYS[lang][t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[lang][t.getUTCMonth()]}, ${h % 12 || 12}:${m} ${half}`;
}

const COPY: Record<Lang, { [K in PatientNews["kind"]]: (n: Extract<PatientNews, { kind: K }>) => Omit<Push, "data"> }> = {
  en: {
    "check-in": n => ({ title: "Check-in", body: `How are you feeling today? Your day-${n.day} check-in is ready` }),
    booked: n => ({ title: "Booked in", body: `Your doctor booked you in · ${when(n.at, "en")}` }),
    added: n => ({ title: "Your visit", body: `A ${n.test.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase())} was added to your visit · ${when(n.at, "en")}` }),
    reply: () => ({ title: "Messages", body: "Your care team replied" }),
  },
  ms: {
    "check-in": n => ({ title: "Semakan", body: `Apa khabar hari ini? Semakan hari ke-${n.day} anda sudah sedia` }),
    booked: n => ({ title: "Temu janji", body: `Doktor anda telah membuat temu janji · ${when(n.at, "ms")}` }),
    added: n => ({ title: "Lawatan anda", body: `${n.test} ditambah pada lawatan anda · ${when(n.at, "ms")}` }),
    reply: () => ({ title: "Mesej", body: "Pasukan penjagaan anda telah membalas" }),
  },
};
const URL_OF: Record<PatientNews["kind"], string> = { "check-in": "sona-care:///check-ins", booked: "sona-care:///follow-ups", added: "sona-care:///follow-ups", reply: "sona-care:///messages" };

export function pushFor(news: PatientNews, lang: Lang): Push {
  return { ...(COPY[lang][news.kind] as (n: PatientNews) => Omit<Push, "data">)(news), data: { url: URL_OF[news.kind] } };
}

/** Tells the patient's phones, in their discharge language (Malay if chosen, else English). Never throws. */
export async function tellPatient(context: PushContext, hospitalId: string, patientId: string, news: PatientNews) {
  try {
    const lang = (await lastDischarge(context.db, hospitalId, patientId))?.language === "ms" ? "ms" : "en";
    await notifyPatient(context, hospitalId, patientId, pushFor(news.kind === "added" ? { ...news, test: appointmentWords(news.test).short } : news, lang));
  } catch (error) {
    console.error("push failed", error);
  }
}

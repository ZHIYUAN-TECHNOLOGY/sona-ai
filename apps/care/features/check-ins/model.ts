import type { CheckIn, ReplyLabel } from "@sona-ai/domain/check-ins";
import type { Language } from "@sona-ai/domain/discharge";
import { formatDate, tFor, type Lang } from "@/lib/i18n";
import "./strings";

/**
 * How the patient says they feel. The five faces (the kit's "How are you feeling today?") read as three
 * feelings: the two happiest are better, the two saddest worse, and the face's own words are sent.
 */
export type Feeling = "better" | "same" | "worse";
export type { CheckIn, ReplyLabel };

/**
 * What the home's feature card shows: the check-in waiting for an answer (due or already sent, not
 * answered), else the next one to come, else nothing (both answered).
 */
export function todayOf(checkIns: CheckIn[], now: Date): { ask?: CheckIn; next?: CheckIn } {
  const open = checkIns.filter(c => !c.replies.length);
  const ask = open.find(c => c.sentAt || c.dueAt <= now);
  if (ask) return { ask };
  const next = open.find(c => c.dueAt > now);
  return next ? { next } : {};
}

/** After an answer: the line that follows it, a prompt, and quick replies (`none` sends the answer alone). */
type FollowUp = { line: string; prompt: string; quick: string[]; none?: string };
type Copy = { question: string; answers: [string, Feeling][]; follow: Record<Feeling, FollowUp>; more: string; placeholder: string; send: string;
  /** Review before a worse answer is sent, and the emergency lines (never tinted, always in the patient's language). */
  review: string; sendNow: string; change: string; urgent: string; emergency: string };

// Short and plain; the English line under a Malay or Chinese question helps a family member reading along.
// Quick replies are sent in the patient's language so the care team (and the reader) see their own words.
const COPY: Record<Language, Copy> = {
  en: {
    question: "How are you feeling today?", answers: [["Much better", "better"], ["Better", "better"], ["Same", "same"], ["Worse", "worse"], ["Much worse", "worse"]],
    follow: {
      better: { line: "Glad to hear it", prompt: "Anything else for your care team?", quick: ["Walked today", "Sleeping better"], none: "No, that's all" },
      same: { line: "Thanks for telling us", prompt: "Anything you'd like them to know?", quick: ["Still tired", "Some pain"], none: "No, that's all" },
      worse: { line: "We're sorry. Your care team will call you today.", prompt: "What's worse?", quick: ["Chest pain", "Breathless", "Dizzy", "Something else"] },
    },
    more: "Tell us in your own words", placeholder: "How are you feeling?", send: "Send",
    review: "We will send your care team", sendNow: "Send now", change: "Change", urgent: "Severe chest pain or can't breathe? Call 999 now.", emergency: "For an emergency, call 999.",
  },
  ms: {
    question: "Macam mana hari ini?", answers: [["Jauh lebih baik", "better"], ["Lebih baik", "better"], ["Sama", "same"], ["Lebih teruk", "worse"], ["Jauh lebih teruk", "worse"]],
    follow: {
      better: { line: "Baguslah", prompt: "Ada apa-apa lagi untuk pasukan penjagaan anda?", quick: ["Berjalan hari ini", "Tidur lebih lena"], none: "Tidak, itu sahaja" },
      same: { line: "Terima kasih kerana memberitahu", prompt: "Ada apa-apa yang mereka perlu tahu?", quick: ["Masih letih", "Sakit sedikit"], none: "Tidak, itu sahaja" },
      worse: { line: "Maaf mendengarnya. Pasukan penjagaan anda akan menelefon hari ini.", prompt: "Apa yang lebih teruk?", quick: ["Sakit dada", "Sesak nafas", "Pening", "Lain-lain"] },
    },
    more: "Tulis dengan kata-kata sendiri", placeholder: "Tulis di sini", send: "Hantar",
    review: "Kami akan hantar kepada pasukan penjagaan anda", sendNow: "Hantar sekarang", change: "Tukar", urgent: "Sakit dada teruk atau tidak boleh bernafas? Hubungi 999 sekarang.", emergency: "Untuk kecemasan, hubungi 999.",
  },
  zh: {
    question: "今天感觉怎么样？", answers: [["好多了", "better"], ["好一些", "better"], ["差不多", "same"], ["更差", "worse"], ["明显更差", "worse"]],
    follow: {
      better: { line: "太好了", prompt: "还有什么想告诉医护团队的吗？", quick: ["今天走了路", "睡得更好"], none: "没有了" },
      same: { line: "谢谢告诉我们", prompt: "有什么想让他们知道的吗？", quick: ["还是很累", "有点痛"], none: "没有了" },
      worse: { line: "很抱歉。医护团队今天会给您打电话。", prompt: "哪里更差了？", quick: ["胸痛", "喘不过气", "头晕", "其他"] },
    },
    more: "用自己的话告诉我们", placeholder: "在这里写", send: "发送",
    review: "我们会发送给您的医护团队", sendNow: "立即发送", change: "修改", urgent: "严重胸痛或无法呼吸？请立即拨打 999。", emergency: "紧急情况请拨打 999。",
  },
};

export function answersFor(language: Language) {
  return { ...COPY[language], english: language === "en" ? undefined : "How are you today?" };
}

/**
 * The words sent to the care team: the answer and what they added ("Worse · Dizzy"), so the team
 * sees both and the server's reader weighs both. No addition sends the answer alone.
 */
export const replyText = (answer: string, added?: string) => added?.trim() ? `${answer} · ${added.trim()}` : answer;

/** The card's done state, from how the care team's side read the answer (never from the button alone). */
export function doneLine(label: ReplyLabel, about?: string, lang: Lang = "en"): { title: string; text: string; tone: "muted" | "amber" } {
  const t = tFor(lang);
  return label === "fine"
    ? { title: t("ci.thanks"), text: t("ci.willSee"), tone: "muted" }
    : { title: t("ci.told"), text: about ? t("ci.callAbout", { about: about.toLowerCase() }) : t("ci.call"), tone: "amber" };
}

/** A past check-in's one line of state: how the answer was read and whether the care team has acted. */
export function statusOf(checkIn: CheckIn, now: Date, lang: Lang = "en"): { line: string; tone: "muted" | "blue" | "amber" | "green" } {
  const t = tFor(lang), reply = checkIn.replies.at(-1);
  if (!reply) return checkIn.sentAt || checkIn.dueAt <= now ? { line: t("ci.waiting"), tone: "blue" } : { line: t("ci.coming", { day: shortDate(checkIn.dueAt, lang) }), tone: "muted" };
  if (reply.label === "fine") return { line: t("ci.allFine"), tone: "muted" };
  return reply.task?.completed ? { line: t("ci.followedUp"), tone: "green" } : { line: t("ci.wasTold"), tone: "amber" };
}

/** The history screen's insight line: how many are answered and when the next one comes. */
export function historyLine(checkIns: CheckIn[], now: Date, lang: Lang = "en"): string {
  const t = tFor(lang);
  if (!checkIns.length) return t("ci.noneYet");
  const answered = checkIns.filter(c => c.replies.length).length, next = todayOf(checkIns, now);
  return `${t("ci.answered", { n: answered, of: checkIns.length })}${next.ask ? t("ci.oneWaiting") : next.next ? t("ci.nextOn", { day: shortDate(next.next.dueAt, lang) }) : ""}`;
}

/** "Mon 28 Sep" in the hospital's time zone. */
export const shortDate = (at: Date, lang: Lang = "en") => formatDate(lang, at, "day");

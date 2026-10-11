import type { AnswerCard } from "@sona-ai/domain/answer-parts";
import { formatDate, tFor, type Lang } from "@/lib/i18n";
import { listOf } from "../discharge/lines";
import { time } from "./answers";
import "./strings";

/**
 * The words of the cards under an answer (answer-parts AnswerCard, built by the server from her record), in her
 * language: a flag, status or level is always written as a word, never left to its colour, and each card reads to
 * VoiceOver as one sentence (docs/answer-parts.md, Accessibility). Pure, so bun can test it; ./answer-cards draws them.
 */

/** The cards Sona Care shows: a task drafted for a clinician (createTask) is Sona Pro's. */
export const careCards = (cards: AnswerCard[] = []) => cards.filter(c => !(c.type === "action" && c.do === "createTask"));

/** "8:00 AM and 8:00 PM" from the plan's "HH:MM" times. */
export const timesOf = (times: string[], lang: Lang) => listOf(times.map(at => time(at, lang)), lang);
/** A value with its unit, "3.1 mmol/L". */
export const amountOf = (c: { value: string; unit?: string }) => c.unit ? `${c.value} ${c.unit}` : c.value;
export const flagWord = (flag: "high" | "low" | "normal" | "critical", lang: Lang) => tFor(lang)(`ask.flag.${flag}`);
export const statusWord = (status: Extract<AnswerCard, { type: "appointment" }>["status"], lang: Lang) => tFor(lang)(`ask.status.${status}`);
/** A moment on a card, "Sat 24 Oct 10:00 AM" in Malaysia time. */
export const momentOf = (at: string, lang: Lang) => formatDate(lang, at, "dayTime");

/** The card as one sentence for VoiceOver, e.g. "Potassium 3.1 mmol/L, Low, Usual range 3.5 to 5.1 mmol/L, Lab result". */
export function cardLabel(c: AnswerCard, lang: Lang): string {
  const t = tFor(lang), at = (iso?: string) => iso && momentOf(iso, lang);
  const parts = c.type === "medicine" ? [c.name, c.dose, c.times?.length && t("ask.at", { times: timesOf(c.times, lang) }), c.how, c.note, c.source]
    : c.type === "result" ? [`${c.test} ${amountOf(c)}`, c.flag && flagWord(c.flag, lang), c.range && t("ask.range", { range: c.range }), at(c.at), c.source]
    : c.type === "reading" ? [`${c.label} ${amountOf(c)}`, c.flag && flagWord(c.flag, lang), at(c.at)]
    : c.type === "appointment" ? [c.title, at(c.when), c.where, statusWord(c.status, lang)]
    : c.type === "doctor" ? [t("ask.doctorA11y", { name: c.name, specialty: c.specialty, team: c.careTeam ? t("ask.yourTeamA11y") : "", rating: c.rating, room: c.room })]
    : c.type === "action" ? [c.title, ...c.items ?? [], c.what]
    : [c.title, ...c.items];
  return parts.filter(Boolean).join(t("dis.comma"));
}

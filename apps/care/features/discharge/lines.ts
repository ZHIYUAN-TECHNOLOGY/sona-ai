import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { formatDate, tFor, type Lang } from "@/lib/i18n";
import "./strings";

export type Plan = Awaited<ReturnType<AppRouterClient["care"]["discharge"]>>;
export type Discharged = Extract<Plan, { status: "discharged" }>;

export type Group = keyof Discharged["medicines"];
export type Med = Discharged["medicines"][Group][number];

/** "9 PM", "8:30 AM" ("9 PTG", "晚上9点") from the plan's "HH:MM" (already Malaysia time). */
const hour = (hhmm: string, lang: Lang) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number), h12 = h % 12 || 12;
  if (lang === "zh") return `${h < 6 ? "凌晨" : h < 12 ? "上午" : h < 13 ? "中午" : h < 18 ? "下午" : "晚上"}${h12}点${m ? `${m}分` : ""}`;
  const t = tFor(lang);
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}\u00a0${h < 12 ? t("dis.am") : t("dis.pm")}`;
};
/** "8 AM, 2 PM and 8 PM" in the patient's language. */
export const listOf = (xs: string[], lang: Lang) => {
  const t = tFor(lang);
  return xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(t("common.listSep"))}${t("common.and")}${xs.at(-1)}`;
};
const times = (at: string[], lang: Lang) => listOf(at.map(a => hour(a, lang)), lang);
/** "Once a day, 8 AM" (`sched`) or "once a day at 8 AM" (`when`). */
const often = (at: string[], kind: "sched" | "when", lang: Lang) =>
  tFor(lang)(`dis.${kind}${at.length === 1 ? "1" : at.length === 2 ? "2" : "N"}`, { n: at.length, times: times(at, lang) });
/** "Finished Thu 1 Oct" for a course whose last dose has gone by (the server reads it on the demo clock), else undefined. */
const finishedLine = ({ finished, endsAt }: Pick<Med, "finished" | "endsAt">, lang: Lang) =>
  finished && endsAt ? tFor(lang)("dis.finished", { day: formatDate(lang, endsAt, "day") }) : undefined;

/** A card's plain-language schedule: "Once a day, 8 AM", "Twice a day, 8 AM and 8 PM", "When you need it", or "Finished Thu 1 Oct". */
export function scheduleLine({ at = [], ...med }: Pick<Med, "at" | "finished" | "endsAt">, lang: Lang = "en") {
  return finishedLine(med, lang) ?? (at.length ? often(at, "sched", lang) : tFor(lang)("dis.whenNeeded"));
}

/** What the stay did to a medicine, in the patient's words (the sheet's grey line). */
export const changeOf = (group: Group, lang: Lang = "en") => tFor(lang)(`dis.change.${group}`);

/**
 * The sheet's sentence as runs of plain and bold text: "You have to take **1 tablet**, **once a day at
 * 8 AM**, with or without food." from how to take one dose and its times; without a schedule, the plan line; a finished
 * course, "**Finished Thu 1 Oct**". The dose words (`take`) are the care team's, shown as written.
 */
export function takeSentence({ line, take, at = [], ...med }: Pick<Med, "line" | "take" | "at" | "finished" | "endsAt">, lang: Lang = "en"): { text: string; bold?: boolean }[] {
  const done = finishedLine(med, lang);
  if (done) return [{ text: done, bold: true }];
  if (!at.length) return [{ text: line }];
  const t = tFor(lang);
  const when = { text: often(at, "when", lang), bold: true };
  if (!take) return [{ text: t("dis.takeIt") }, when, { text: t("dis.end") }];
  const [dose = take, ...rest] = take.split(", ");
  return [{ text: t("dis.youTake") }, { text: dose, bold: true }, { text: t("dis.comma") }, when, { text: rest.length ? `${t("dis.comma")}${rest.join(", ")}${t("dis.end")}` : t("dis.end") }];
}

/** The title's line: how long the patient has been home. */
export const homeLine = (days: number | undefined, lang: Lang = "en") => {
  const t = tFor(lang);
  return days === undefined || days <= 0 ? t("dis.homeToday") : days === 1 ? t("dis.homeYesterday") : t("dis.homeDays", { n: days });
};

/** The medicines title's insight line: how many to take at home and what changed, then how long home ("3 to take · 1 new · 1 changed"); a finished course no longer counts. */
export function takeLine(meds: Discharged["medicines"], home: string, lang: Lang = "en") {
  const t = tFor(lang), active = (g: Group) => meds[g].filter(m => !m.finished).length;
  const taking = active("new") + active("changed") + active("continue");
  return [taking ? t("dis.toTake", { n: taking }) : t("dis.nothingToTake"), active("new") && t("dis.new", { n: active("new") }), active("changed") && t("dis.changed", { n: active("changed") }), home].filter(Boolean).join(" · ");
}

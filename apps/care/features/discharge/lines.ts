import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { tFor, type Lang } from "@/lib/i18n";
import "./strings";

export type Plan = Awaited<ReturnType<AppRouterClient["care"]["discharge"]>>;
export type Discharged = Extract<Plan, { status: "discharged" }>;

/** Home's one line for the plan: medicines to take home (stopped ones aside), what is new, the leaflet's language. */
export function dischargeLine(plan: Plan | undefined) {
  if (!plan) return "Your leaflet, medicines and warning signs";
  if (plan.status === "in-hospital") return "Ready for you when you go home";
  const { medicines: m } = plan, taking = m.new.length + m.changed.length + m.continue.length;
  const leaflet = plan.leaflets.find(l => l.language === plan.language)?.name;
  return [`${taking} ${taking === 1 ? "medicine" : "medicines"}`, m.new.length && `${m.new.length} new`, leaflet && `leaflet in ${leaflet}`].filter(Boolean).join(" · ");
}

export type Group = keyof Discharged["medicines"];
export type Med = Discharged["medicines"][Group][number];

/** "9 PM", "8:30 AM" ("9 PTG", "晚上9点") from the plan's "HH:MM" (already Malaysia time). */
const hour = (hhmm: string, lang: Lang) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number), h12 = h % 12 || 12;
  if (lang === "zh") return `${h < 6 ? "凌晨" : h < 12 ? "上午" : h < 13 ? "中午" : h < 18 ? "下午" : "晚上"}${h12}点${m ? `${m}分` : ""}`;
  const t = tFor(lang);
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? t("dis.am") : t("dis.pm")}`;
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
/** A card's plain-language schedule: "Once a day, 8 AM", "Twice a day, 8 AM and 8 PM", "When you need it". */
export function scheduleLine({ at = [] }: Pick<Med, "at">, lang: Lang = "en") {
  return at.length ? often(at, "sched", lang) : tFor(lang)("dis.whenNeeded");
}

/** What the stay did to a medicine, in the patient's words (the sheet's grey line). */
export const changeOf = (group: Group, lang: Lang = "en") => tFor(lang)(`dis.change.${group}`);

/**
 * The sheet's sentence as runs of plain and bold text: "You have to take **1 tablet**, **once a day at
 * 8 AM**, with or without food." from how to take one dose and its times; without a schedule, the plan line.
 * The dose words (`take`) are the care team's, shown as written.
 */
export function takeSentence({ line, take, at = [] }: Pick<Med, "line" | "take" | "at">, lang: Lang = "en"): { text: string; bold?: boolean }[] {
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

/** The medicines title's insight line: how many to take at home and what changed, then how long home ("3 to take · 1 new · 1 changed"). */
export function takeLine(meds: Discharged["medicines"], home: string, lang: Lang = "en") {
  const t = tFor(lang), taking = meds.new.length + meds.changed.length + meds.continue.length;
  return [taking ? t("dis.toTake", { n: taking }) : t("dis.nothingToTake"), meds.new.length && t("dis.new", { n: meds.new.length }), meds.changed.length && t("dis.changed", { n: meds.changed.length }), home].filter(Boolean).join(" · ");
}

/** The hospital's time zone: a visit's day is its Malaysian day, as the server counts it. */
const TZ = "Asia/Kuala_Lumpur";

export type Lang = "en" | "ms" | "zh";
const LOCALE: Record<Lang, string> = { en: "en-MY", ms: "ms-MY", zh: "zh-CN" };

/** The browser's language as one the server speaks; English otherwise. */
export function browserLang(): Lang {
  const l = typeof navigator === "undefined" ? "" : navigator.language.toLowerCase();
  return l.startsWith("ms") ? "ms" : l.startsWith("zh") ? "zh" : "en";
}

const fmt = (lang: Lang, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(LOCALE[lang], { timeZone: TZ, ...o });

/** "2026-10-06": the Malaysian calendar day. */
export const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export const dayWords = (d: Date, lang: Lang) => fmt(lang, { weekday: "short", day: "numeric", month: "short" }).format(d);
export const timeWords = (d: Date, lang: Lang) => fmt(lang, { hour: "numeric", minute: "2-digit" }).format(d);
export const whenWords = (d: Date, lang: Lang) => `${dayWords(d, lang)}, ${timeWords(d, lang)}`;
export const monthWords = (year: number, month: number, lang: Lang) =>
  new Intl.DateTimeFormat(LOCALE[lang], { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(year, month, 1)));
/** Mon..Sun, short, in the patient's language (5 Jan 2026 is a Monday). */
export const weekdayWords = (lang: Lang) =>
  Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(LOCALE[lang], { timeZone: "UTC", weekday: "short" }).format(new Date(Date.UTC(2026, 0, 5 + i))));

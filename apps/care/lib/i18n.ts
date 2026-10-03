import { useSyncExternalStore } from "react";

/**
 * Sona Care's own words in the patient's language: English, Bahasa Melayu or 中文. English until the
 * patient picks another in the app (the leaflet still opens in the plan's language); the choice is kept
 * on the phone. Screens call `useT()` and write `t("home.hello", { name })`; a key missing in
 * Malay or Chinese falls back to English, never to the key itself. Clinical words the care team wrote
 * (medicine names, the leaflet) are shown as written. Pure helpers (words, dates) take a `lang`, so
 * bun can test them and React Compiler re-renders when the language changes.
 */
export type Lang = "en" | "ms" | "zh";
export const LANGS: { id: Lang; label: string }[] = [{ id: "en", label: "English" }, { id: "ms", label: "Bahasa Melayu" }, { id: "zh", label: "中文" }];

type Dict = Record<string, string>;
const dicts: Record<Lang, Dict> = { en: {}, ms: {}, zh: {} };
/** Screens register their words next to them: `addStrings({ en: {...}, ms: {...}, zh: {...} })`. */
export function addStrings(add: Partial<Record<Lang, Dict>>) {
  for (const l of Object.keys(add) as Lang[]) Object.assign(dicts[l], add[l]);
}
/** Every registered key per language (the coverage test reads it). */
export const registered = () => dicts;

// The phone's store, loaded lazily so the pure parts run under bun's tests (no React Native there).
type Store = { getItemAsync: (k: string) => Promise<string | null>; setItemAsync: (k: string, v: string) => Promise<void> };
let store: Store | undefined;
try { store = require("expo-secure-store") as Store; } catch { /* tests: nothing kept */ }

const KEY = "sona-care.language";
let chosen: Lang | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());
store?.getItemAsync(KEY).then(v => { if (v === "en" || v === "ms" || v === "zh") { chosen = v; notify(); } }).catch(() => {});

/** The patient's pick in the app (kept on the phone). */
export function setLang(lang: Lang) { chosen = lang; notify(); store?.setItemAsync(KEY, lang).catch(() => {}); }
export const currentLang = (): Lang => chosen ?? "en";

type Vars = Record<string, string | number>;
/** `{name}` placeholders filled from `vars`. */
export function translate(lang: Lang, key: string, vars?: Vars) {
  const text = dicts[lang][key] ?? dicts.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : text;
}
/** A translator bound to one language (what `useT` returns, and what pure helpers build from their `lang`). */
export const tFor = (lang: Lang) => (key: string, vars?: Vars) => translate(lang, key, vars);
export type T = ReturnType<typeof tFor>;

export function useLang() {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, currentLang);
}
export function useT() {
  return tFor(useLang());
}

/*
 * Dates and times, always in the hospital's time (Asia/Kuala_Lumpur, UTC+8 with no daylight saving),
 * written out here rather than through Intl, since a phone's Intl data may lack Malay or Chinese.
 *   day       Mon 28 Sep · Isn 28 Sep · 9月28日 周一
 *   dayTime   Mon 28 Sep 9:00 PM · Isn 28 Sep, 9:00 PG · 9月28日 周一 上午9:00
 *   header    Mon, 28 Sep · Isn, 28 Sep · 9月28日 周一
 *   dayMonth  28 Sep · 28 Sep · 9月28日
 *   long      Monday 28 September · Isnin 28 September · 9月28日 星期一
 *   time      9:00 PM · 9:00 PTG · 晚上9:00      hm  21:05 (24 h, every language)
 *   weekday   Mon · Isn · 周一                    narrow  M · I · 一
 * A no-break space joins a time to its AM / PM (PG / PTG), so "9:00 PTG" never splits across lines.
 */
const WEEK = {
  en: { short: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], long: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], narrow: ["S", "M", "T", "W", "T", "F", "S"] },
  ms: { short: ["Ahd", "Isn", "Sel", "Rab", "Kha", "Jum", "Sab"], long: ["Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu"], narrow: ["A", "I", "S", "R", "K", "J", "S"] },
  zh: { short: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"], long: ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"], narrow: ["日", "一", "二", "三", "四", "五", "六"] },
} as const;
const MONTH = {
  en: { short: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], long: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] },
  ms: { short: ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"], long: ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"] },
} as const;
const MYT = 8 * 3600_000;
export type DateStyle = "day" | "dayTime" | "header" | "dayMonth" | "long" | "time" | "hm" | "weekday" | "narrow";

export function formatDate(lang: Lang, at: Date | string | number, style: DateStyle): string {
  const d = new Date(new Date(at).getTime() + MYT);
  const wd = d.getUTCDay(), day = d.getUTCDate(), mo = d.getUTCMonth(), h = d.getUTCHours(), mm = String(d.getUTCMinutes()).padStart(2, "0");
  const h12 = h % 12 || 12;
  const time = lang === "zh" ? `${h < 6 ? "凌晨" : h < 12 ? "上午" : h < 13 ? "中午" : h < 18 ? "下午" : "晚上"}${h12}:${mm}` : `${h12}:${mm}\u00a0${lang === "ms" ? (h < 12 ? "PG" : "PTG") : h < 12 ? "AM" : "PM"}`;
  const w = WEEK[lang];
  const md = lang === "zh" ? `${mo + 1}月${day}日` : `${day} ${MONTH[lang].short[mo]}`;
  switch (style) {
    case "time": return time;
    case "hm": return `${String(h).padStart(2, "0")}:${mm}`;
    case "weekday": return w.short[wd]!;
    case "narrow": return w.narrow[wd]!;
    case "dayMonth": return md;
    case "day": return lang === "zh" ? `${md} ${w.short[wd]}` : `${w.short[wd]} ${md}`;
    case "header": return lang === "zh" ? `${md} ${w.short[wd]}` : `${w.short[wd]}, ${md}`;
    case "dayTime": return lang === "zh" ? `${md} ${w.short[wd]} ${time}` : lang === "ms" ? `${w.short[wd]} ${md}, ${time}` : `${w.short[wd]} ${md} ${time}`;
    case "long": return lang === "zh" ? `${md} ${w.long[wd]}` : `${w.long[wd]} ${day} ${MONTH[lang].long[mo]}`;
  }
}

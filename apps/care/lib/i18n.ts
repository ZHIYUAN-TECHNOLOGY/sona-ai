import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

/**
 * Sona Care's own words in the patient's language: English, Bahasa Melayu or 中文. The language is the
 * one chosen at discharge (the leaflet's), until the patient picks another in the app; the choice is
 * kept on the phone. Screens call `useT()` and write `t("home.greeting", { name })`; a key missing in
 * Malay or Chinese falls back to English, never to the key itself. Clinical words the care team wrote
 * (medicine names, the leaflet) are shown as written.
 */
export type Lang = "en" | "ms" | "zh";
export const LANGS: { id: Lang; label: string }[] = [{ id: "en", label: "English" }, { id: "ms", label: "Bahasa Melayu" }, { id: "zh", label: "中文" }];

type Dict = Record<string, string>;
const dicts: Record<Lang, Dict> = { en: {}, ms: {}, zh: {} };
/** Screens register their words next to them: `addStrings({ en: {...}, ms: {...}, zh: {...} })`. */
export function addStrings(add: Partial<Record<Lang, Dict>>) {
  for (const l of Object.keys(add) as Lang[]) Object.assign(dicts[l], add[l]);
}

const KEY = "sona-care.language";
let chosen: Lang | undefined, fromPlan: Lang | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());
SecureStore.getItemAsync(KEY).then(v => { if (v === "en" || v === "ms" || v === "zh") { chosen = v; notify(); } }).catch(() => {});

/** The patient's pick in the app (kept on the phone). */
export function setLang(lang: Lang) { chosen = lang; notify(); SecureStore.setItemAsync(KEY, lang).catch(() => {}); }
/** The discharge plan's language, used until the patient picks one. */
export function setPlanLang(lang: string | undefined) {
  const l = lang === "ms" || lang === "zh" || lang === "en" ? lang : undefined;
  if (l !== fromPlan) { fromPlan = l; notify(); }
}
export const currentLang = (): Lang => chosen ?? fromPlan ?? "en";

/** `{name}` placeholders filled from `vars`. */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>) {
  const text = dicts[lang][key] ?? dicts.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : text;
}

export function useLang() {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, currentLang);
}
export function useT() {
  const lang = useLang();
  return (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars);
}

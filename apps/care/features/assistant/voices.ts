import type { Voice } from "expo-speech";
import { tFor, type Lang, type T } from "@/lib/i18n";
import "./strings";

/**
 * The voices Sona can read answers in (after Gemini's voice picker): up to four English voices from the
 * phone, the clearest first and one per accent before any repeats, each with a friendly name and one
 * honest line (its accent, whether it is the phone's enhanced quality), then the phone's Malay and
 * Chinese voices when it has them. With fewer than three, the phone's own voice fills in at a slower
 * pace and a lower pitch, so there is always a choice. An answer in Malay or Chinese is read in that
 * language's voice whichever voice is picked (see voiceFor), so it never comes out in an English accent.
 */
export type SonaVoice = { id: string; name: string; line: string; voice?: string; language: string; rate: number; pitch: number };

const NAMES = ["Mira", "Arin", "Suri", "Kai"];
const ACCENTS = ["en-GB", "en-US", "en-AU", "en-IE", "en-IN", "en-ZA", "en-SG", "en-NZ"];
// Malaysia learns British English first; the rest in the order people here hear them most.
const ORDER = ["en-GB", "en-US", "en-AU", "en-SG", "en-IN", "en-IE", "en-NZ", "en-ZA"];
const locale = (l: string) => l.replace("_", "-");
const rank = (l: string) => { const i = ORDER.indexOf(locale(l)); return i < 0 ? ORDER.length : i; };
/** iOS novelty voices (Bells, Bubbles, Zarvox…) and the old Eloquence set: not for reading a care plan. */
const NOVELTY = /speech\.synthesis\.voice|eloquence/i;

const LANGS = [
  { code: "ms", test: /^ms([-_]|$)/i, name: "Nadia", line: "Bahasa Melayu" },
  { code: "zh", test: /^zh[-_](CN|Hans)/i, name: "Mei", line: "中文 · Mandarin" },
] as const;

/** The phone's best voice for one of Sona Care's other languages, or undefined if it has none. */
function languageVoice(voices: Voice[], lang: (typeof LANGS)[number], t: T): SonaVoice | undefined {
  const v = voices.filter(x => lang.test.test(x.language) && !NOVELTY.test(x.identifier))
    .sort((a, b) => Number(b.quality === "Enhanced") - Number(a.quality === "Enhanced"))[0];
  return v && { id: v.identifier, name: lang.name, voice: v.identifier, language: locale(v.language), rate: 1, pitch: 1, line: `${lang.line}${v.quality === "Enhanced" ? t("voice.clearest") : ""}` };
}

/** The language an answer is written in: Chinese by its characters, Malay by its common words, else English. */
export function languageOf(text: string): "zh" | "ms" | "en" {
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const malay = words.filter(w => /^(anda|dan|yang|untuk|ubat|hari|jika|sila|dengan|tidak|boleh|makan|selepas|sebelum|awak|saya|ini|itu|pada|akan|kali|sekali|lagi|datang|segera)$/.test(w)).length;
  return words.length && malay / words.length >= 0.15 ? "ms" : "en";
}

/** The voice to read `text` in: the picked one for English, else the phone's voice for that language (if any). */
export function voiceFor(text: string, picked: SonaVoice, all: SonaVoice[]): SonaVoice {
  const lang = languageOf(text);
  if (lang === "en" || picked.language.toLowerCase().startsWith(lang)) return picked;
  return all.find(v => v.language.toLowerCase().startsWith(lang)) ?? picked;
}

export function pickVoices(voices: Voice[], lang: Lang = "en"): SonaVoice[] {
  const t = tFor(lang);
  const en = voices.filter(v => /^en([-_]|$)/i.test(v.language) && !NOVELTY.test(v.identifier))
    .sort((a, b) => Number(b.quality === "Enhanced") - Number(a.quality === "Enhanced") || rank(a.language) - rank(b.language));
  // One per accent first (in the order above), then the next best of any accent.
  const firstOf = new Map<string, Voice>();
  for (const v of en) if (!firstOf.has(locale(v.language))) firstOf.set(locale(v.language), v);
  const spread = [...firstOf.values()].sort((a, b) => rank(a.language) - rank(b.language));
  const picked = [...spread, ...en.filter(v => !spread.includes(v))].slice(0, 4);
  const out: SonaVoice[] = picked.map((v, i) => ({
    id: v.identifier, name: NAMES[i]!, voice: v.identifier, language: locale(v.language), rate: 1, pitch: 1,
    line: `${ACCENTS.includes(locale(v.language)) ? t(`voice.${locale(v.language)}`) : t("voice.english")}${v.quality === "Enhanced" ? t("voice.clearest") : ""}`,
  }));
  const fill: SonaVoice[] = [
    { id: "phone", name: t("voice.phone"), line: t("voice.phoneLine"), language: "en-GB", rate: 1, pitch: 1 },
    { id: "phone-slow", name: t("voice.slow"), line: t("voice.slowLine"), language: "en-GB", rate: 0.8, pitch: 1 },
    { id: "phone-low", name: t("voice.low"), line: t("voice.lowLine"), language: "en-GB", rate: 0.95, pitch: 0.8 },
  ];
  const english = out.length >= 3 ? out : [...out, ...fill].slice(0, Math.max(3, out.length));
  return [...english, ...LANGS.flatMap(l => languageVoice(voices, l, t) ?? [])];
}

/** The line each voice says when the patient swipes to it. */
export const preview = (v: SonaVoice) => v.language.startsWith("ms") ? `Hai, saya ${v.name}. Saya akan bacakan jawapan anda.`
  : v.language.startsWith("zh") ? `你好，我是${v.name}。我会为你朗读答案。` : `Hi, I'm ${v.name}. I'll read your answers aloud.`;

import type { Voice } from "expo-speech";

/**
 * The voices Sona can read answers in (after Gemini's voice picker): up to four English voices from the
 * phone, the clearest first and one per accent before any repeats, each with a friendly name and one
 * honest line (its accent, whether it is the phone's enhanced quality). With fewer than three, the
 * phone's own voice fills in at a slower pace and a lower pitch, so there is always a choice.
 */
export type SonaVoice = { id: string; name: string; line: string; voice?: string; language: string; rate: number; pitch: number };

const NAMES = ["Mira", "Arin", "Suri", "Kai"];
const ACCENT: Record<string, string> = {
  "en-GB": "British English", "en-US": "American English", "en-AU": "Australian English", "en-IE": "Irish English",
  "en-IN": "Indian English", "en-ZA": "South African English", "en-SG": "Singapore English", "en-NZ": "New Zealand English",
};
// Malaysia learns British English first; the rest in the order people here hear them most.
const ORDER = ["en-GB", "en-US", "en-AU", "en-SG", "en-IN", "en-IE", "en-NZ", "en-ZA"];
const locale = (l: string) => l.replace("_", "-");
const rank = (l: string) => { const i = ORDER.indexOf(locale(l)); return i < 0 ? ORDER.length : i; };
/** iOS novelty voices (Bells, Bubbles, Zarvox…) and the old Eloquence set: not for reading a care plan. */
const NOVELTY = /speech\.synthesis\.voice|eloquence/i;

export function pickVoices(voices: Voice[]): SonaVoice[] {
  const en = voices.filter(v => /^en([-_]|$)/i.test(v.language) && !NOVELTY.test(v.identifier))
    .sort((a, b) => Number(b.quality === "Enhanced") - Number(a.quality === "Enhanced") || rank(a.language) - rank(b.language));
  // One per accent first (in the order above), then the next best of any accent.
  const firstOf = new Map<string, Voice>();
  for (const v of en) if (!firstOf.has(locale(v.language))) firstOf.set(locale(v.language), v);
  const spread = [...firstOf.values()].sort((a, b) => rank(a.language) - rank(b.language));
  const picked = [...spread, ...en.filter(v => !spread.includes(v))].slice(0, 4);
  const out: SonaVoice[] = picked.map((v, i) => ({
    id: v.identifier, name: NAMES[i]!, voice: v.identifier, language: locale(v.language), rate: 1, pitch: 1,
    line: `${ACCENT[locale(v.language)] ?? "English"}${v.quality === "Enhanced" ? " · clearest quality" : ""}`,
  }));
  const fill: SonaVoice[] = [
    { id: "phone", name: "Your phone", line: "Your phone's own voice", language: "en-GB", rate: 1, pitch: 1 },
    { id: "phone-slow", name: "Slow", line: "Your phone's voice, a little slower", language: "en-GB", rate: 0.8, pitch: 1 },
    { id: "phone-low", name: "Low", line: "Your phone's voice, a little lower", language: "en-GB", rate: 0.95, pitch: 0.8 },
  ];
  return out.length >= 3 ? out : [...out, ...fill].slice(0, Math.max(3, out.length));
}

/** The line each voice says when the patient swipes to it. */
export const preview = (v: SonaVoice) => `Hi, I'm ${v.name}. I'll read your answers aloud.`;

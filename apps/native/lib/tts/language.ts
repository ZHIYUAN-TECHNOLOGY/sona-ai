// Per-language routing for text-to-speech. A Malaysian note is code-switched (BM + English +
// 中文), but the OS synthesizer speaks ONE voice per utterance — so a single voice mangles the
// other languages (Chinese read as gibberish, Malay with an English accent). This splits the
// text into sentence-ish segments, tags each with a spoken language, and merges consecutive
// same-language runs, so readAloud can queue each segment on the matching system voice. Pure +
// unit-tested; no model — the moat stays intact (system voices are on-device).

export type SpokenLang = "zh" | "ms" | "en";

const BCP47: Record<SpokenLang, string> = { zh: "zh-CN", ms: "ms-MY", en: "en-US" };

/** BCP-47 tag for the OS voice of a spoken language. */
export function langToBcp47(l: SpokenLang): string {
  return BCP47[l];
}

// Any CJK character → speak the whole segment with the Chinese voice.
const CJK = /[㐀-鿿豈-﫿]/;

// Common Malay function + clinical words. If a good fraction of a segment's words are Malay
// markers, route it to the Malay voice; otherwise English. Heuristic (no model), tuned for
// Malaysian clinic speech.
const MALAY = new Set([
  "dan", "yang", "saya", "awak", "tak", "tidak", "dah", "sudah", "belum", "sakit", "ubat", "makan",
  "minum", "demam", "batuk", "selsema", "apa", "khabar", "encik", "puan", "cik", "hari", "dengan",
  "untuk", "ini", "itu", "ada", "kena", "boleh", "nak", "juga", "lagi", "sikit", "kot", "ke", "di",
  "pada", "tolong", "doktor", "perut", "kepala", "badan", "kali", "sehari", "selepas", "sebelum",
  "rasa", "macam", "mana", "bila", "sebab", "kalau", "jangan", "sila", "terima", "kasih", "banyak",
]);

function detectSegmentLang(s: string): SpokenLang {
  if (CJK.test(s)) return "zh";
  const words = s.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length === 0) return "en";
  let malay = 0;
  for (const w of words) if (MALAY.has(w)) malay++;
  return malay / words.length >= 0.25 ? "ms" : "en";
}

export interface SpokenSegment {
  text: string;
  lang: SpokenLang;
}

/** Split text into language-tagged segments, merging consecutive same-language runs. */
export function segmentByLanguage(text: string): SpokenSegment[] {
  // Split on sentence terminators (incl. Chinese 。！？) but KEEP them attached to the sentence.
  const chunks = text.split(/([.!?。！？;\n]+)/);
  const sentences: string[] = [];
  for (let i = 0; i < chunks.length; i += 2) {
    const s = `${chunks[i] ?? ""}${chunks[i + 1] ?? ""}`.trim();
    if (s) sentences.push(s);
  }
  const segs: SpokenSegment[] = [];
  for (const sentence of sentences) {
    const lang = detectSegmentLang(sentence);
    const last = segs[segs.length - 1];
    if (last && last.lang === lang) last.text += ` ${sentence}`;
    else segs.push({ text: sentence, lang });
  }
  return segs;
}

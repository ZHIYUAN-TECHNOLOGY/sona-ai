// Conservative, on-device transcript cleanup (the "auto-remedy").
//
// On-device Whisper is fast + private but imperfect on code-switched BM+EN and proper nouns
// (a Malay name comes back garbled). This pass asks the same on-device LLM (Qwen) that drafts
// the SOAP note to FIX obvious speech-to-text errors — punctuation, casing, clearly garbled
// words — WITHOUT inventing clinical facts or guessing names. It is deliberately timid:
//
//   - Never adds/removes clinical content. Never guesses proper nouns → "[unclear]".
//   - The RAW Whisper text is preserved (ClusterSegment.rawText) so the Review screen can show
//     it, and the clinician always edits + approves before it becomes the note. The cleaned
//     text is a SUGGESTION, not the authoritative record.
//   - Guardrails reject a model reply that isn't a same-length JSON array, or a line that grew
//     implausibly (a small model "helpfully" rewriting) — those lines fall back to raw.
//
// MOAT: Qwen runs on-device and may see raw PII here; only de-identified text ever crosses the
// boundary later. The cleanup output is still on-device text.
//
// applyCleanup (the parsing + guardrails) is pure and unit-tested; cleanupClusters wires it to
// the native LLM.

import type { ClusterSegment } from "./sttAlign";
import { stripThink } from "./noteGen";
import type { LlmLike, Msg } from "./noteGen";

const SYSTEM_PROMPT = [
  "You are a proofreader for a MALAYSIAN clinic consultation transcript produced by on-device",
  "speech-to-text. The speakers code-switch between Malay, English, and Mandarin (中文), but the",
  "recognizer forces everything through ONE language, so words from the other languages come out",
  "as phonetic gibberish. Each input line is an object:",
  '  {"heard": <primary transcription>, "zh": <the SAME audio decoded as Mandarin>, "ms": <the SAME audio decoded as Malay>}',
  "The zh/ms fields are REAL acoustic alternatives of the same speech — use them to reconstruct",
  "what was actually said: for each phrase pick the rendition that reads as genuine language",
  "(e.g. heard \"Oh long hentong\" + zh \"喉咙很痛\" → use 喉咙很痛; heard \"beratuk\" + ms",
  '"batuk" → use batuk). English that already reads correctly stays as-is. Also restore',
  'phonetically-obvious garble, e.g. "wanhwik" → "one week", "apacaba" → "apa khabar".',
  "- Common clinic words: batuk, demam, sakit, ubat, makan, selsema, 喉咙痛, 发烧, 头晕, 不舒服.",
  "STRICT RULES:",
  "- Do NOT add, remove, or infer any clinical information (symptoms, doses, numbers, findings).",
  "- Do NOT guess or invent names, places, or medications. If a proper noun is garbled and you are",
  "  not certain, replace just that word with [unclear]. Never fabricate a name.",
  "- The zh/ms decodes are OFTEN garbage for parts that were not that language — only take the",
  "  fragments that are clearly the real utterance; never splice in unrelated content from them.",
  "- Preserve meaning and word order. Keep each line roughly the same length; never add sentences.",
  "Return ONLY a JSON array of strings — ONE final cleaned string per input line, same order,",
  "same count. No commentary, no keys, no code fences.",
].join(" ");

/** Pull the first top-level JSON string-array out of a model reply (tolerant of surrounding text). */
export function parseCleanArray(modelOutput: string): string[] | null {
  const text = stripThink(modelOutput).trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return null;
    return parsed.map((v) => (typeof v === "string" ? v : String(v)));
  } catch {
    return null;
  }
}

/**
 * Merge a model reply into the candidates, conservatively. Returns candidates with `text` set to
 * the cleaned line (or the raw line when a guardrail trips) and `rawText` always the original.
 * Pure — no native/LLM dependency, so the guardrail logic is unit-tested directly.
 */
export function applyCleanup(cands: ClusterSegment[], modelOutput: string): ClusterSegment[] {
  const cleaned = parseCleanArray(modelOutput);
  // Any structural problem (bad JSON, wrong count) → keep every raw line. All-or-nothing on shape,
  // per-line on plausibility.
  const usable = cleaned && cleaned.length === cands.length ? cleaned : null;
  return cands.map((c, i) => {
    const raw = c.rawText ?? c.text;
    if (!usable) return { ...c, text: raw, rawText: raw };
    const next = (usable[i] ?? "").trim();
    // Reject empty output or an implausible expansion (small model inventing) → fall back to raw.
    const tooLong = next.length > raw.length * 2.5 + 20;
    const use = !next || tooLong ? raw : next;
    return { ...c, text: use, rawText: raw };
  });
}

/**
 * Clean a consult's transcript lines with the on-device LLM. Best-effort: any failure returns the
 * raw candidates unchanged (cleanup is polish, never a blocker). One batched call for all lines.
 */
export async function cleanupClusters(
  cands: ClusterSegment[],
  llm: LlmLike,
): Promise<ClusterSegment[]> {
  const withRaw = cands.map((c) => ({ ...c, rawText: c.rawText ?? c.text }));
  if (withRaw.length === 0) return withRaw;
  const messages: Msg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify(
        withRaw.map((c) => ({ heard: c.rawText, zh: c.altZh ?? "", ms: c.altMs ?? "" })),
      ),
    },
  ];
  try {
    const out = await llm.generate(messages);
    return applyCleanup(withRaw, out);
  } catch {
    return withRaw; // LLM unavailable / errored → keep raw, no crash
  }
}

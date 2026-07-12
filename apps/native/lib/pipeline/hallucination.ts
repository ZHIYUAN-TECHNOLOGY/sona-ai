import type { SttSegment } from "./sttAlign";

// Whisper hallucination filter. On hard / non-English / low-confidence audio, Whisper emits
// junk instead of transcribing: bracketed non-speech annotations ("(speaking in foreign
// language)", "[Music]"), repetition loops (the same line 8×), and training-data artifacts
// ("Thank you for watching", "Subtitles by …"). This strips that garbage from the segments
// before diarization + display. Conservative: it only drops clear non-speech / duplicates —
// real speech is kept (the clinician edits the rest on Review). Pure + unit-tested.
//
// This is a safety net that helps ANY STT engine; the primary fix for the hallucinations
// themselves is the engine swap to whisper.cpp (auto-detect + no_speech_threshold).

/** Bracketed lines that are ENTIRELY a non-speech annotation → drop. */
const NONSPEECH =
  /^[([][^)\]]*\b(foreign language|inaudible|music|applause|laughter|laughs?|silence|blank[_ ]?audio|no speech|coughing|coughs?|clears throat|sighs?|background noise|beep|static|noise)\b[^)\]]*[)\]][.!?]?$/i;

/** Known Whisper training-data artifacts (YouTube captions) → drop when they're ~the whole line. */
const ARTIFACTS: RegExp[] = [
  /^thanks? (?:for watching|you for watching)[.!]?$/i,
  /^please (?:like|subscribe|like and subscribe)/i,
  /^(?:like and )?subscribe/i,
  /subtitles?(?: by| provided by)/i,
  /amara\.org/i,
  /^you[.!]?$/i, // Whisper's canonical silence hallucination
  /transcription by/i,
];

/** Normalize for duplicate detection: lowercase, strip punctuation/extra space. */
function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isJunk(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (NONSPEECH.test(t)) return true;
  if (ARTIFACTS.some((re) => re.test(t))) return true;
  return false;
}

/**
 * Drop hallucinated segments and collapse repetition loops: a run of consecutive segments with
 * the same normalized text keeps only the FIRST (Whisper's "I'm from the U.S." ×8 → one line).
 * Non-consecutive duplicates are left alone. Returns a new array; input is untouched.
 */
export function filterHallucinations(segments: SttSegment[]): SttSegment[] {
  const out: SttSegment[] = [];
  let lastNorm = "";
  for (const s of segments) {
    const text = s.text.trim();
    if (isJunk(text)) continue;
    const n = norm(text);
    if (n && n === lastNorm) continue; // consecutive duplicate → collapse
    lastNorm = n;
    out.push({ ...s, text });
  }
  return out;
}

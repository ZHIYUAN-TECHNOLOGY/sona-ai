// Hybrid clinical highlighter. Two halves, each doing what it is good at:
//
//   • Numbers  — doses, vitals, timeframes — are matched DETERMINISTICALLY by regex.
//     A small on-device LLM cannot be trusted with digits (it hallucinates them), so
//     these are never left to the model.
//   • Red-flag symptoms — where CONTEXT matters ("no chest pain" is not a red flag) —
//     are supplied by the MODEL, which drafted the note and understands negation. The
//     deterministic lexicon below is only a FALLBACK for old notes or when the model
//     emitted no Flags line.
//
// Three categories map to three markdown emphasis channels (distinct colours in
// NoteMarkdown):
//   **strong**  → doses & vitals      → green  (clinical values / "how much")
//   *em*        → timeframes          → blue   ("when")
//   `code`      → red-flag symptoms   → red    ("danger")
//
// Presentation-only: applied at render time, never persisted or exported. Headings
// and lines the model already emphasised are left untouched.

// Doses & vitals. Units end with a (?![a-zA-Z]) guard so a unit letter never eats
// the start of the next word — e.g. "1 gram" must NOT match as "1 g". Longest unit
// alternatives come first (grams before g).
const DOSE_VITAL =
  /(?:\b(?:T|Temp(?:erature)?|P|Pulse|HR|O2|SpO2|BP|RR)\s?[:=]?\s?\d+(?:\.\d+)?(?:\/\d+)?(?:\s?(?:°C|bpm|%|mmHg|\/min))?|\b\d+(?:\.\d+)?\s?(?:°C|bpm|mmHg|%|micrograms?|mcg|milligrams?|mg|grams?|g|ml|tsp|tablets?|units?)(?![a-zA-Z])|\b(?:PO|IV|IM)\s+(?:od|bd|tid|tds|qid|qds|nocte|prn))/gi;

// Timeframes / durations. Plurals via `s?`, ordered so "3 days" highlights fully.
const DURATION = /\b\d+\s?(?:days?|weeks?|hours?|months?|years?|mins?|minutes?)\b/gi;

// Fallback lexicon — used only when the model supplied no red-flag list. The model
// path is preferred because it is context-aware; this is a safety net so a red flag
// is never missed entirely on a note the model under-tagged.
const RED_FLAGS = [
  "shortness of breath",
  "chest pain",
  "breathlessness",
  "breathless",
  "haemoptysis",
  "hemoptysis",
];

// Negation cues that flip a symptom to absent. Applied to BOTH the model list and the
// fallback lexicon — even if the model wrongly lists a denied symptom, we won't paint
// it red when the local text negates it.
const NEGATION = /\b(?:no|not|nil|without|denies|denied|negative for|absence of|resolved|ruled out)\b/i;

// True when `phrase` at `idx` in `line` sits in a negated clause — i.e. a negation
// cue appears between the previous clause boundary (,.;:) and the phrase.
function isNegated(line: string, idx: number): boolean {
  const clauseStart = Math.max(
    line.lastIndexOf(".", idx - 1),
    line.lastIndexOf(",", idx - 1),
    line.lastIndexOf(";", idx - 1),
    line.lastIndexOf(":", idx - 1),
  );
  return NEGATION.test(line.slice(clauseStart + 1, idx));
}

// Escape a model-supplied phrase for safe use inside a RegExp.
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalise model output before the deterministic highlighter runs:
 *  1. collapse a doubled leading bullet ("- • item" / "- - item" → "- item") so the
 *     renderer's own marker isn't doubled.
 *  2. strip the model's own emphasis marks (**bold**, __bold__). Emphasis is owned
 *     entirely by highlightClinical (deterministic, colour-coded); leaving the model's
 *     marks in causes two failures — an UNBALANCED "**" renders as literal asterisks,
 *     and any "**" makes highlightClinical skip that whole line. Removing them here
 *     fixes both and keeps highlighting consistent across every line.
 */
export function normalizeNoteMarkdown(markdown: string): string {
  return markdown
    .replace(/^(\s*[-*])\s+[•·*+-]\s+/gm, "$1 ")
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1") // balanced bold → plain
    .replace(/__([\s\S]*?)__/g, "$1") // balanced bold (underscore) → plain
    .replace(/\*\*/g, "") // any leftover UNBALANCED "**"
    .replace(/__/g, "");
}

/**
 * True when a drafted note has essentially no content (e.g. a consult too short
 * for the model to draft anything) — headings only, or blank. Template-agnostic:
 * strips heading lines + markdown marks and checks what's left.
 */
export function noteIsEmpty(markdown: string): boolean {
  const body = markdown
    .replace(/^\s*#.*$/gm, "") // drop heading lines
    .replace(/[#*_>`\-•\s]/g, ""); // drop marks + whitespace
  return body.length < 12;
}

// Wrap every non-negated occurrence of `phrase` in `line` with `` ` `` (red channel).
// Skips occurrences already inside a wrapper and any that a negation cue precedes.
function wrapRedFlag(line: string, phrase: string): string {
  const re = new RegExp(`\\b${escapeRe(phrase)}\\b`, "gi");
  return line.replace(re, (m, offset: number) => {
    if (line[offset - 1] === "`" || isNegated(line, offset)) return m;
    return `\`${m}\``;
  });
}

/**
 * Highlight a note's clinical terms for on-screen rendering.
 *
 * @param markdown  the re-identified note markdown
 * @param redFlags  present danger symptoms from the model (hybrid path). When
 *                  omitted/empty the deterministic fallback lexicon is used instead.
 */
export function highlightClinical(markdown: string, redFlags?: string[]): string {
  // Prefer the model's context-aware list; fall back to the lexicon only when absent.
  const flags = redFlags && redFlags.length > 0 ? redFlags : RED_FLAGS;
  return markdown
    .split("\n")
    .map((line) => {
      // Leave headings and lines the model already emphasised alone.
      if (/^\s*#/.test(line) || line.includes("**")) return line;
      let l = line;
      // Order matters — wrap words (red flags) first, then timeframes, then doses.
      // Each wrap is balanced and the categories don't textually overlap, so a
      // later regex can't match inside an earlier wrapper.
      for (const rf of flags) {
        l = wrapRedFlag(l, rf);
      }
      l = l.replace(DURATION, (m) => `*${m}*`);
      l = l.replace(DOSE_VITAL, (m) => `**${m}**`);
      return l;
    })
    .join("\n")
    .replace(/\*\*\*\*/g, ""); // collapse any accidental empty-bold from adjacent matches
}

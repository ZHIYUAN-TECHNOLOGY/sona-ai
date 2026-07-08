// Deterministic clinical highlighter. The on-device model emits **bold** only
// unreliably, so we post-process the (re-identified) note markdown to emphasise the
// terms a clinician scans for — vitals, doses, durations, and red-flag symptoms —
// by wrapping them in **bold**. Presentation-only: applied at render time, never
// persisted or exported. Headings and already-bolded lines are left untouched.

// One combined pass for measurements so matches never overlap or nest. Plurals
// use `s?` (and are ordered longest-first) so "3 days" highlights fully, not "3 day".
const MEASUREMENT =
  /(\b(?:T|Temp(?:erature)?|P|Pulse|HR|O2|SpO2|BP|RR)\s?[:=]?\s?\d+(?:\.\d+)?(?:\/\d+)?(?:\s?(?:°C|bpm|%|mmHg|\/min))?|\b\d+(?:\.\d+)?\s?(?:°C|bpm|mmHg|%|mg|mcg|g|ml|tsp)|\b(?:PO|IV|IM)\s+(?:od|bd|tid|tds|qid|qds|nocte|prn)|\b\d+\s?(?:days?|weeks?|hours?|months?|mins?|minutes?))/gi;

/**
 * Normalise model list quirks before rendering: collapse a doubled leading bullet
 * ("- • item" / "- - item" → "- item") so the renderer's own marker isn't doubled.
 */
export function normalizeNoteMarkdown(markdown: string): string {
  return markdown.replace(/^(\s*[-*])\s+[•·*+-]\s+/gm, "$1 ");
}

const RED_FLAGS = [
  "shortness of breath",
  "chest pain",
  "breathless",
  "breathlessness",
  "haemoptysis",
  "hemoptysis",
];

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

export function highlightClinical(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      // Leave headings and lines the model already emphasised alone.
      if (/^\s*#/.test(line) || line.includes("**")) return line;
      let l = line.replace(MEASUREMENT, (m) => `**${m}**`);
      for (const rf of RED_FLAGS) {
        l = l.replace(new RegExp(`\\b${rf}\\b`, "gi"), (m) => `**${m}**`);
      }
      return l;
    })
    .join("\n")
    .replace(/\*\*\*\*/g, ""); // collapse any accidental empty-bold from adjacent matches
}

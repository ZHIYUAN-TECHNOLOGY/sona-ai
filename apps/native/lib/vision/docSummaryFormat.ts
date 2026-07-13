// Deterministic post-processor for the on-device document summary. The small note
// model CANNOT be trusted to follow the output format (observed: '# Doc Type' instead
// of '## Document type', 40-word run-on bullets, invented trailing prose). Same
// discipline as the consult note (parseSoap → re-render): parse whatever the model
// emitted into the four canonical sections, cap everything, DROP anything outside a
// recognized section — off-format rambling dies here structurally, not by prompt hope.
// Pure module — unit-tested in docSummaryFormat.test.ts.

export interface DocSummaryDisplay {
  /** Short PII-free title (never includes the 'Title:' prefix). */
  title: string;
  /** Normalized '## ' Markdown — always exactly the four canonical sections. */
  markdown: string;
}

const SECTIONS: { heading: string; match: RegExp }[] = [
  { heading: "Document type", match: /^doc(?:ument)?\s*type/i },
  { heading: "Key findings", match: /^(?:key|main)?\s*finding/i },
  { heading: "Medications & doses", match: /^(?:medication|medicine|med|drug|prescription)/i },
  { heading: "Follow-up needed", match: /^(?:follow|next step)/i },
];

const MAX_BULLETS = 3;
const MAX_BULLET_CHARS = 160;
const MAX_TITLE_CHARS = 60;
/** An unmarked prose line longer than this inside a section = rambling, dropped. */
const MAX_PLAIN_LINE_WORDS = 25;

// Lines the model emits ABOUT its own output rather than about the document — echoes
// of the prompt contract. Observed in the field: "Total :49words" rendered as a
// Follow-up bullet. Never content, always dropped.
const META_LINE = /^\(?\s*(?:total|word count|under)\b[^A-Za-z]*\d*\s*(?:words?)?\.?\)?$|^\(?\d+\s*words?\.?\)?$/i;

// The model's own "- Not stated." (and mangled variants like "Notstated") must not
// pass through as content — empty sections get the canonical placeholder at render.
const NOT_STATED = /^not\s*stated\.?$/i;

/** A line that opens a section: '## Key findings', '# Doc Type', 'Medications:', … */
function sectionIndex(line: string): number {
  const bare = line
    .replace(/^#{1,4}\s*/, "")
    .replace(/[*`]/g, "")
    .replace(/:\s*$/, "")
    .trim();
  if (!bare || (!/^#{1,4}\s/.test(line) && !/:\s*$/.test(line.trim()) && bare.split(/\s+/).length > 4)) {
    return -1; // long prose line, not a heading
  }
  return SECTIONS.findIndex((s) => s.match.test(bare));
}

function cleanBullet(line: string): string {
  const text = line
    .replace(/^\s*(?:[-•·*]|\d+[.)])\s*/, "")
    .replace(/[*`]/g, "")
    .trim();
  if (!text) return "";
  return text.length > MAX_BULLET_CHARS ? `${text.slice(0, MAX_BULLET_CHARS - 1).trimEnd()}…` : text;
}

/**
 * Parse the model's raw (already think-stripped / degeneration-guarded) output and
 * re-render it as the canonical four-section summary. `fallbackTitle` (the detected
 * doc type) is used when the model produced no usable Title line.
 */
export function formatDocSummary(raw: string, fallbackTitle: string): DocSummaryDisplay {
  const lines = raw.split("\n");
  let title = "";
  const bullets: string[][] = SECTIONS.map(() => []);
  let current = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const titleMatch = trimmed.match(/^(?:#*\s*)?title\s*[:\-]\s*(.+)$/i);
    if (titleMatch && !title) {
      title = titleMatch[1].replace(/[*`#]/g, "").trim().slice(0, MAX_TITLE_CHARS);
      continue;
    }

    const idx = sectionIndex(trimmed);
    if (idx >= 0) {
      current = idx;
      continue;
    }
    if (/^#{1,4}\s/.test(trimmed)) {
      current = -1; // unrecognized heading → everything under it is dropped
      continue;
    }
    if (current >= 0 && bullets[current].length < MAX_BULLETS) {
      // Explicitly marked bullets are kept (truncated). An UNMARKED line is kept only
      // when short — a long plain paragraph inside a section is the model rambling.
      const marked = /^\s*(?:[-•·*]|\d+[.)])\s/.test(trimmed);
      if (!marked && trimmed.split(/\s+/).length > MAX_PLAIN_LINE_WORDS) continue;
      const b = cleanBullet(trimmed);
      if (b && !META_LINE.test(b) && !NOT_STATED.test(b)) bullets[current].push(b);
    }
    // current === -1 → prose outside any recognized section: dropped by design.
  }

  // Model ignored the sections entirely → salvage the first few clean lines as
  // findings rather than showing an empty card. Everything else stays dropped.
  if (bullets.every((b) => b.length === 0)) {
    for (const line of lines) {
      const b = cleanBullet(line.trim());
      if (!b || /^title\s*[:\-]/i.test(line.trim())) continue;
      if (META_LINE.test(b) || NOT_STATED.test(b)) continue;
      bullets[1].push(b);
      if (bullets[1].length >= MAX_BULLETS) break;
    }
  }

  const markdown = SECTIONS.map(
    (s, i) =>
      `## ${s.heading}\n${(bullets[i].length ? bullets[i] : ["Not stated."]).map((b) => `- ${b}`).join("\n")}`,
  ).join("\n\n");

  return { title: title || fallbackTitle, markdown };
}

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

// The 4-bit model emits Unicode confusables under sampling pressure — Cyrillic
// lookalikes inside Latin words ("Augмenтин"), sub/superscript digits ("₅days"),
// stray diacritics ("Enzflemán"), letter-spaced numbers ("6 2 5 mg"). These are
// CONTENT defects, not rendering ones — no markdown renderer can fix them, so they
// are folded deterministically here. Field-observed set, Jul 2026.
const CYRILLIC_FOLD: Record<string, string> = {
  а: "a", в: "b", е: "e", ё: "e", з: "3", и: "u", й: "u", к: "k", м: "m", н: "n",
  о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", ь: "b",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T",
  У: "Y", Х: "X",
};

// Tail-degeneration detector. The word-level guards (noteGen truncateDegenerate) are
// blind to gibberish with NO SPACES — one giant letter-soup token reads as "1 word".
// Real clinical bullets never contain 30+ char unbroken alphanumeric runs (longest
// legit tokens: URLs ~20 chars, DOC_ tokens, drug names) nor 5+ identical chars in
// a row ("XXXXX"). Field screenshot, Jul 14 2026.
export function isGibberish(text: string): boolean {
  if (/([A-Za-z0-9])\1{4,}/.test(text)) return true;
  for (const run of text.split(/\s+/)) {
    const bare = run.replace(/[^A-Za-z0-9]/g, "");
    if (bare.length > 30) return true;
  }
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length > 40 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.8) {
    return true; // long all-caps soup
  }
  return false;
}

/** A content-free label bullet: ≤2 words ending in ':' ("Tabs :", "Summary:"). */
const LABEL_ONLY = /^\s*\S+(?:\s+\S+)?\s*:\s*$/;

/** Fold model glyph noise back into plain Latin clinical text. Pure + idempotent. */
export function sanitizeModelText(s: string): string {
  // NFKC folds sub/superscript digits (₅ → 5, ¹ˣ → 1x) and width variants.
  let out = s.normalize("NFKC");
  // Strip diacritics from Latin letters (Enzflemán → Enzfleman) without touching CJK.
  out = out.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");
  // Fold Cyrillic lookalikes that appear glued to Latin word fragments.
  out = out.replace(/[Ѐ-ӿ]/g, (ch) => CYRILLIC_FOLD[ch] ?? ch);
  // Collapse letter-spaced digit runs before a dose unit: "6 2 5 mg" → "625 mg".
  out = out.replace(/\b(\d(?: \d)+)\s*(mg|mcg|ml|g)\b/gi, (_, digits: string, unit: string) =>
    `${digits.replace(/ /g, "")} ${unit}`,
  );
  // LaTeX droppings ("$\geq$ $-$ $+$$") — backslash commands and dollar markers.
  out = out.replace(/\\[A-Za-z]+/g, "").replace(/\$+/g, "");
  // Underscore filler ("_Tab._Augmentor_in", "once_every_five_days") folds to spaces —
  // EXCEPT inside de-identification tokens, whose underscores are load-bearing.
  const tokens: string[] = [];
  out = out.replace(/\bDOC_[A-Z]+(?:_[A-Z]+)*(?:_\d+)?\b/g, (t) => {
    tokens.push(t);
    return `\u0000${tokens.length - 1}\u0000`;
  });
  out = out.replace(/_+/g, " ");
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => tokens[Number(i)]);
  // Drop stray per-mille filler; collapse the space debris left by the folds.
  out = out.replace(/[‰]+/g, "").replace(/ {2,}/g, " ").trim();
  return out;
}

// Contact metadata ("Ph: …", "Web: …", "Email: …") is source-document boilerplate the
// model shovels into Follow-up needed — never a clinical instruction. Dropped wherever
// it appears; the verified source text above the card keeps the real contact details.
const CONTACT_LINE = /^\W*(?:ph|tel|phone|fax|web|website|url|email|e-mail)\b\W*:/i;

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
  const text = sanitizeModelText(line)
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
      title = sanitizeModelText(titleMatch[1]).replace(/[*`#]/g, "").trim().slice(0, MAX_TITLE_CHARS);
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
      if (
        b &&
        /[A-Za-z0-9一-鿿]/.test(b) && // pure-punctuation husks render as empty dots
        !META_LINE.test(b) &&
        !NOT_STATED.test(b) &&
        !LABEL_ONLY.test(b) &&
        !CONTACT_LINE.test(b) &&
        !isGibberish(b)
      ) {
        bullets[current].push(b);
      }
    }
    // current === -1 → prose outside any recognized section: dropped by design.
  }

  // Model ignored the sections entirely → salvage the first few clean lines as
  // findings rather than showing an empty card. Everything else stays dropped.
  if (bullets.every((b) => b.length === 0)) {
    for (const line of lines) {
      const b = cleanBullet(line.trim());
      if (!b || /^title\s*[:\-]/i.test(line.trim())) continue;
      if (
        !/[A-Za-z0-9一-鿿]/.test(b) ||
        META_LINE.test(b) ||
        NOT_STATED.test(b) ||
        LABEL_ONLY.test(b) ||
        CONTACT_LINE.test(b) ||
        isGibberish(b)
      ) {
        continue;
      }
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

// Hybrid clinical highlighter. Two halves, each doing what it is good at:
//
//   • Numbers  — doses, vitals, timeframes — are matched DETERMINISTICALLY by regex.
//     A small on-device LLM cannot be trusted with digits (it hallucinates them), so
//     these are never left to the model.
//   • Red-flag symptoms — where CONTEXT matters ("no chest pain" is not a red flag) —
//     are supplied by the MODEL (hybrid). A curated CRITICAL danger set is ALSO always
//     scanned (safety net for code-switched notes the model may under-tag), and a
//     broader FALLBACK lexicon covers notes with no model list at all. A robust
//     negation engine keeps DENIED / ABSENT / RULED-OUT symptoms un-highlighted.
//
// Three categories map to three markdown emphasis channels (distinct colours in
// NoteMarkdown):
//   **strong**  → doses & vitals      → green  (clinical values / "how much")
//   *em*        → timeframes          → blue   ("when")
//   `code`      → red-flag symptoms   → red    ("danger")
//
// Written for Malaysian clinics: dose units, timeframe formats (Commonwealth "3/7"
// shorthand), and symptom + negation lexicons cover code-switched Malay/English notes.
// Presentation-only: applied at render time, never persisted or exported.

// ---------------------------------------------------------------------------
// Doses & vitals (green)
// ---------------------------------------------------------------------------

// Labelled vital readings. Each label takes a following number (bare single-letter
// "T"/"P" are dropped — too ambiguous with T4/T2DM/"Plan"). Optional unit incl. kg/g
// for weights and °C/°F for temperature written without the degree sign.
const VITAL_LABEL =
  "Temp(?:erature)?|Pulse|HR|SpO2|SaO2|O2 ?sats?|O2|sats|BP|RR|GCS|BMI|Wt|Weight|Ht|Height|RBS|CBG|BSL|DXT|RBG|FBS|glucose|suhu|nadi|berat|pernafasan|TD";
const VITAL_SRC = `\\b(?:${VITAL_LABEL})\\s?[:=]?\\s?\\d+(?:\\.\\d+)?(?:\\/\\d+)?\\s?(?:°?[CF]|bpm|%|mmHg|mmol\\/L|kg|g|\\/min)?`;

// Measured quantity with an explicit multi-char unit. Longest units first so
// "mg/kg" beats "mg" and "g/dL" beats bare "g". Ranges ("1-2 tablets") and a
// leading decimal (".5 mg") are allowed; a trailing plural "s" ("5mgs") is tolerated.
const UNIT_CI =
  "mmol\\/L|mmol|micrograms?|mcg|µg|milligrams?|mg\\/kg|mcg\\/kg|mg|kilograms?|kg|g\\/dL|grams?|nanograms?|ng|IU|mL|ml|cc|litres?|puffs?|sprays?|drops?|tablets?|tabs?|capsules?|caps?|sachets?|nebs?|units?|biji|titis|sudu(?: teh| besar)?|°C|°F|bpm|mmHg";
const DOSE_UNIT_SRC = `\\b(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:\\s?(?:-|–|to)\\s?\\d+)?\\s?(?:${UNIT_CI})s?(?![a-zA-Z])`;

// Standalone dosing route / frequency. "on"/"om" excluded (collide with "on room
// air" / ordinary words).
const FREQ_SRC = "\\b(?:PO|IV|IM|SC|SL|od|bd|tds|tid|qid|qds|nocte|prn|mane|stat|q\\d+h)\\b";

// One green pass: alternation is tried left-to-right, so a labelled vital swallows its
// own trailing unit before the bare unit rule can re-match inside it.
const GREEN = new RegExp(`(?:${VITAL_SRC})|(?:${DOSE_UNIT_SRC})|(?:${FREQ_SRC})`, "gi");

// Bare single-letter units are CASE-SENSITIVE: lowercase "g" (grams) or capital
// "L"/"U" (litres / units). This keeps an address ("12G Jalan") or a grade ("2A")
// from ever reading as a dose. Runs after GREEN; skips anything already wrapped.
const DOSE_BARE = /\b(?:\d+(?:\.\d+)?|\.\d+)\s?(?:g|L|U)(?![a-zA-Z])/g;

// ---------------------------------------------------------------------------
// Timeframes / durations (blue)
// ---------------------------------------------------------------------------

const DUR_UNIT =
  "days?|weeks?|wks?|wk|hours?|hrs?|hr|h|months?|mths?|mth|mo|years?|yrs?|yr|mins?|minutes?|min|seconds?|secs?|sec|hari|minggu|bulan|tahun|jam|minit|saat";
const DURATION = new RegExp(
  "\\b(?:" +
    "\\d+\\/(?:7|52|12|24)" + // Commonwealth shorthand: 3/7=days, 2/52=weeks, 3/12=months
    `|\\d+(?:\\.\\d+)?(?:\\s?(?:-|–|to)\\s?\\d+)?[\\s-]?(?:${DUR_UNIT})` + // 3 days, 2-3 days, 3-day, 48h, 2.5 hours, 3 hari
    `|(?:satu|dua|tiga|empat|lima|enam|tujuh|lapan|sembilan|sepuluh)\\s+(?:${DUR_UNIT})` + // Malay word-number: tiga hari
    "|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|few|couple|several)\\s+(?:days?|weeks?|hours?|months?|years?|mins?|minutes?|nights?|fortnights?)" + // English word-number: two days, a week
    "|se(?:minggu|bulan|hari|tahun|jam|minit)" + // Malay "one-<unit>": seminggu, sebulan
    "|fortnights?|overnight" +
    ")(?![a-zA-Z])",
  "gi",
);

// Relative onset ("since Monday", "sejak semalam") — a blue timeframe with no number.
const RELATIVE = new RegExp(
  "\\b(?:since|sejak)\\s+(?:" +
    "monday|tuesday|wednesday|thursday|friday|saturday|sunday" +
    "|yesterday|last (?:night|week|month|year)|this (?:morning|afternoon|evening)" +
    "|semalam|kelmarin|pagi tadi|malam tadi|petang tadi" +
    ")\\b",
  "gi",
);

// ---------------------------------------------------------------------------
// Red-flag symptoms (red)
// ---------------------------------------------------------------------------

// CRITICAL: unambiguous danger symptoms (English + Malay) always scanned, even when
// the model supplies its own flags — a safety net so a code-switched note the model
// under-tags never hides a red flag. Curated to avoid false positives (bare "sesak"
// can mean a blocked nose; bare "sakit perut" is too generic — excluded here).
const CRITICAL = [
  // English
  "chest pain", "chest tightness", "chest pressure", "chest heaviness",
  "shortness of breath", "breathlessness", "breathless",
  "haemoptysis", "hemoptysis", "coughing up blood", "coughing blood",
  "haematemesis", "hematemesis", "vomiting blood", "coffee-ground vomit",
  "melaena", "melena", "black tarry stools",
  "syncope", "loss of consciousness", "altered consciousness", "altered mental status",
  "seizure", "convulsion", "fits",
  "slurred speech", "facial droop", "one-sided weakness", "focal weakness",
  "stridor", "central cyanosis", "cyanosis",
  "suicidal ideation", "suicidal thoughts",
  "non-blanching rash", "petechial rash",
  "neck stiffness", "thunderclap headache", "worst headache",
  "anaphylaxis",
  // Malay
  "sakit dada", "sesak nafas", "sesak napas", "tak boleh nafas", "termengah-mengah",
  "batuk darah", "muntah darah", "berak darah", "berak hitam", "najis hitam", "kencing darah",
  "sawan", "kejang demam", "pengsan", "pitam",
  "lemah sebelah badan", "lemah anggota",
  "sakit kepala teruk", "sakit perut teruk",
  "tak sedarkan diri", "hilang kesedaran", "demam tinggi",
];

// FALLBACK: broader lexicon, added only when the model supplied NO flags at all.
const FALLBACK = [
  ...CRITICAL,
  "palpitations", "collapse", "fainting", "blackout",
  "severe headache", "photophobia", "new-onset confusion", "reduced gcs", "reduced consciousness",
  "arm weakness", "leg weakness", "limb weakness", "facial weakness", "dysarthria", "difficulty speaking",
  "sudden vision loss", "double vision", "diplopia",
  "coffee-ground vomit", "pr bleeding", "per rectal bleeding", "rectal bleeding", "blood in stool",
  "bloody stools", "haematochezia", "haematuria", "blood in urine",
  "severe abdominal pain", "guarding", "rebound tenderness", "persistent vomiting",
  "bleeding gums", "epistaxis", "difficulty breathing", "respiratory distress",
  "unable to swallow", "difficulty swallowing", "dysphagia", "drooling", "throat swelling",
  "rigors", "rigor", "purpuric rash", "petechiae",
  "self-harm", "reduced urine output", "not passing urine", "anuria", "urinary retention",
  "night sweats", "unintentional weight loss", "unexplained weight loss", "weight loss",
  "reduced fetal movements", "high fever", "worst headache of life", "unconscious",
];

// ---------------------------------------------------------------------------
// Negation engine
// ---------------------------------------------------------------------------
//
// A symptom is treated as negated (NOT painted red) when it sits in a negated scope.
// The engine handles four failure modes real notes exhibit:
//   • pre-nominal  : "no / denies / free of / tiada  chest pain"
//   • post-nominal : "chest pain denied / : nil / resolved / ruled out / tak ada"
//   • list-carry   : "denies chest pain, breathlessness and haemoptysis" (all denied)
//   • scope-reset  : "no fever BUT has chest pain" (chest pain is PRESENT)
//
// Scope: PRE runs back to the previous '.'/';' or a reset word (contrast conjunction
// or positive-assertion verb) — NOT a comma, so denial lists carry. POST runs forward
// to the next '.'/';'/','/contrast-conjunction. A post-nominal absence cue negates;
// a pre-nominal negation cue negates UNLESS a positive-assertion marker follows.

const NEG_PRE =
  /\b(?:no|not|nil|without|denies|denied|deny|denying|negative|absence of|absent|free of|clear of|no evidence of|ruled? out|rules out|doesn't|didn't|isn't|wasn't|hasn't|haven't|don't|cannot|can't|unremarkable|tiada|tak ada|takde|tak|tidak|bukan|tanpa|belum)\b/i;

// Trailing absence markers (bind to the immediately-preceding symptom).
const NEG_POST =
  /\b(?:denied|deny|nil|none|absent|resolved|settled|ruled out|negative|not present|not seen|tiada|tak ada|takde)\b/i;

// Positive-assertion markers — if one follows the symptom, a distant pre-negation is
// overridden (the symptom is genuinely present). Deliberately narrow: bare "now" is
// excluded ("no chest pain now" is still a denial) and "reports/reported" is excluded
// ("no SOB reported" = denied). "now reports X" is handled by PRE-reset, not here.
const POS_MARK = /\b(?:severe|worse|worsening|present|ongoing|active|positive|still|makin teruk)\b/i;

// Reset words end a preceding negation's scope (contrast conjunctions + positive
// assertion verbs). NOT "and"/"or" (those carry a denial across a symptom list).
const RESET =
  /\b(?:but|however|although|though|otherwise|except|whereas|apart from|aside from|tapi|tetapi|namun|reports?|reported|reporting|complains?|complaining|complained|c\/o|presents?|presenting|presented|develops?|developed|developing|admits?|endorses?|now|currently|positive for)\b/gi;
// Contrast conjunctions also terminate POST scope.
const POST_STOP = /[.;,]|\b(?:but|however|although|though|otherwise|and|or|tapi|tetapi|namun)\b/gi;

// Last index at which a PRE-scope boundary ends before `idx` (previous '.'/';' or the
// end of a reset word). Comma is intentionally NOT a boundary.
function preScopeStart(line: string, idx: number): number {
  let start = 0;
  const dot = Math.max(line.lastIndexOf(".", idx - 1), line.lastIndexOf(";", idx - 1));
  if (dot >= 0) start = dot + 1;
  RESET.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RESET.exec(line)) !== null) {
    if (m.index >= idx) break;
    const end = m.index + m[0].length;
    if (end <= idx && end > start) start = end;
  }
  return start;
}

// First index at which POST scope ends after `end` (next '.'/';'/','/contrast word).
function postScopeEnd(line: string, end: number): number {
  POST_STOP.lastIndex = end;
  const m = POST_STOP.exec(line);
  return m ? m.index : line.length;
}

// True when the symptom occupying [idx, end) sits in a negated scope.
function isNegated(line: string, idx: number, end: number): boolean {
  const pre = line.slice(preScopeStart(line, idx), idx);
  const post = line.slice(end, postScopeEnd(line, end));
  if (NEG_POST.test(post)) return true;
  if (NEG_PRE.test(pre) && !POS_MARK.test(post)) return true;
  return false;
}

// ---------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalise model output before the deterministic highlighter runs:
 *  1. collapse a doubled leading bullet ("- • item" / "- - item" → "- item").
 *  2. strip the model's own emphasis marks (**bold**, __bold__). Emphasis is owned
 *     entirely by highlightClinical; leaving the model's marks in causes an unbalanced
 *     "**" to render as literal asterisks and to suppress this line's highlighting.
 */
export function normalizeNoteMarkdown(markdown: string): string {
  return markdown
    .replace(/^(\s*[-*])\s+[•·*+-]\s+/gm, "$1 ")
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/__([\s\S]*?)__/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/__/g, "");
}

/**
 * True when a drafted note has essentially no content (headings only, or blank).
 */
export function noteIsEmpty(markdown: string): boolean {
  const body = markdown.replace(/^\s*#.*$/gm, "").replace(/[#*_>`\-•\s]/g, "");
  return body.length < 12;
}

// Wrap every non-negated, non-nested occurrence of `phrase` with `` ` `` (red channel).
function wrapRedFlag(line: string, phrase: string): string {
  const re = new RegExp(`\\b${escapeRe(phrase)}\\b`, "gi");
  return line.replace(re, (m, offset: number) => {
    if (line[offset - 1] === "`") return m; // already inside a red wrapper
    if (isNegated(line, offset, offset + m.length)) return m;
    return `\`${m}\``;
  });
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs.map((x) => x.toLowerCase()))];
}

/**
 * Highlight a note's clinical terms for on-screen rendering.
 *
 * @param markdown  the re-identified note markdown
 * @param redFlags  present danger symptoms from the model (hybrid path). The curated
 *                  CRITICAL set is always scanned too; the broad FALLBACK lexicon is
 *                  added only when no model flags were supplied.
 */
export function highlightClinical(markdown: string, redFlags?: string[]): string {
  const model = redFlags && redFlags.length > 0 ? redFlags : [];
  // Longest phrases first so "chest tightness" wins before any substring rule.
  const flags = dedupe([...CRITICAL, ...model, ...(model.length ? [] : FALLBACK)]).sort(
    (a, b) => b.length - a.length,
  );
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*#/.test(line)) return line; // leave headings alone
      let l = line;
      // Red flags first (words), then timeframes (blue), then doses/vitals (green).
      // Categories are numeric-vs-word, so a later rule can't match inside an earlier
      // wrapper. Each wrap is balanced.
      for (const rf of flags) l = wrapRedFlag(l, rf);
      l = l.replace(RELATIVE, (m) => `*${m}*`);
      l = l.replace(DURATION, (m) => `*${m}*`);
      l = l.replace(GREEN, (m) => `**${m}**`);
      l = l.replace(DOSE_BARE, (m, offset: number) =>
        l[offset - 1] === "*" ? m : `**${m}**`,
      );
      return l;
    })
    .join("\n")
    .replace(/\*\*\*\*/g, ""); // collapse accidental empty-bold from adjacent matches
}

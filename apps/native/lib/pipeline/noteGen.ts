// On-device SOAP note generation (Day 3, Gate 2/3).
//
// Takes the DE-IDENTIFIED transcript (redaction tokens in place) and asks the
// on-device LLM to draft a SOAP note. The model only ever sees
// de-identified text (tokens like NAME_1, IC_1) — the caller re-identifies the
// result locally, from the secure map, before showing it to the clinician. This
// keeps the moat intact: only de-identified text is ever fed to the model, so the
// path is identical whether the model runs on-device (this week) or on the
// optional cloud path (later).
//
// The pure helpers (stripThink, buildTranscript, parseSoap, classifyOrder) have no
// native dependency and are unit-tested in ./noteGen.test.ts. Only `generateNote`
// touches the native LLM.

import type { KnowledgeDoc } from "../knowledge/corpus";
import type { NoteOrder } from "../db/types";
import type { RedactedSegment } from "./redaction";

export interface Msg {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Minimal shape of the object returned by useLLM (react-native-executorch). */
export interface LlmLike {
  generate: (messages: Msg[]) => Promise<string>;
}

export interface DraftNote {
  soap: { subjective: string; objective: string; assessment: string; plan: string };
  orders: NoteOrder[];
  /** Full model text after think-strip. De-identified until the caller re-IDs it. */
  raw: string;
  /**
   * Short, PII-FREE clinical title for the consult list (e.g. "URTI follow-up").
   * Generated from the de-identified transcript and kept de-identified — never
   * re-identified, so a patient name can never surface in a list screen.
   */
  title: string;
  /**
   * The note body as Markdown (## headings, **bold** key findings, - lists),
   * for rich rendering. Re-identified by the caller before display. The structured
   * `soap`/`orders` above are the plain-text derivation used for export.
   */
  markdown: string;
  /**
   * Red-flag / danger symptoms the model judged ACTUALLY PRESENT in this patient
   * (context-aware: "no chest pain" yields nothing). This is the model half of the
   * hybrid highlighter — the deterministic regex handles numbers/doses/vitals it can
   * be trusted with, the model handles which symptoms are present vs denied. Each
   * entry is a short symptom phrase, de-identified (no tokens), and only highlighted
   * where it appears verbatim in the note. Empty when the model emitted none.
   */
  redFlags: string[];
  /**
   * Reference-corpus entries the note was grounded in (retrieved from the transcript).
   * Shown as citation chips on the note screen. Empty when grounding is off / no match.
   */
  guidelines: KnowledgeDoc[];
  /** Wall-clock time of the on-device model inference (ms) — proof of on-device speed. */
  generationMs: number;
}

// Any surviving redaction token — a title must never contain one.
const TITLE_TOKEN_RE = /\b(?:NAME|NAME_UNCERTAIN|IC|PHONE|ADDR|ADDRESS|MRN|EMAIL|DOB)_\d+\b/gi;

/**
 * Peel a leading "Title: …" line off the model output. Returns the raw title and
 * the remaining text (so the SOAP parser doesn't see the title line).
 */
export function parseTitle(text: string): { title: string; rest: string } {
  const m = text.match(/^[\s>#*\-]*\*{0,2}title\*{0,2}\s*[:\-]\s*(.+)$/im);
  if (!m || m.index === undefined) return { title: "", rest: text };
  const title = m[1].trim().replace(/^["'“‘]+|["'”’.]+$/g, "").trim();
  const rest = text.slice(0, m.index) + text.slice(m.index + m[0].length);
  return { title, rest };
}

/**
 * Make a safe consult title: strip any redaction token, bound the length, and
 * fall back to the assessment/subjective first phrase, then a generic, if the
 * model's title is empty or unusable. The result is always PII-free.
 */
export function safeTitle(rawTitle: string, soap: DraftNote["soap"]): string {
  const clean = (s: string) =>
    s.replace(TITLE_TOKEN_RE, "").replace(/\s{2,}/g, " ").replace(/[·•:\-–—]+$/g, "").trim();

  const t = clean(rawTitle);
  if (t.length >= 3 && t.length <= 60) return t;

  for (const section of [soap.assessment, soap.subjective]) {
    const first = clean(section.split(/[.,;\n]/)[0] ?? "");
    if (first.length >= 3) return first.slice(0, 60);
  }
  return "Consult";
}

export const NOTE_SYSTEM_PROMPT =
  "You are a clinical documentation assistant. Convert the de-identified consultation " +
  "transcript into a concise SOAP note in English. FIRST output a single line " +
  "'Title: ' followed by a 3 to 6 word clinical summary of the visit (the chief " +
  "complaint or assessment, e.g. 'URTI follow-up' or 'Cough and fever'). The title must " +
  "contain NO patient names, IC numbers, phone numbers, addresses, or identifier tokens. " +
  "Then output the note as GitHub-flavoured Markdown: each section as a level-2 heading " +
  "('## Subjective', '## Objective', '## Assessment', '## Plan'), then a final " +
  "'## Orders & follow-ups' heading with a '- ' bulleted list. Use **bold** to emphasise " +
  "the key clinical findings (working diagnosis, abnormal vitals, red-flag symptoms). The " +
  "Orders list should cover " +
  "review intervals, tests ordered, medications with " +
  "doses, and safety-net advice the clinician stated. Use ONLY information present in the " +
  "transcript. Do not invent findings, medications, or doses. The identity-verification " +
  "exchange (IC number, phone number, address tokens such as IC_1, PHONE_1, ADDR_1) is " +
  "administrative — do not repeat it in any section of the note. If you must refer to the " +
  "patient, keep any identifier token such as NAME_1 exactly as written. No preamble, no " +
  "closing remarks. " +
  "FINALLY, on the very last line output 'Flags: ' followed by a semicolon-separated list " +
  "of any red-flag or danger symptoms that are ACTUALLY PRESENT in this patient (e.g. " +
  "'chest pain; haemoptysis'). Include a symptom ONLY if the transcript states the patient " +
  "HAS it — never list a symptom that was denied, ruled out, or absent ('no chest pain', " +
  "'denies breathlessness' → do NOT list it). Write each symptom exactly as it appears in " +
  "the note. If there are no present red flags, output 'Flags: none'.";

// Peel the trailing "Flags: …" line (present red-flag symptoms). Case-insensitive,
// tolerant of markdown/list marks. Splits on ; or , into trimmed phrases; treats
// "none"/"nil"/empty as no flags. Strips any stray redaction token (defence in depth
// — the list should already be symptom words only).
export function parseFlags(text: string): { flags: string[]; rest: string } {
  const m = text.match(/^[\s>#*\-]*\*{0,2}(?:red[-\s]?)?flags?\*{0,2}\s*[:\-]\s*(.*)$/im);
  if (!m || m.index === undefined) return { flags: [], rest: text };
  const rest = text.slice(0, m.index) + text.slice(m.index + m[0].length);
  const flags = m[1]
    .split(/[;,]/)
    .map((f) => f.replace(TITLE_TOKEN_RE, "").replace(/[*_`."'“”‘’]/g, "").trim())
    .filter((f) => f.length >= 3 && !/^(none|nil|n\/a|no red flags?)$/i.test(f));
  return { flags, rest: rest.trim() };
}

/** Strip inline Markdown (bold/italic/code/heading/list marks) → clean plain text for export. */
export function stripInlineMd(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    // Drop any residual UNBALANCED emphasis markers the small model left behind
    // (e.g. an opened "**" whose closer it dropped). Balanced pairs are gone above;
    // this clears the leftovers so raw "**" never reaches the stored/rendered note.
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Model-agnostic scratchpad strip. Some reasoning models wrap their chain-of-thought
 * in <think>…</think> before the answer. Strip closed blocks, and if generation was
 * cut off inside an unclosed <think>, drop everything from it onward so no scratchpad
 * leaks into the note. A harmless no-op for models that never emit <think>.
 */
export function stripThink(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const dangling = out.search(/<think>/i);
  if (dangling !== -1) out = out.slice(0, dangling);
  return out.trim();
}

/**
 * Truncate at the first DEGENERATE line — the failure mode where a small model dissolves into
 * synonym waterfalls ("zealously fervently ardently…") or alphabet soup ("dadada abcdefgh…").
 * Heuristics per line (long lines only, CJK-safe): low unique-word ratio, vowel-less latin
 * blobs, or single-letter runs. Everything from the first degenerate line onward is dropped —
 * model junk can never reach the clinician. Pure + unit-tested.
 */
export function truncateDegenerate(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (words.length >= 12) {
      const latin = words.filter((w) => /^[a-zA-Z'’-]+$/.test(w));
      const uniq = new Set(words.map((w) => w.toLowerCase())).size / words.length;
      const shortish = latin.filter((w) => w.length <= 3).length / (latin.length || 1);
      const novowel = latin.filter((w) => w.length >= 4 && !/[aeiouy]/i.test(w)).length / (latin.length || 1);
      // Real English prose of this length always carries function words; synonym waterfalls
      // ("zealously fervently ardently…") are long runs of unique content words with none.
      const FN = /^(the|a|an|is|are|was|were|be|to|of|in|on|at|for|and|or|but|with|if|as|by|no|not|has|have|had|his|her|their|this|that|from|after|before|when|while|which)$/i;
      const fnRatio = latin.length >= 12 ? words.filter((w) => FN.test(w)).length / words.length : 1;
      // Degenerate: heavy word-reuse, letter-soup tokens, vowel-less blobs, or zero-glue prose.
      if (uniq < 0.45 || (latin.length >= 10 && (shortish > 0.6 || novowel > 0.3)) || fnRatio < 0.05) break;
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

/**
 * Collapse degenerate repetition loops in model output: a small model on a thin transcript can
 * emit the same sentence dozens of times ("He is not on any current medical treatment." ×30).
 * Keeps the FIRST occurrence of each consecutive duplicate sentence (per line, so Markdown
 * structure is untouched); distinct content and non-adjacent repeats are preserved. Pure.
 */
export function collapseRepeats(text: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return text
    .split(/\r?\n/)
    .map((line) => {
      const parts = line.split(/(?<=[.!?])\s+/);
      const out: string[] = [];
      let last = "";
      for (const p of parts) {
        const n = norm(p);
        if (n && n === last) continue; // consecutive duplicate sentence → drop
        last = n || last;
        out.push(p);
      }
      return out.join(" ");
    })
    .join("\n");
}

/**
 * Join the de-identified transcript into a compact "Speaker: text" script for the
 * note prompt. Tokens (NAME_1, IC_1, …) are preserved verbatim.
 */
export function buildTranscript(segments: RedactedSegment[]): string {
  return segments
    .map((s) => `${s.speaker === "doctor" ? "Doctor" : "Patient"}: ${s.text}`)
    .join("\n");
}

/** Classify an order line into a NoteOrder.kind by keyword (first match wins). */
export function classifyOrder(text: string): NoteOrder["kind"] {
  const t = text.toLowerCase();
  if (/\bparacetamol\b|\bantibiotic|\b\d+\s?(mg|gram|g)\b|\btablet\b|\bdose\b|\bmedication\b/.test(t))
    return "medication";
  if (/\bfbc\b|\bfull blood count\b|\bblood(s|\s?count)?\b|\btest\b|\bx-?ray\b|\bswab\b|\bculture\b/.test(t))
    return "test";
  if (/\breview\b|\bfollow[-\s]?up\b|\bin (one|1|two|2|three|3) week/.test(t)) return "review";
  if (/\breturn\b|\bcome back\b|\bif (worse|not better|significantly|very )?\s?breathless|\bsafety|\burgent/.test(t))
    return "safety-net";
  return "other";
}

// Split an "Orders & follow-ups" block into structured rows. Strips list markers,
// drops empties and any repeated heading line.
function parseOrders(block: string): NoteOrder[] {
  return block
    .split(/\n+/)
    .map((l) => l.replace(/^[\s>#*\-•·\d.)]+/, "").trim())
    .filter((l) => l.length > 0 && !/^orders?\b/i.test(l))
    .map((text) => ({ kind: classifyOrder(text), text }));
}

// Heading matchers. Each matches the label at the start of a line (allowing markdown
// emphasis / list markers before it) up to an optional colon; content is whatever
// follows on that line and subsequent lines, until the next heading.
const SOAP_HEADS: { key: "subjective" | "objective" | "assessment" | "plan"; re: RegExp }[] = [
  { key: "subjective", re: /^[\s>#*\-\d.)]*\*{0,2}subjective\*{0,2}\s*:?/im },
  { key: "objective", re: /^[\s>#*\-\d.)]*\*{0,2}objective\*{0,2}\s*:?/im },
  { key: "assessment", re: /^[\s>#*\-\d.)]*\*{0,2}assessment\*{0,2}\s*:?/im },
  { key: "plan", re: /^[\s>#*\-\d.)]*\*{0,2}plan\*{0,2}\s*:?/im },
];
const ORDERS_HEAD = /^[\s>#*\-\d.)]*\*{0,2}orders?\b[^\n]*:?/im;

/**
 * Tolerant SOAP parser. Locates the four section headings plus an optional
 * "Orders & follow-ups" heading, slices the text between them, and peels the orders
 * list into structured rows. If nothing parses (model ignored the format), the whole
 * cleaned text falls back into Subjective so it is still shown, never silently dropped.
 */
export function parseSoap(text: string): { soap: DraftNote["soap"]; orders: NoteOrder[] } {
  const marks: { key: string; start: number; headEnd: number }[] = [];
  for (const h of SOAP_HEADS) {
    const m = h.re.exec(text);
    if (m) marks.push({ key: h.key, start: m.index, headEnd: m.index + m[0].length });
  }
  const om = ORDERS_HEAD.exec(text);
  if (om) marks.push({ key: "orders", start: om.index, headEnd: om.index + om[0].length });
  marks.sort((a, b) => a.start - b.start);

  const sections: Record<string, string> = {};
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i];
    const next = marks[i + 1];
    sections[cur.key] = text.slice(cur.headEnd, next ? next.start : text.length).trim();
  }

  const soap = {
    subjective: sections.subjective ?? "",
    objective: sections.objective ?? "",
    assessment: sections.assessment ?? "",
    plan: sections.plan ?? "",
  };
  const orders = parseOrders(sections.orders ?? "");

  if (!soap.subjective && !soap.objective && !soap.assessment && !soap.plan && orders.length === 0) {
    soap.subjective = text.trim();
  }
  return { soap, orders };
}

/**
 * Draft a SOAP note from the de-identified transcript on-device. The model sees ONLY
 * tokens; the returned note is still de-identified — the caller re-identifies it
 * locally (secure map) before display/persist. Throws if the LLM call fails.
 */
export async function generateNote(
  llm: LlmLike,
  segments: RedactedSegment[],
  systemPrompt: string = NOTE_SYSTEM_PROMPT,
  guidelineContext = "",
  docContext = "",
): Promise<DraftNote> {
  // Optionally ground the note in retrieved references — additive, so an empty context
  // leaves the prompt (and existing behaviour) unchanged.
  const system = guidelineContext
    ? `${systemPrompt}\n\nRELEVANT CLINICAL REFERENCES (use ONLY to strengthen safety-netting and red-flag advice; never contradict the transcript and never invent findings or doses):\n${guidelineContext}`
    : systemPrompt;
  // Attached scanned documents ride in the USER message — they are encounter facts
  // (like the transcript), not instructions. De-identified + clinician-verified upstream.
  // Trailing /no_think = Qwen3's soft switch to skip the <think> phase (fast, and the
  // strict format leaves nothing to deliberate about); stripThink cleans any residue.
  const userContent =
    (docContext ? `${buildTranscript(segments)}\n\n${docContext}` : buildTranscript(segments)) +
    "\n/no_think";
  const messages: Msg[] = [
    { role: "system", content: system },
    { role: "user", content: userContent },
  ];
  const t0 = Date.now();
  const rawOut = await llm.generate(messages);
  const generationMs = Date.now() - t0;
  const clean = truncateDegenerate(collapseRepeats(stripThink(rawOut)));
  const { title: rawTitle, rest: afterTitle } = parseTitle(clean);
  // Peel the trailing Flags line before anything else parses the body, so the
  // sidecar never leaks into the SOAP sections or the rendered markdown.
  const { flags: redFlags, rest } = parseFlags(afterTitle);
  const markdown = rest.trim();

  // Parse into structured sections, then strip inline markdown → clean text for
  // export. The markdown string above is kept for rich on-screen rendering.
  const parsed = parseSoap(rest);
  const soap = {
    subjective: stripInlineMd(parsed.soap.subjective),
    objective: stripInlineMd(parsed.soap.objective),
    assessment: stripInlineMd(parsed.soap.assessment),
    plan: stripInlineMd(parsed.soap.plan),
  };
  const orders = parsed.orders.map((o) => ({ ...o, text: stripInlineMd(o.text) }));
  const title = safeTitle(rawTitle, soap);
  // guidelines are attached by the caller (draftClinicalNote), which did the retrieval.
  return { soap, orders, raw: clean, title, markdown, redFlags, guidelines: [], generationMs };
}

// On-device SOAP note generation (Day 3, Gate 2/3).
//
// Takes the DE-IDENTIFIED transcript (redaction tokens in place) and asks the
// on-device LLM (Qwen3-1.7B) to draft a SOAP note. The model only ever sees
// de-identified text (tokens like NAME_1, IC_1) — the caller re-identifies the
// result locally, from the secure map, before showing it to the clinician. This
// keeps the moat intact: only de-identified text is ever fed to the model, so the
// path is identical whether the model runs on-device (this week) or on the
// optional cloud path (later).
//
// The pure helpers (stripThink, buildTranscript, parseSoap, classifyOrder) have no
// native dependency and are unit-tested in ./noteGen.test.ts. Only `generateNote`
// touches the native LLM.

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
}

export const NOTE_SYSTEM_PROMPT =
  "You are a clinical documentation assistant. Convert the de-identified consultation " +
  "transcript into a concise SOAP note in English. Output exactly four sections, each " +
  "heading on its own line: 'Subjective', 'Objective', 'Assessment', 'Plan'. After the " +
  "Plan section add a heading 'Orders & follow-ups' followed by a bulleted list, one item " +
  "per line starting with '- ', covering review intervals, tests ordered, medications with " +
  "doses, and safety-net advice the clinician stated. Use ONLY information present in the " +
  "transcript. Do not invent findings, medications, or doses. The identity-verification " +
  "exchange (IC number, phone number, address tokens such as IC_1, PHONE_1, ADDR_1) is " +
  "administrative — do not repeat it in any section of the note. If you must refer to the " +
  "patient, keep any identifier token such as NAME_1 exactly as written. No preamble, no " +
  "closing remarks.";

/**
 * Qwen3 is a reasoning model: it wraps its scratchpad in <think>…</think> before the
 * answer. Strip closed think blocks, and if generation was cut off inside an unclosed
 * <think>, drop everything from it onward so no scratchpad leaks into the note.
 */
export function stripThink(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const dangling = out.search(/<think>/i);
  if (dangling !== -1) out = out.slice(0, dangling);
  return out.trim();
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
export async function generateNote(llm: LlmLike, segments: RedactedSegment[]): Promise<DraftNote> {
  const messages: Msg[] = [
    { role: "system", content: NOTE_SYSTEM_PROMPT },
    { role: "user", content: buildTranscript(segments) },
  ];
  const rawOut = await llm.generate(messages);
  const clean = stripThink(rawOut);
  const { soap, orders } = parseSoap(clean);
  return { soap, orders, raw: clean };
}

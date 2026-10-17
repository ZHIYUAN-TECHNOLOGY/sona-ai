import type { Mark } from "@sona-ai/domain/answer-parts";

import { LEAD_MAX, checkAskSpec, type AskContext, type AskSpec } from "./ask-spec";
import { BOXES, BRAIN_MODEL, answered, boxes, starting, wakingOf, type Baseten } from "./baseten-models";
import { jsonIn, marksIn } from "./chat-models";
import { layaEvaluator, pickCard } from "./laya";

/**
 * Sona's ask bar on the models: Laya routes a visit request to its card (ask.route), and Gemma answers any
 * question asked on a page (ask.free): from the page's own data when it can, otherwise from general knowledge,
 * marked `general`. A call failing or timing out returns `{ source: "fixture" }` and the app keeps its keyword
 * routing; `unanswered` is left only for a model that returned nothing usable at all. A failed call wakes its box for
 * next time, and while the box is starting the fixture says in how many minutes (`waking`).
 */
export const LAYA_MODEL = "sona-laya";

const endpoint = (id: string) => `https://model-${id}.api.baseten.co/environments/production`;
/** The caller's fetch with Baseten's key header on every call. */
const keyed = ({ apiKey, fetcher = fetch }: Baseten) =>
  ((input: string, init?: RequestInit) => fetcher(input, { ...init, headers: { ...init?.headers as Record<string, string>, Authorization: `Api-Key ${apiKey}` } })) as typeof fetch;

/** Which card answers a visit request, from Laya (pickCard: 5 s timeout). `patient` is the visit label, as Laya was trained. */
export async function routeRequest(baseten: Baseten, input: { request: string; patient: string }) {
  try {
    const pick = await pickCard(layaEvaluator({ url: `${endpoint(BOXES.laya)}/sync`, fetcher: keyed(baseten) }), input);
    answered("laya");
    return { source: "model" as const, model: LAYA_MODEL, ...pick };
  } catch {
    // Laya has no reliable health route, so its 5 s pick is the check: a failure means it is starting (about a minute).
    starting("laya");
    await boxes(baseten).wake("laya");
    return { source: "fixture" as const, ...wakingOf("laya") };
  }
}

// 9 Oct (founder, for the 13 Oct judges): Sona Pro answers clinicians fully, general clinical knowledge included; the doctor decides.
const FREE = `You answer a hospital clinician's question asked on one page of their app, fully and directly, as a knowledgeable colleague; the clinician decides.
When the page's data below answers the question, in whole or in part, answer with JSON only in this shape:
{"root":"f","elements":{"f":{"type":"AskColumn","props":{},"children":["f-0","f-1"]},"f-0":{"type":"AskLead","props":{"text":"<one or two sentences that answer the question from the page>"},"children":[]},"f-1":{"type":"AskRows","props":{"rows":[<rows>]},"children":[]}},"general":"<optional>"}
Rules:
- <rows>: up to 8 of the page's rows that answer the question, most important first, each copied exactly as given (id, title, detail, tone, op). If no row answers it, leave out "f-1" and its child id.
- The lead, under 280 characters, in your own words: every patient, bed, name and number in it must be one the page's data or the question states (a count of the rows is fine). Never invent a patient, bed, task, result or count.
- "general": what general clinical knowledge adds for this clinician (likely causes, what to check, usual management or doses), in up to 5 short sentences; leave it out when it adds nothing. It is shown labelled as general knowledge.
- A visit's patient record, when the page has one, is the page's data: any question about this patient (their readings, results, medicines, allergies, history, stay or plan) takes this shape, even when most of the answer is general knowledge; the lead says what the record holds, or that it does not record what was asked, and "general" adds only general clinical knowledge, never a fact about this patient (those are the lead's).
When the page's data does not answer it, answer from general medical, hospital and everyday knowledge instead, in up to 5 short sentences, as {"general": "<text>", "evidence": <true or false>}. "evidence" is true only for a clinical question that published studies or guidelines answer (whether a treatment or test helps, a dose, a risk, a prognosis). You have not seen this hospital's other records: never state a fact about a specific patient, bed, task or number there.
In either shape, add "marks": the clinical words in your lead and in "general" a clinician's eye should land on, so they are coloured, grouped by kind, each copied exactly as you wrote it, each phrase once, as {"<kind>": ["<words>"]}. Kinds: "warning" for what must not be missed (an allergy, a critical or clearly abnormal result with its value, an emergency sign); "caution" for what is unconfirmed, pending or missing, or a value just out of range; "medicine" for each medicine, drug class or treatment; "dose" for a dose, how often, for how long or when; "condition" for each diagnosis or condition; "symptom" for each symptom or sign; "test" for a test or measurement, with its value when given. Never mark a person's name, a bed, a task or a count. The shortest phrase that carries each, at most 12 in all; {} when none fits.
Write the lead and "general" as plain sentences: no tags or markup in them; the colouring comes only from "marks".
Example: lead "Daniel Rahman has a low potassium of 3.1 mmol/L." and general "Hypokalaemia can cause arrhythmias and muscle weakness; check an ECG and give oral or IV potassium." give "marks": {"warning": ["low potassium of 3.1 mmol/L", "arrhythmias"], "condition": ["Hypokalaemia"], "symptom": ["muscle weakness"], "test": ["ECG"], "medicine": ["oral or IV potassium"]}.`;

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}+'’-]*(?:\.\d+)*/gu;
const bare = (word: string) => word.toLowerCase().replace(/['’]s$/, ""); // "Amelia's" is Amelia
// A joined word is also its parts, so "CURB-65" asked makes 65 known.
const words = (text: string) => new Set(Array.from(text.matchAll(TOKEN), m => bare(m[0])).flatMap(w => [w, ...w.split("-")]));
// A day or month passes when the data holds its short form: the record writes "Tue, 13 Oct 2026" and Gemma "Tuesday, 13 October"; "Monday" against it fails.
const CALENDAR = new Set("monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december".split(" "));
// Joining words that say nothing about what a question asks: pageLines matches a question by its other words.
const GLUE = new Set("that this these those with from have has need needs your their there they them then than which when what where while today first next last only most more less none nobody each both also still been being were will would should could about after before into over under within without soon later now here right just same other others another some any all every none none's needs".split(" "));
/**
 * What a lead claims about the hospital that the data must hold: every number, and every capitalised word (a name, a
 * bed) not opening a sentence. Clinical words are free (9 Oct: checking every word of four letters or more rejected
 * normal phrasing, 4 of 5 Today answers in e2e). Acronyms (ECG, ICU) are not names. A joined word claims what its parts
 * do ("42-year-old" is the record's age 42; 10 Oct, gate: it failed a record answer whole).
 * ponytail: a made-up first name alone at the start of a sentence passes; a full name fails on its surname.
 */
function unknownClaims(text: string, known: Set<string>) {
  return Array.from(text.matchAll(TOKEN)).filter(m => {
    const word = bare(m[0]);
    if (known.has(word) || (CALENDAR.has(word) && known.has(word.slice(0, 3)))) return false;
    const opens = /(^|[.!?]\s+)$/.test(text.slice(0, m.index));
    return word.split("-").some((part, i) => !known.has(part) && (/\d/.test(part) || (i === 0 && !opens && /^\p{Lu}\p{Ll}/u.test(m[0]))));
  }).map(m => bare(m[0]));
}

/**
 * A model's answer is sent only if it passes the ask catalogue (checkAskSpec, the app's own check) and
 * stays on the page's data: a lead and rows only (no review card, no actions, so never `task-done:`),
 * every row one of the page's rows copied as given (its op, if kept, is that row's own), and the lead
 * naming no patient or bed and no number the data lacks (a bare count up to the number of rows is allowed).
 * Its other words are the model's own, so a clinical point ("possible sepsis") reads as written.
 */
export function groundedSpec(spec: unknown, context: AskContext, question = ""): AskSpec | null {
  const valid = checkAskSpec(spec);
  if (!valid) return null;
  const rows = new Map(context.rows.map(r => [r.id, r]));
  const known = words([question, ...context.lines, ...context.rows.flatMap(r => [r.id, r.title, r.detail])].join(" "));
  const counts = (w: string) => /^\d+$/.test(w) && Number(w) <= context.rows.length;
  for (const e of Object.values(valid.elements)) {
    if (e.type === "AskLead") { if (!unknownClaims(e.props.text as string, known).every(counts)) return null; }
    else if (e.type === "AskRows") {
      for (const r of e.props.rows as AskContext["rows"]) {
        const given = rows.get(r.id);
        if (!given || r.title !== given.title || r.detail !== given.detail || r.tone !== given.tone || (r.op !== undefined && r.op !== given.op) || r.op?.startsWith("task-done:")) return null;
      }
    }
    else if (e.type !== "AskColumn") return null;
  }
  return valid;
}

/**
 * What the page itself says, as one lead: its lines (each without the question it answers, "Who needs me now? …"),
 * whole, for as many as fit in 280 characters; nothing when the page says nothing. Given a `question`, only
 * the lines and rows sharing one of its telling words (a name, a test, "potassium"), so the model being off still
 * answers "Is Daniel's potassium back?" from the page, and a question the page says nothing about gets nothing.
 */
export function pageLines(context: AskContext, question?: string) {
  const asked = question === undefined ? undefined : [...words(question)].filter(w => w.length >= 4 && !GLUE.has(w));
  const hits = (text: string) => !asked || asked.some(w => words(text).has(w));
  const rows = asked ? context.rows.filter(r => hits(`${r.title} ${r.detail}`)) : [];
  let text = "";
  for (const line of context.lines.filter(hits).map(l => l.replace(/^[^?]*\?\s+/, ""))) { if (text.length + line.length + 1 > 280) break; text += `${text ? " " : ""}${line}`; }
  if (!text && rows.length) text = "Here is what your pages show about that.";
  if (!text) return null;
  return checkAskSpec({ root: "f", elements: { f: { type: "AskColumn", props: {}, children: rows.length ? ["f-0", "f-1"] : ["f-0"] }, "f-0": { type: "AskLead", props: { text }, children: [] },
    ...rows.length > 0 && { "f-1": { type: "AskRows", props: { rows }, children: [] } } } });
}

/** General knowledge added to a page answer goes after its lead, labelled, so it is never read as the hospital's records. */
function withGeneral(spec: AskSpec, general: string): AskSpec {
  const [id, lead] = Object.entries(spec.elements).find(([, e]) => e.type === "AskLead") ?? [];
  if (!id || !lead) return spec; // ponytail: a rows-only answer drops the addition; the prompt always asks for a lead
  const text = `${lead.props.text}\n\nGeneral knowledge, not from this hospital's records: ${general}`.slice(0, LEAD_MAX);
  return { ...spec, elements: { ...spec.elements, [id]: { ...lead, props: { text } } } };
}

/**
 * Any question asked on a page, answered (the user lifted every content limit on 1 Oct). Gemma answers from the page's
 * own data first, as a checked spec (its rows, no patient, bed or number the data lacks), with any general clinical
 * knowledge it adds labelled after the lead; when the page doesn't answer it, the same call answers from general
 * knowledge as one lead, marked `general` so the app shows it is not from the records.
 */
/**
 * Gemma's reply put back in the shape it was asked for. It sometimes writes "general" (and "evidence") inside "elements"
 * as if one more element, or an element's "children" inside its "props" (10 Oct, staging: "Who needs me first?"); either
 * failed the spec's check, so a good answer was thrown away and the clinician was told the model was off. The same for a
 * column that is not one of leaves: the rows listed under the lead, an id listed twice or under itself, or a child it
 * never wrote (10 Oct, gate: "his Hb how much ah?"); each id it did write is kept once, under the root. `rows: false` (a
 * page with no rows to copy, as a visit's record is lines only) leaves out any rows it wrote from the lines; given the
 * page's row ids, a rows element none of whose rows is one of them is left out the same way (11 Oct: the web's ward
 * vitals are lines, and Gemma listed the beds she read as rows of her own, so "lowest SpO2 92%, Bed 11" was thrown away).
 * A rows element mixing the page's rows with others is kept, and groundedSpec refuses it.
 */
export function lifted<T>(reply: T, rows: boolean | Set<string> = true): T {
  const read = reply as any, inner = read?.elements;
  if (!inner || typeof inner !== "object") return reply;
  const { general, evidence, marks, ...rest } = inner;
  const elements: Record<string, any> = Object.fromEntries(Object.entries(rest).filter(([, el]: [string, any]) => el?.type !== "AskRows" || rows === true || (rows instanceof Set && !(Array.isArray(el.props?.rows) && el.props.rows.length > 0 && el.props.rows.every((r: any) => !rows.has(r?.id))))).map(([id, el]: [string, any]) => {
    if (el?.type === "AskLead" && typeof el.props?.text === "string") el = { ...el, props: { ...el.props, text: untagged(el.props.text) } };
    if (!el || typeof el !== "object" || Array.isArray(el.children) || !Array.isArray(el.props?.children)) return [id, el];
    const { children, ...props } = el.props;
    return [id, { ...el, props, children }];
  }));
  const root = elements[read.root];
  if (root && typeof root === "object") {
    const ids = [root.children, ...Object.entries(elements).map(([id, el]) => id !== read.root && el?.children)].flatMap(c => (Array.isArray(c) ? c : []));
    for (const [id, el] of Object.entries(elements)) if (id !== read.root && Array.isArray(el?.children)) elements[id] = { ...el, children: [] };
    elements[read.root] = { ...root, children: [...new Set(ids)].filter(id => id !== read.root && elements[id]) };
  }
  return { ...read, elements, general: read.general ?? general, evidence: read.evidence ?? evidence, marks: read.marks ?? marks };
}

/**
 * Gemma's words without the markup it sometimes writes into them instead of only in "marks" (10 Oct): a tag around a word
 * goes and the word stays ("<finding>pyelonephritis</finding>", "<symptom>cough<symptom>"); a tag holding its word in an
 * attribute gives that word once (`<mark text="potassium" kind="alert"/>`); words it put in angle brackets as if to
 * highlight them stay ("reconcile <medications> on admission", "<salbutamol is a"); a line break is a space. Before, only
 * the kind tags were taken out, with whatever they held, so "a low <mark text="potassium" .../> of" read "a low  of".
 * A "<" before a number or a space ("K <3.5") is not a tag and stays. Only a name then an attribute (`kind="`) is a tag
 * to drop whole: an "=" later in an unclosed fragment ("no <allergy recorded; CURB-65 = 0") is the model's own words.
 * ponytail: a "<" meaning "less than" before a word ("(<normal range)") is taken for one of Gemma's fragments and lost,
 * its words kept; none in the gate's answers.
 */
export const untagged = (text: string) => text.replace(/<(\/?)([A-Za-z][^<>]*)(>|(?=<)|$)/g, (tag, close: string, inner: string, _end: string, at: number) => {
  if (close) return "";
  // Quoted in its own quotes, so "Crohn's disease" is whole.
  const said = /\btext=(?:["“]([^"”]*)["”]|'([^']*)')/.exec(inner), word = said?.[1] ?? said?.[2];
  if (word !== undefined) return text.startsWith(word, at + tag.length) ? "" : word;
  if (/^[\w-]+\s+[\w-]+\s*=\s*["“'\w]/.test(inner)) return "";
  if (/^(br|hr)\b/i.test(inner)) return " ";
  // A bare name touching a word ("<finding>cough", "cough<finding>") wraps it; anything else is the model's own words.
  const name = /^[\w-]+\/?$/.test(inner.trim()), next = text[at + tag.length] ?? "", prev = text[at - 1] ?? "";
  return name && (/\w/.test(next) || /\w/.test(prev)) ? "" : inner.replace(/\/$/, "");
}).replace(/ {2,}/g, " ").trim();
/** The model's marks that name words really in the answer's lead (with its general part), as `{ marks }`; none when it gave none. */
function marksOf(marks: unknown, spec: AskSpec): { marks?: Mark[] } {
  const said = Object.values(spec.elements).flatMap(e => (e.type === "AskLead" ? [String(e.props.text)] : [])).join("\n");
  const kept = marksIn(marks, said);
  return kept ? { marks: kept } : {};
}

export async function freeAnswer(baseten: Baseten, input: { scope: string; question: string; context: AskContext }) {
  const { context } = input;
  const user = `Page: ${input.scope}\nQuestion: ${input.question}\n\nWhat the page says:\n${context.lines.join("\n") || "(nothing)"}\n\nThe page's rows:\n${context.rows.map(r => JSON.stringify(r)).join("\n") || "(none)"}`;
  try {
    // Through the adapter's box gate: a cold brain is woken and not waited for.
    const read = lifted(jsonIn(await boxes(baseten).chat("brain", BRAIN_MODEL, FREE, user, 1500, true)), context.rows.length > 0 && new Set(context.rows.map(r => r.id)));
    const spec = groundedSpec(read, context, input.question);
    const text = typeof read?.general === "string" ? untagged(read.general).trim().slice(0, LEAD_MAX) : "";
    if (spec) {
      const answer = text ? withGeneral(spec, text) : spec;
      return { source: "model" as const, model: BRAIN_MODEL, spec: answer, ...marksOf(read?.marks, answer) };
    }
    const general = text && checkAskSpec({ root: "f", elements: { f: { type: "AskColumn", props: {}, children: ["f-0"] }, "f-0": { type: "AskLead", props: { text }, children: [] } } });
    // `evidence`: Gemma read it as a clinical question the literature answers, so the app answers it from PubMed and the
    // library with citations (the Evidence feature) and this uncited general answer is not what the clinician is shown.
    if (general) return { source: "model" as const, model: BRAIN_MODEL, spec: general, general: true as const, ...read?.evidence === true && { evidence: true as const }, ...marksOf(read?.marks, general) };
    // Gemma answered from the page and its words did not keep to it (the check above). The page's own lines are still
    // true, so they answer, as the rules' (no model's name on them), rather than "Sona couldn't answer that".
    const said = read?.elements ? pageLines(context) : undefined;
    return { source: "fixture" as const, unanswered: true as const, ...said && { spec: said } };
  } catch { /* the box was starting or failed; it is woken for next time */ }
  return { source: "fixture" as const, ...wakingOf("brain") };
}

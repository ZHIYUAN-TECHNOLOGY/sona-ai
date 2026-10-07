import { checkAskSpec, type AskContext, type AskSpec } from "./ask-spec";
import { BOXES, BRAIN_MODEL, answered, boxes, starting, wakingOf, type Baseten } from "./baseten-models";
import { jsonIn } from "./chat-models";
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

const FREE = `You answer a hospital clinician's question asked on one page of their app. When the page's data below answers it, use only that data: never add a patient, bed, task, name, number or finding it does not state.
Answer with JSON only, in exactly this shape:
{"root":"f","elements":{"f":{"type":"AskColumn","props":{},"children":["f-0","f-1"]},"f-0":{"type":"AskLead","props":{"text":"<one short sentence that answers the question>"},"children":[]},"f-1":{"type":"AskRows","props":{"rows":[<rows>]},"children":[]}}}
Rules:
- <rows>: up to 8 of the page's rows that answer the question, most important first, each copied exactly as given (id, title, detail, tone, op). If no row answers it, leave out "f-1" and its child id.
- Write the lead in the page's own words, under 280 characters: apart from small joining words, every word and number in it must appear in the page's data or the question (a summary is the page's own lines, shortened).
- If the data does not answer the question, answer it from general medical, hospital and everyday knowledge instead, in one to three short sentences, as {"general": "<text>", "evidence": <true or false>}. "evidence" is true only for a clinical question that published studies or guidelines answer (whether a treatment or test helps, a dose, a risk, a prognosis). You have not seen this hospital's other records: never state a fact about a specific patient, bed, task or number there.`;

/** Words the lead must find in the data: a number or a capitalised word (a name, a bed) not opening a sentence. */
const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}+'’-]*(?:\.\d+)*/gu;
const bare = (word: string) => word.toLowerCase().replace(/['’]s$/, ""); // "Amelia's" is Amelia
const words = (text: string) => new Set(Array.from(text.matchAll(TOKEN), m => bare(m[0])));
// Joining words a grounded sentence may use freely; every other word of 4+ letters must come from the page or the question.
const GLUE = new Set("that this these those with from have has need needs your their there they them then than which when what where while today first next last only most more less none nobody each both also still been being were will would should could about after before into over under within without soon later now here right just same other others another some any all every none none's needs".split(" "));
function unknownWords(text: string, known: Set<string>) {
  return Array.from(text.matchAll(TOKEN)).filter(m => {
    const word = bare(m[0]);
    if (known.has(word)) return false;
    // Numbers must be in the data; so must any word long enough to carry a clinical claim (an invented "sepsis" fails), in any case.
    return /\d/.test(word) || (word.length >= 4 && !GLUE.has(word));
  }).map(m => bare(m[0]));
}

/**
 * A model's answer is sent only if it passes the ask catalogue (checkAskSpec, the app's own check) and
 * stays on the page's data: a lead and rows only (no review card, no actions, so never `task-done:`),
 * every row one of the page's rows copied as given (its op, if kept, is that row's own), and the lead
 * naming nothing and no number the data lacks (a bare count up to the number of rows is allowed).
 * Every number, and every word of four letters or more beyond a short list of joining words, must come
 * from the page's data or the question, so an invented finding ("sepsis") fails in any case.
 */
export function groundedSpec(spec: unknown, context: AskContext, question = ""): AskSpec | null {
  const valid = checkAskSpec(spec);
  if (!valid) return null;
  const rows = new Map(context.rows.map(r => [r.id, r]));
  const known = words([question, ...context.lines, ...context.rows.flatMap(r => [r.id, r.title, r.detail])].join(" "));
  const counts = (w: string) => /^\d+$/.test(w) && Number(w) <= context.rows.length;
  for (const e of Object.values(valid.elements)) {
    if (e.type === "AskLead") { if (!unknownWords(e.props.text as string, known).every(counts)) return null; }
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
 * whole, for as many as a lead holds (280 characters); nothing when the page says nothing. Given a `question`, only
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

/**
 * Any question asked on a page, answered (the user lifted every content limit on 1 Oct). Gemma answers from the page's
 * own data first, as a checked spec (its rows, every claim found in the data); when the page doesn't answer it, the same
 * call answers from general knowledge as one lead line, marked `general` so the app shows it is not from the records.
 */
export async function freeAnswer(baseten: Baseten, input: { scope: string; question: string; context: AskContext }) {
  const { context } = input;
  const user = `Page: ${input.scope}\nQuestion: ${input.question}\n\nWhat the page says:\n${context.lines.join("\n") || "(nothing)"}\n\nThe page's rows:\n${context.rows.map(r => JSON.stringify(r)).join("\n") || "(none)"}`;
  try {
    // Through the adapter's box gate: a cold brain is woken and not waited for.
    const read = jsonIn(await boxes(baseten).chat("brain", BRAIN_MODEL, FREE, user, 900));
    const spec = groundedSpec(read, context, input.question);
    if (spec) return { source: "model" as const, model: BRAIN_MODEL, spec };
    const text = typeof read?.general === "string" ? read.general.trim().slice(0, 600) : "";
    const general = text && checkAskSpec({ root: "f", elements: { f: { type: "AskColumn", props: {}, children: ["f-0"] }, "f-0": { type: "AskLead", props: { text }, children: [] } } });
    // `evidence`: Gemma read it as a clinical question the literature answers, so the app answers it from PubMed and the
    // library with citations (the Evidence feature) and this uncited general answer is not what the clinician is shown.
    if (general) return { source: "model" as const, model: BRAIN_MODEL, spec: general, general: true as const, ...read?.evidence === true && { evidence: true as const } };
    // Gemma answered from the page and its words did not keep to it (the check above). The page's own lines are still
    // true, so they answer, as the rules' (no model's name on them), rather than "Sona couldn't answer that".
    const said = read?.elements ? pageLines(context) : undefined;
    return { source: "fixture" as const, unanswered: true as const, ...said && { spec: said } };
  } catch { /* the box was starting or failed; it is woken for next time */ }
  return { source: "fixture" as const, ...wakingOf("brain") };
}

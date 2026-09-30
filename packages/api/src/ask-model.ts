import { checkAskSpec, type AskContext, type AskSpec } from "./ask-spec";
import { BOXES, BRAIN_MODEL, answered, boxes, starting, wakingOf, type Baseten } from "./baseten-models";
import { jsonIn } from "./chat-models";
import { layaEvaluator, pickCard } from "./laya";

/**
 * Sona's ask bar on the models: Laya routes a visit request to its card (ask.route), and Gemma answers a
 * page's free question from that page's own data as a spec from the ask catalogue (ask.free). Either one
 * failing, timing out or answering off the data returns `{ source: "fixture" }`, and the app keeps its
 * keyword routing or its honest "can't answer that here". A failed call wakes its box for next time, and
 * while the box is starting the fixture says in how many minutes (`waking`).
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

const FREE = `You answer a hospital clinician's question about one page of their app. Use ONLY the page's data below: never add a patient, bed, task, name, number or finding it does not state.
Answer with JSON only, in exactly this shape:
{"root":"f","elements":{"f":{"type":"AskColumn","props":{},"children":["f-0","f-1"]},"f-0":{"type":"AskLead","props":{"text":"<one short sentence that answers the question>"},"children":[]},"f-1":{"type":"AskRows","props":{"rows":[<rows>]},"children":[]}}}
Rules:
- <rows>: up to 8 of the page's rows that answer the question, most important first, each copied exactly as given (id, title, detail, tone, op). If no row answers it, leave out "f-1" and its child id.
- If the data does not answer the question, answer {"unanswered": true}.`;

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

/** A page's free question, answered by Gemma from the page's data only, as a checked spec. */
export async function freeAnswer(baseten: Baseten, input: { scope: string; question: string; context: AskContext }) {
  const { context } = input;
  const user = `Page: ${input.scope}\nQuestion: ${input.question}\n\nWhat the page says:\n${context.lines.join("\n") || "(nothing)"}\n\nThe page's rows:\n${context.rows.map(r => JSON.stringify(r)).join("\n") || "(none)"}`;
  try {
    // Through the adapter's box gate: a cold brain is woken and not waited for.
    const spec = groundedSpec(jsonIn(await boxes(baseten).chat("brain", BRAIN_MODEL, FREE, user, 900)), context, input.question);
    if (spec) return { source: "model" as const, model: BRAIN_MODEL, spec };
  } catch { /* the box was starting or failed; it is woken for next time */ }
  return { source: "fixture" as const, ...wakingOf("brain") };
}

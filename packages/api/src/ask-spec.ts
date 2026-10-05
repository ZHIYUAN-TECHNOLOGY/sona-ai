import { z } from "zod";

/**
 * The ask catalogue's parts (docs/design-direction.md, Sona on every page), shared by the app, which
 * renders them (apps/native/features/ask/catalog.ts), and the server, which checks a model's answer
 * against the same schemas before it is sent (ask.free). Pure zod, no json-render, so both can import it.
 * Actions are op strings the app owns and checks (`runOp`), never code.
 */
export const askTone = z.enum(["urgent", "soon", "good", "calm"]);
export const askOp = z.string().regex(/^(open|go|tab|task-done):[\w\-/:.]+$/);
export const askRow = z.object({ id: z.string().max(64), title: z.string().max(120), detail: z.string().max(160), tone: askTone, op: askOp.optional() }).strict();
export const ASK_PROPS = {
  AskColumn: z.object({}).strict(),
  AskLead: z.object({ text: z.string().min(1).max(280) }).strict(),
  AskRows: z.object({ rows: z.array(askRow).max(12) }).strict(),
  AskReview: z.object({ title: z.string().max(160), items: z.array(z.string().max(160)).max(6), what: z.string().max(200), confirm: z.string().max(40), done: z.string().max(160), op: askOp }).strict(),
  AskActions: z.object({ items: z.array(z.object({ label: z.string().max(40), op: askOp, primary: z.boolean().optional() }).strict()).max(3) }).strict(),
};

type AskElement = { type: string; props: Record<string, unknown>; children?: string[]; on?: unknown; visible?: unknown; repeat?: unknown };
export type AskSpec = { root: string; elements: Record<string, AskElement> };
const specShape = z.object({ root: z.string(), elements: z.record(z.string(), z.looseObject({ type: z.string(), props: z.record(z.string(), z.unknown()), children: z.array(z.string()).optional() })) });

const MAX_ROWS = 12;
/**
 * A spec is shown only if it is a column of leaves, every element passes its own part's schema, and it stays small.
 * A list longer than an answer may show is cut to its first 12 rows here, for every spec whoever wrote it (a rule or
 * the model), rather than failing the whole answer: each answer ranks its rows, so those are the ones that matter.
 */
export function checkAskSpec(spec: unknown): AskSpec | null {
  const parsed = specShape.safeParse(spec);
  if (!parsed.success) return null;
  const value = parsed.data as AskSpec;
  for (const [id, e] of Object.entries(value.elements)) if (e.type === "AskRows" && Array.isArray(e.props.rows) && e.props.rows.length > MAX_ROWS) value.elements[id] = { ...e, props: { ...e.props, rows: e.props.rows.slice(0, MAX_ROWS) } };
  const root = value.elements[value.root];
  const children = root?.children ?? [];
  if (!root || root.type !== "AskColumn" || !children.length || Object.keys(value.elements).length > 12) return null;
  const known = (e: AskElement) => e.type in ASK_PROPS && ASK_PROPS[e.type as keyof typeof ASK_PROPS].safeParse(e.props).success && !e.on && !e.visible && !e.repeat;
  if (!Object.values(value.elements).every(known)) return null;
  return children.every(id => value.elements[id] && !(value.elements[id]!.children?.length)) ? value : null;
}

/**
 * What a page already shows, sent with a free question so the model answers only from it: what each of
 * the page's answers says (`lines`) and their rows, with the ids and ops a free answer may reuse.
 */
export const askContextSchema = z.object({
  lines: z.array(z.string().max(300)).max(20),
  rows: z.array(askRow).max(40),
});
export type AskContext = z.infer<typeof askContextSchema>;

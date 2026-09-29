import { defineCatalog, type Spec } from "@json-render/core";
import { schema } from "@json-render/react-native/schema";
import { z } from "zod";

/**
 * The parts a Sona answer on a page is built from (docs/design-direction.md, Sona on every page).
 * Today the app's own rules fill them from its data; later Laya picks among the same parts and the
 * model fills the words. Actions are op strings the app owns and checks (`runOp`), never code.
 */
const tone = z.enum(["urgent", "soon", "good", "calm"]);
const op = z.string().regex(/^(open|go|tab|task-done):[\w\-/:.]+$/);
const PROPS = {
  AskColumn: z.object({}).strict(),
  AskLead: z.object({ text: z.string().min(1).max(280) }).strict(),
  AskRows: z.object({ rows: z.array(z.object({ id: z.string().max(64), title: z.string().max(120), detail: z.string().max(160), tone, op: op.optional() }).strict()).max(12) }).strict(),
  AskReview: z.object({ title: z.string().max(160), items: z.array(z.string().max(160)).max(6), what: z.string().max(200), confirm: z.string().max(40), done: z.string().max(160), op }).strict(),
  AskActions: z.object({ items: z.array(z.object({ label: z.string().max(40), op, primary: z.boolean().optional() }).strict()).max(3) }).strict(),
};
export const askCatalog = defineCatalog(schema, {
  actions: {},
  components: {
    AskColumn: { props: PROPS.AskColumn, slots: ["default"], description: "The answer, top to bottom." },
    AskLead: { props: PROPS.AskLead, description: "One sentence: where things stand." },
    AskRows: { props: PROPS.AskRows, description: "Ranked rows, each with its reason and an optional action." },
    AskReview: { props: PROPS.AskReview, description: "A consequential action shown before it runs, then its receipt." },
    AskActions: { props: PROPS.AskActions, description: "Up to three next steps." },
  },
});

/** A spec is shown only if it passes the catalogue, is a column of leaves, and stays small. */
export function validateAskSpec(spec: unknown): Spec | null {
  const parsed = askCatalog.validate(spec);
  if (!parsed.success || !parsed.data) return null;
  const value = parsed.data as Spec;
  const root = value.elements[value.root];
  const children = root?.children ?? [];
  if (!root || root.type !== "AskColumn" || !children.length || Object.keys(value.elements).length > 12) return null;
  // The catalogue check alone lets unknown types and props through, so every element is checked against its own schema too.
  const known = (e: Spec["elements"][string]) => e.type in PROPS && PROPS[e.type as keyof typeof PROPS].safeParse(e.props).success && !e.on && !e.visible && !e.repeat;
  if (!Object.values(value.elements).every(known)) return null;
  return children.every(id => value.elements[id] && !(value.elements[id]!.children?.length)) ? value : null;
}

import { defineCatalog, type Spec } from "@json-render/core";
import { schema } from "@json-render/react-native/schema";
import { ASK_PROPS as PROPS, checkAskSpec } from "@sona-ai/api/ask-spec";

/**
 * The parts a Sona answer on a page is built from (docs/design-direction.md, Sona on every page).
 * The app's own rules fill them from its data; a free question's answer (ask.free) is built by the
 * model from the same parts, checked on the server with the same schemas (@sona-ai/api/ask-spec).
 * Actions are op strings the app owns and checks (`runOp`), never code.
 */
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

/** A spec is shown only if it passes the catalogue and the shared checks (a column of leaves, each part's own schema, small). */
export function validateAskSpec(spec: unknown): Spec | null {
  const parsed = askCatalog.validate(spec);
  // The catalogue check alone lets unknown types and props through, so checkAskSpec checks every element against its own schema too.
  return parsed.success && parsed.data && checkAskSpec(parsed.data) ? parsed.data as Spec : null;
}

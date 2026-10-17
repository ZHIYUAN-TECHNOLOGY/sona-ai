// Dev only. Typed helper for worst-case fixtures; see apps/web/README.md "Worst-case data".
import type { Client } from "@orpc/client";
import type { AppRouterClient } from "@sona-ai/api/routers/index";

export const MODES = ["worst", "empty", "one", "huge"] as const;
export type Mode = (typeof MODES)[number];

// Every procedure of the router as { path: "care.results.list", input, output }.
type Procedures<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends Client<any, infer I, infer O, any>
    ? { path: `${P}${K}`; input: I; output: O }
    : Procedures<T[K], `${P}${K}.`>;
}[keyof T & string];
type Procedure = Procedures<AppRouterClient>;
export type ProcedurePath = Procedure["path"];
type Of<P extends ProcedurePath> = Extract<Procedure, { path: P }>;

/** A value, or a function of the call's input (async to take as long as the model would), per mode. A missing mode falls back to `worst`. */
export type Fixture<P extends ProcedurePath> = Partial<Record<Mode, Of<P>["output"] | ((input: Of<P>["input"]) => Of<P>["output"] | Promise<Of<P>["output"]>)>>;

/** `fixture("care.me", { worst: {...} })`: checks the values against the procedure's output type. */
export function fixture<P extends ProcedurePath>(path: P, modes: Fixture<P>) {
  return { path, modes: modes as Partial<Record<Mode, unknown>> };
}

export type Registered = ReturnType<typeof fixture>;

/** n rows from a builder, for the `huge` (1,000 rows) state. */
export const rows = <T,>(n: number, row: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => row(i));

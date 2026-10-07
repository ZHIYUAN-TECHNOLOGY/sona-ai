// Dev only: loaded by lib/orpc.ts behind import.meta.env.DEV, so production builds never contain it.
import { TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL } from "@orpc/tanstack-query";

import { type Mode, MODES, type Registered } from "./fixture";

// Each pro-*.ts / care-*.ts file default-exports an array of fixture(...) entries; add a file, no edit here.
// The *-session.ts seeds load first, so a page's own file replaces a seed it also registers.
const files = Object.entries(import.meta.glob<{ default: Registered[] }>(["./pro-*.ts", "./care-*.ts"], { eager: true }))
  .sort(([a], [b]) => Number(b.endsWith("-session.ts")) - Number(a.endsWith("-session.ts")));

export const fixtures: Record<string, Registered["modes"]> = {};
const from: Record<string, string> = {};
for (const [file, { default: entries }] of files) {
  for (const { path, modes } of entries) {
    if (from[path] && !from[path].endsWith("-session.ts")) console.warn(`[worst-case] ${path} is in ${from[path]} and ${file}; ${file} wins`);
    fixtures[path] = modes;
    from[path] = file;
  }
}

export function dataMode(): Mode | null {
  const mode = new URLSearchParams(window.location.search).get("data");
  return (MODES as readonly string[]).includes(mode ?? "") ? (mode as Mode) : null;
}

/** Answers a call from its fixture in a data mode; anything unregistered goes to the network. */
export async function answer(path: readonly string[], input: unknown, context: unknown, network: () => Promise<unknown>) {
  const mode = dataMode();
  if (!mode) return network();
  const modes = fixtures[path.join(".")];
  const value = modes?.[mode] ?? modes?.worst;
  if (value !== undefined) return typeof value === "function" ? value(input) : structuredClone(value);
  // A write with no fixture succeeds without touching the server.
  const operation = (context as Record<symbol, { type?: string } | undefined> | undefined)?.[TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL];
  if (operation?.type === "mutation") return {};
  return network();
}

/**
 * Critical results (after Qure's qER pattern): a value past the lab's call-now limit reaches the
 * on-call doctor at once, with a clock running until someone acknowledges it.
 *
 * ponytail: typical adult critical limits as data for the demo; a hospital's own lab policy replaces these rows.
 */
const LIMITS: { test: RegExp; unit: string; low?: number; high?: number }[] = [
  { test: /^potassium$|^k\+?$/i, unit: "mmol/L", low: 3.0, high: 6.0 },
  { test: /^sodium$|^na\+?$/i, unit: "mmol/L", low: 120, high: 160 },
  { test: /^(hb|haemoglobin|hemoglobin)$/i, unit: "g/dL", low: 7 },
  { test: /^glucose$/i, unit: "mmol/L", low: 2.5, high: 25 },
];

export type CriticalFlag = "critical low" | "critical high";

/** "critical low" or "critical high" past a call-now limit; undefined for anything else, including other units. */
export function criticalOf(r: { test: string; value: string; unit?: string | null }): CriticalFlag | undefined {
  const limit = LIMITS.find(l => l.test.test(r.test.trim()) && l.unit === r.unit);
  const v = Number(r.value);
  if (!limit || !Number.isFinite(v) || r.value.trim() === "") return undefined;
  if (limit.low !== undefined && v < limit.low) return "critical low";
  if (limit.high !== undefined && v > limit.high) return "critical high";
  return undefined;
}

/** Why the rule calls a result critical, naming the limit it crossed ("Potassium 6.8 mmol/L is above the call-now limit of 6 mmol/L"); undefined when the rule does not. */
export function criticalWhy(r: { test: string; value: string; unit?: string | null }): string | undefined {
  const flag = criticalOf(r);
  const limit = LIMITS.find(l => l.test.test(r.test.trim()) && l.unit === r.unit);
  if (!flag || !limit) return undefined;
  const [side, bound] = flag === "critical low" ? ["below", limit.low] : ["above", limit.high];
  return `${r.test.trim()} ${r.value.trim()} ${limit.unit} is ${side} the call-now limit of ${bound} ${limit.unit}`;
}

/** Minutes and seconds from `from` to `to`, like a stopwatch ("3:07"). */
export function elapsed(from: Date, to: Date) {
  const s = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

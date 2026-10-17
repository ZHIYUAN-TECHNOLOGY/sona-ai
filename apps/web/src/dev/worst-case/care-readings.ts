import { fixture, rows } from "./fixture";

// Sona Care Readings: care.readings.list keeps 90 days at most; the number of readings in them is unbounded.
const DAY = 86_400_000, NOW = Date.now();
const KINDS = {
  blood_pressure: { label: "Blood pressure", unit: "mmHg" },
  heart_rate: { label: "Heart rate", unit: "bpm" },
  temperature: { label: "Temperature", unit: "°C" },
  weight: { label: "Weight", unit: "kg" },
  blood_glucose: { label: "Blood glucose", unit: "mmol/L" },
  oxygen_saturation: { label: "Oxygen saturation", unit: "%" },
} as const;
type Kind = keyof typeof KINDS;
type Point = { id: string; at: Date; value: number; value2?: number };

/** n readings of one kind spread over `span` days, newest now; two on a day share it (morning and evening). */
const series = (kind: Kind, n: number, span: number, value: (i: number) => number, value2?: (i: number) => number) => ({
  kind, ...KINDS[kind],
  points: rows(n, (i): Point => ({ id: `${kind}-${i}`, at: new Date(NOW - span * DAY + (i * span * DAY) / Math.max(n - 1, 1) - 60_000), value: value(i), ...(value2 ? { value2: value2(i) } : {}) })),
});
const wave = (i: number, base: number, swing: number) => Math.round(base + swing * Math.sin(i / 3) + (i % 5) - 2);

// 120 in 90 days: twice-daily blood pressure for the last month, the rest scattered; extremes a real device shows.
const WORST = [
  series("blood_pressure", 60, 30, i => (i === 59 ? 186 : wave(i, 150, 22)), i => (i === 59 ? 112 : wave(i, 92, 12))),
  series("weight", 30, 89, i => Math.round((132.4 - i * 0.15) * 10) / 10),
  series("blood_glucose", 20, 60, i => Math.round((8 + 14.8 * Math.abs(Math.sin(i))) * 10) / 10),
  series("oxygen_saturation", 6, 12, i => 88 + i),
  series("heart_rate", 3, 20, i => [142, 98, 61][i]!),
  series("temperature", 1, 0.2, () => 39.4),
];

const list = (s: ReturnType<typeof series>[]) => (input?: { days?: number }) => ({ days: input?.days ?? 7, series: s });

export default [
  fixture("care.readings.list", {
    worst: list(WORST),
    empty: list([]),
    one: list([series("weight", 1, 0.1, () => 64.5)]),
    huge: list([series("blood_pressure", 540, 90, i => wave(i, 140, 25), i => wave(i, 88, 12)), series("blood_glucose", 540, 90, i => 6 + (i % 9))]),
  }),
];

/**
 * Usual adult ranges for common tests, so a result the lab sent without its own flag still reads high or low.
 * Only compared when the unit is the row's unit: another unit leaves the result unflagged rather than guessed.
 *
 * ponytail: typical adult ranges as data; a hospital's own lab reference intervals (by age and sex) replace these rows.
 * Plain "glucose" is left out on purpose: without knowing it was fasting, a fasting range would flag every meal.
 */
type Row = { names: string[]; unit: string; low?: number; high?: number; female?: [number, number]; male?: [number, number] };

const RANGES: Row[] = [
  { names: ["crp", "c-reactive protein", "c reactive protein"], unit: "mg/l", high: 5 },
  { names: ["wbc", "wcc", "white cell count", "white blood cell count", "white blood cells", "total white cell count"], unit: "10^9/l", low: 4, high: 11 },
  { names: ["hb", "hgb", "haemoglobin", "hemoglobin"], unit: "g/dl", low: 12, high: 17.5, female: [12, 15.5], male: [13.5, 17.5] },
  { names: ["plt", "platelets", "platelet count"], unit: "10^9/l", low: 150, high: 400 },
  { names: ["sodium", "na", "na+"], unit: "mmol/l", low: 135, high: 145 },
  { names: ["potassium", "k", "k+"], unit: "mmol/l", low: 3.5, high: 5.1 },
  { names: ["creatinine", "creat", "cr"], unit: "umol/l", low: 45, high: 110 },
  { names: ["creatinine", "creat", "cr"], unit: "mg/dl", low: 0.5, high: 1.2 },
  { names: ["urea"], unit: "mmol/l", low: 2.5, high: 7.8 },
  { names: ["fasting glucose", "glucose fasting", "glucose (fasting)", "fasting blood glucose", "fasting plasma glucose", "fbg", "fpg", "fbs"], unit: "mmol/l", low: 3.9, high: 5.5 },
  // 6.5 % (48 mmol/mol) and over reads as diabetes, so the usual range stops just below it.
  { names: ["hba1c", "a1c", "haemoglobin a1c", "hemoglobin a1c"], unit: "%", high: 6.4 },
  { names: ["hba1c", "a1c", "haemoglobin a1c", "hemoglobin a1c"], unit: "mmol/mol", high: 47 },
  { names: ["alt", "sgpt", "alanine aminotransferase", "alanine transaminase"], unit: "u/l", high: 40 },
  { names: ["procalcitonin", "pct"], unit: "ng/ml", high: 0.5 },
  { names: ["procalcitonin", "pct"], unit: "ug/l", high: 0.5 },
];

export type RangeFlag = "high" | "low";
type Result = { test: string; value: string; unit?: string | null; sex?: string | null };

const nameOf = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
// "x10^9/L", "×10⁹/L", "10*9/L", "µmol/L", "IU/L" all land on one spelling.
const unitOf = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/^[x×]/, "").replace(/10(\*|e|⁹)9?/, "10^9").replace(/[µμ]/g, "u").replace(/^iu\//, "u/");

function rangeOf(r: Result): { low?: number; high?: number; unit: string } | undefined {
  if (!r.unit) return undefined;
  const row = RANGES.find(x => x.names.includes(nameOf(r.test)) && x.unit === unitOf(r.unit!));
  if (!row) return undefined;
  const sexed = /^f/i.test(r.sex ?? "") ? row.female : /^m/i.test(r.sex ?? "") ? row.male : undefined;
  return { low: sexed?.[0] ?? row.low, high: sexed?.[1] ?? row.high, unit: r.unit.trim() };
}

/** "high" or "low" against the usual adult range; undefined in range, for an unknown test, another unit or a value that is not a plain number. */
export function rangeFlagOf(r: Result): RangeFlag | undefined {
  const range = rangeOf(r);
  if (!range || !/^-?\d+(\.\d+)?$/.test(r.value.trim())) return undefined;
  const v = Number(r.value);
  if (range.low !== undefined && v < range.low) return "low";
  if (range.high !== undefined && v > range.high) return "high";
  return undefined;
}

/** Why the result reads high or low ("CRP 86 mg/L is above the usual adult range of up to 5 mg/L"); undefined when it does not. */
export function rangeWhy(r: Result): string | undefined {
  const flag = rangeFlagOf(r);
  const range = rangeOf(r);
  if (!flag || !range) return undefined;
  const span = range.low === undefined ? `up to ${range.high}` : range.high === undefined ? `${range.low} or more` : `${range.low} to ${range.high}`;
  return `${r.test.trim()} ${r.value.trim()} ${range.unit} is ${flag === "high" ? "above" : "below"} the usual adult range of ${span} ${range.unit}`;
}

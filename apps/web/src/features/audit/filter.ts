/** Rows whose given text fields contain every word of the search, in any order and case. */
export function matching<T>(rows: T[], q: string, text: (row: T) => string[]): T[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter(r => { const hay = text(r).join(" ").toLowerCase(); return words.every(w => hay.includes(w)); });
}

/** Ringgit from cents, without the unit: 63000 is "630", and sen always take two places: 128456050 is "1,284,560.50". */
export const ringgit = (cents: number) => (cents / 100).toLocaleString("en-MY", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });

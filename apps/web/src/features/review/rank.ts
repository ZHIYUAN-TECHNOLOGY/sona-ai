/** Flagged items first; the rest keep their order (the sort is stable). */
export const flaggedFirst = <T extends { failing: readonly unknown[] }>(entries: readonly T[]): T[] =>
  [...entries].sort((a, b) => Number(b.failing.length > 0) - Number(a.failing.length > 0));

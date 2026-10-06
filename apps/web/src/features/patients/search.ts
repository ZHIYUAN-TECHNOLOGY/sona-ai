type Searchable = { id: string; name: string; subtitle?: string; complaint?: string };

/** Rows whose name, ID, place or complaint contains every word typed (any case). An empty search keeps all. */
export function filterPatients<T extends Searchable>(rows: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const text = `${r.name} ${r.id} ${r.subtitle ?? ""} ${r.complaint ?? ""}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

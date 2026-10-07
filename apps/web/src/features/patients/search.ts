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

type Rankable = { incomplete?: boolean | null; ward?: { status?: string | null; waitingHours?: number | null } | null };
const NEEDS_FIRST = ["watch", "fit"];

/** Who needs the doctor first: on watch, then fit to go, then an incomplete record, then the rest. The longest wait leads within a group; otherwise the given order holds. */
export function rankPatients<T extends Rankable>(rows: T[]): T[] {
  const need = (r: T) => {
    const i = NEEDS_FIRST.indexOf(r.ward?.status ?? "");
    return i >= 0 ? i : r.incomplete ? 2 : 3;
  };
  return [...rows].sort((a, b) => need(a) - need(b) || (b.ward?.waitingHours ?? 0) - (a.ward?.waitingHours ?? 0));
}

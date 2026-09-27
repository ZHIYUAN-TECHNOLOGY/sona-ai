import { clock, type DayDose } from "./model";

export type StripChip = { key: string; label: string; state: "did" | "now" | "later" };

/**
 * The dose screen's today strip: one capsule per time, doses at the same time and state sharing it
 * ("✓ 8 AM · Azithromycin, Cetirizine"). `current` is the dose on screen, drawn in ink.
 */
export function strip(doses: DayDose[], current?: string): StripChip[] {
  const chips: (StripChip & { at: number; names: string[] })[] = [];
  for (const d of doses) {
    const state = d.taken ? "did" : d.key === current ? "now" : "later", at = d.dueAt.getTime(), last = chips.at(-1);
    if (last && last.at === at && last.state === state) last.names.push(d.name);
    else chips.push({ key: d.key, label: "", state, at, names: [d.name] });
  }
  return chips.map(({ key, state, at, names }) => ({ key, state, label: `${state === "did" ? "✓ " : ""}${clock(new Date(at)).replace(":00", "")} · ${names.join(", ")}` }));
}

/** "before" or "after" when the take line says so ("1 tablet after food"); "with or without food" says neither. */
export const foodOf = (line: string) => /\b(before|after) (food|meals?)\b/i.exec(line)?.[1]?.toLowerCase() as "before" | "after" | undefined;

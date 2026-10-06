export const SECTIONS = [["history", "History"], ["examination", "Examination"], ["assessment", "Assessment"], ["plan", "Plan"]] as const;
export type SectionKey = (typeof SECTIONS)[number][0];
type Change = "new" | "changed" | "stopped" | "continue";
type Medicine = { name: string; dose?: string; frequency?: string; change: Change; confidence: "high" | "low" };
type Task = { title: string; due?: string; owner?: string };
export type Reading = { sections: Record<SectionKey, string>; medicines: Medicine[]; tasks: Task[]; followUp?: { in: string } };

type Item = { on: boolean; text: string };
/** The reader's proposal as the doctor is reviewing it: every item ticked or not, and editable. */
export type Draft = { sections: Record<SectionKey, Item>; medicines: (Medicine & { on: boolean })[]; tasks: (Task & { on: boolean })[]; followUp?: Item };

/** Everything the reader found starts ticked; medicines that only continue change nothing, so they are left out. */
export function draftOf(reading: Reading): Draft {
  return {
    sections: Object.fromEntries(SECTIONS.map(([key]) => [key, { on: Boolean(reading.sections[key]?.trim()), text: reading.sections[key] ?? "" }])) as Draft["sections"],
    medicines: reading.medicines.filter(m => m.change !== "continue").map(m => ({ ...m, on: true })),
    tasks: reading.tasks.map(t => ({ ...t, on: true })),
    followUp: reading.followUp ? { on: true, text: reading.followUp.in } : undefined,
  };
}

/** Only ticked items that still have words in them: what `scan.apply` receives. */
export function kept(draft: Draft) {
  const followUp = draft.followUp?.on && draft.followUp.text.trim() ? { in: draft.followUp.text.trim() } : undefined;
  return {
    sections: Object.fromEntries(SECTIONS.flatMap(([key]) => draft.sections[key].on && draft.sections[key].text.trim() ? [[key, draft.sections[key].text.trim()]] : [])) as Partial<Record<SectionKey, string>>,
    medicines: draft.medicines.filter(m => m.on && m.name.trim()).map(({ on: _, ...m }) => m),
    tasks: draft.tasks.filter(t => t.on && t.title.trim()).map(({ on: _, ...t }) => t),
    ...followUp && { followUp },
  };
}

export function checkedCount(draft: Draft) {
  const k = kept(draft);
  return Object.keys(k.sections).length + k.medicines.length + k.tasks.length + (k.followUp ? 1 : 0);
}

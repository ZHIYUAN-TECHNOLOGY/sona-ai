import type { Capability } from "./types";

/** One need: what it is, its meaning colour, and the one action that meets it. */
export type Need = { tone: "urgent" | "caution" | "calm"; text: string; action: string; target: string };

/**
 * What ends a visit's thread: exactly one next step, then at most two quiet questions. The floating
 * next-step bar owns the step while medicines or prescribing are open; otherwise the visit's own need
 * leads (the same line the visit opens with), and once nothing is left it is handing over. Evidence
 * answers keep their own Related questions, so nothing is added under them. A need met by the answer just
 * shown (a new result in the briefing) is left to that answer.
 */
export function threadEnd({ latest, need, hasSteps, firstName, discharged, follow }: { latest: Capability; need?: Need; hasSteps: boolean; firstName: string; discharged: boolean; follow: Capability[] }): { need?: Need; ask: Capability[] } {
  // A need that points at the answer just shown is already on screen with its action (the briefing's
  // Acknowledge), so asking for it again would loop; the questions still follow.
  if (need?.target === latest) return { ask: latest === "evidence" ? [] : follow.filter(k => k !== latest).slice(0, 2) };
  const next = hasSteps ? undefined : need ?? { tone: "calm", text: discharged ? `${firstName} is discharged · hand over when you’re done` : `Nothing else needs ${firstName} now`, action: "Hand over", target: "handover" };
  const ask = latest === "evidence" ? [] : follow.filter(k => k !== next?.target && k !== latest).slice(0, 2);
  return { need: next, ask };
}

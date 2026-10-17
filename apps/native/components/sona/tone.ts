/**
 * One colour mapping everywhere (docs/design-direction.md, "Highlight what matters"): red must not miss
 * (urgent), amber soon or blocked (soon; "caution" is the same amber), blue the one next step, green
 * done or safe, and neutral for everything else. A set of items (an insight, a bed's header, a group)
 * takes the colour of its most urgent item, so "2 need you" is amber over two amber flags and red only when one is red.
 */
const RANK = ["urgent", "soon", "caution", "next", "good"];

/** The most urgent tone among the items; "calm" when none carries a meaning. */
export function mostUrgent<T extends string>(tones: readonly (T | undefined)[]): T | "calm" {
  let best: T | undefined, at = RANK.length;
  for (const t of tones) { const i = t ? RANK.indexOf(t) : -1; if (i >= 0 && i < at) { best = t; at = i; } }
  return best ?? "calm";
}

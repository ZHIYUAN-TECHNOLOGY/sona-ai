/** What the composer is doing, as the living edge sees it. */
export type RingState = { focused: boolean; near: boolean; working: boolean; recording: boolean; reduced: boolean };
/** How the edge looks: `glow` 0 to 1, `speed` radians a second around the ring, `pulse` 1 to follow the voice. */
export type Ring = { glow: number; speed: number; pulse: number; animate: boolean };

/**
 * The edge rests dim and still; it brightens when the pointer comes near or the box is focused, flows around the ring
 * while Sona works, and pulses with the voice while recording. It only animates in those states, and never with
 * Reduce Motion (it still brightens, one frame at a time).
 */
export function ringTarget(s: RingState): Ring {
  const glow = s.recording ? 1 : s.working ? 0.85 : s.focused ? 0.7 : s.near ? 0.45 : 0.2;
  const speed = s.working ? 2.4 : s.recording ? 0.7 : s.focused || s.near ? 0.35 : 0;
  return { glow, speed, pulse: s.recording ? 1 : 0, animate: !s.reduced && (s.focused || s.near || s.working || s.recording) };
}

/** The textarea's height for its content: at least one line, at most `lines` lines, scrolling past that. */
export function fitHeight(scrollHeight: number, line: number, padding: number, lines = 6) {
  const max = line * lines + padding;
  return { height: Math.min(Math.max(scrollHeight, line + padding), max), scrolls: scrollHeight > max };
}

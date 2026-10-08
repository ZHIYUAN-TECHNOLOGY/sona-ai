/** What the composer is doing, as the living edge sees it. */
export type RingState = { focused: boolean; near: boolean; working: boolean; recording: boolean; reduced: boolean };
/** How the glass rim looks: `glow` 0 to 1, `flow` 1 for the working wave, `beat` 1 for the listening heartbeat. */
export type Ring = { glow: number; flow: number; beat: number; animate: boolean };

/**
 * The rim rests as clear glass, still; it brightens when the pointer comes near or the box is focused, a gentle wave
 * flows around it while Sona works, and it beats while listening. Only work and the voice keep it moving (focus sends
 * one ripple, see `ripple`), and never with Reduce Motion (it still brightens, one frame at a time).
 */
export function ringTarget(s: RingState): Ring {
  const glow = s.recording ? 1 : s.working ? 0.8 : s.focused ? 0.6 : s.near ? 0.35 : 0;
  return { glow, flow: s.working && !s.recording ? 1 : 0, beat: s.recording ? 1 : 0, animate: !s.reduced && (s.working || s.recording) };
}

/** Seconds the focus ripple takes to travel round the rim and settle. */
export const RIPPLE_S = 2.2;
/** The focus ripple `t` seconds after focus: where its band is (laps round the rim, easing out) and how bright; null once settled. */
export function ripple(t: number) {
  if (t < 0 || t >= RIPPLE_S) return null;
  const x = t / RIPPLE_S;
  return { at: 1.25 * (1 - (1 - x) ** 2), amp: Math.sin(Math.PI * x) };
}

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
/** One beat's swell `u` seconds after it starts: up in 50 ms, gone by ~300 ms. The shader in composer-ring.tsx mirrors it. */
const pulse = (u: number) => (u < 0 ? 0 : (u / 0.05) * Math.exp(1 - u / 0.05));
/** Seconds between the lub and the dub. */
export const BEAT_GAP = 0.18;
/** A calm 1.4 s beat when the voice is silent, quickening to 1 s as it gets louder. */
export const beatPeriod = (level: number) => 1.4 - 0.4 * clamp01(level);
/** How strongly the rim beats for a voice level: a calm third when silent, full when loud. */
export const beatStrength = (level: number) => 0.35 + 0.65 * clamp01(level);
/** The heartbeat envelope `t` seconds into the listening, 0 to 1: a lub-dub double pulse, then rest. */
export function heartbeat(t: number, level: number) {
  const p = beatPeriod(level), x = ((t % p) + p) % p;
  return beatStrength(level) * Math.min(1, pulse(x) + 0.7 * pulse(x - BEAT_GAP));
}

/** The textarea's height for its content: at least one line, at most `lines` lines, scrolling past that. */
export function fitHeight(scrollHeight: number, line: number, padding: number, lines = 6) {
  const max = line * lines + padding;
  return { height: Math.min(Math.max(scrollHeight, line + padding), max), scrolls: scrollHeight > max };
}

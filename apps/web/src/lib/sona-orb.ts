// The Sona orb's states and motion, without the DOM (components/sona-orb.tsx draws them). After the iPhone's Aurora
// core orb (apps/native/components/sona/glass-orb.tsx): at rest the aurora holds still and nothing is drawn.

/**
 * rest: one still frame. hover: the aurora wakes and curls. listening: it rises and brightens with a blue glow (the
 * orb grows to 1.12). thinking: it circles. answered: one bright bloom.
 */
export type OrbState = "rest" | "hover" | "listening" | "thinking" | "answered";

/** How long an answer that arrived while the panel was closed blooms (and shows ✓) before the orb rests with a dot. */
export const BLOOM_MS = 1200;

/**
 * The orb's state from the provider's: a fresh answer blooms first, then a pending answer while the panel is closed
 * thinks, then hover or keyboard focus wakes it.
 */
export function orbState({ closed, pending, blooming, hover }: { closed: boolean; pending: boolean; blooming: boolean; hover: boolean }): OrbState {
  if (blooming) return "answered";
  if (closed && pending) return "thinking";
  return hover ? "hover" : "rest";
}

/** The Sona panel's own orb (its header): listening while the mic is open, thinking while Sona reads it or answers. */
export function markState({ voice, pending }: { voice: "idle" | "listening" | "transcribing"; pending: boolean }): OrbState {
  if (voice === "listening") return "listening";
  return voice === "transcribing" || pending ? "thinking" : "rest";
}

/**
 * What the shader is given: `energy` raises and brightens the aurora, `speed` is how fast its folds move, `spin` how
 * fast it circles the glass (radians a second), `bloom` the answered flash and its blue glow.
 */
export type Look = { energy: number; speed: number; spin: number; bloom: number };
export const LOOK: Record<OrbState, Look> = {
  rest: { energy: 0, speed: 0, spin: 0, bloom: 0 },
  hover: { energy: 0.55, speed: 1.4, spin: 0.25, bloom: 0 },
  listening: { energy: 1, speed: 1.7, spin: 0.3, bloom: 0.4 },
  thinking: { energy: 0.7, speed: 1.8, spin: 1.6, bloom: 0.15 },
  answered: { energy: 1, speed: 1.6, spin: 0.5, bloom: 1 },
};

const KEYS = ["energy", "speed", "spin", "bloom"] as const;
/** Per second: the look follows a new state within about 0.6 s, as on the phone. */
const EASE = 5;
const NEAR = 0.002;

/** One frame of easing from `now` towards `target` over `dt` seconds; within a hair it lands exactly on the target. */
export function step(now: Look, target: Look, dt: number): Look {
  const k = 1 - Math.exp(-EASE * dt);
  const next = { ...now };
  for (const key of KEYS) {
    const v = now[key] + (target[key] - now[key]) * k;
    next[key] = Math.abs(target[key] - v) < NEAR ? target[key] : v;
  }
  return next;
}

/** Whether another frame is needed: the target moves (anything but rest), or the look has not yet landed on it. */
export const moving = (now: Look, target: Look) => target.speed > 0 || KEYS.some(key => now[key] !== target[key]);

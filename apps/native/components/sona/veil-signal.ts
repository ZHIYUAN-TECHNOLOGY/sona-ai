/** The liquid veil's voice signal: smoothed mic loudness plus a short history the shader draws as columns. */
export const HISTORY = 24;
export const ATTACK_MS = 80;
export const RELEASE_MS = 350;
/** One column every 70 ms: 24 columns hold ~1.7 s of voice. */
export const STEP_MS = 70;

/** One-pole envelope follower: rises over ~80 ms, falls over ~350 ms, whatever the frame rate. */
export function follow(env: number, target: number, dt: number) {
  "worklet";
  const tau = target > env ? ATTACK_MS : RELEASE_MS;
  return env + (target - env) * (1 - Math.exp(-Math.max(0, dt) / tau));
}

/** Newest loudness in at the front (the centre column), the oldest falls off the end. Mutates and returns `history`. */
export function pushHistory(history: number[], value: number) {
  "worklet";
  history.pop();
  history.unshift(value);
  return history;
}

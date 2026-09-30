/**
 * A hosted model that sat idle starts again on the next ask, which can take minutes. Meanwhile the server
 * answers with its sample plus `waking`, the whole minutes until the model should be ready (no `waking`:
 * nothing is starting). The screen shows the sample, says so, and asks again until the model answers.
 */

/** Minutes until the model is ready, when this answer is a sample because the model is starting; else undefined. */
export function wakingOf(answer: unknown) {
  const { source, waking } = (answer ?? {}) as { source?: unknown; waking?: unknown };
  return source === "fixture" && typeof waking === "number" && waking > 0 ? Math.ceil(waking) : undefined;
}

const about = (minutes: number) => minutes <= 1 ? "about a minute" : `about ${minutes} min`;
/** `SampleLabel`'s line for such a sample: "Sample for now · Sona's model is starting, about 3 min". */
export const startingLabel = (minutes: number, rule = false) => `${rule ? "Rule-based" : "Sample"} for now · Sona's model is starting, ${about(minutes)}`;
/** The Sona sheet's reply to a free question meanwhile (the sheet does not ask again by itself). */
export const startingReply = (minutes: number) => `Sona's model is starting, ${about(minutes)}. Ask again then.`;

export const RETRY_MS = 45_000;
/** Ask again every 45 s, for up to 45 min: the wait before the next ask, `elapsed` ms after the first, or undefined to stop. */
export const retryIn = (elapsed: number) => elapsed + RETRY_MS <= 45 * 60_000 ? RETRY_MS : undefined;

/**
 * Ask, and while the answer is such a sample, ask again on `retryIn`'s schedule. `onAnswer` gets every answer
 * (the sample, then the model's). A failed first ask is `onError`; a failed ask again keeps the sample and
 * tries at the next turn. Returns the stop, for when the screen closes or live mode goes off.
 */
export function askUntilAwake<T>(read: () => Promise<T>, onAnswer: (answer: T) => void, onError: (error: unknown) => void) {
  const since = Date.now();
  let stopped = false, sample = false, timer: ReturnType<typeof setTimeout> | undefined;
  const again = () => { const wait = retryIn(Date.now() - since); if (wait) timer = setTimeout(ask, wait); };
  function ask() {
    read().then(answer => {
      if (stopped) return;
      sample = wakingOf(answer) !== undefined;
      onAnswer(answer);
      if (sample) again();
    }, error => {
      if (stopped) return;
      if (sample) again(); else onError(error);
    });
  }
  ask();
  return () => { stopped = true; clearTimeout(timer); };
}

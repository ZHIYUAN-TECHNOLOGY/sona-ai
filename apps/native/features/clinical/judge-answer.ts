import { wakingOf } from "../live/waking";

/**
 * The judge build's rule for a card whose answer a model writes (briefing, reasoning, discharge draft, claim
 * codes, appeal, huddle): only the model's own answer stands as the answer. Until one arrives the card is
 * "drafting"; a call that failed, or a server that answered from its stub (`source: "fixture"`, with `waking`
 * while the model starts), is said in the card with `reason`, and nothing authored takes the answer's place.
 * Undefined: show the card as today (outside the judge build, or the model answered). Pure, so it is tested
 * without the app; `judge` is JUDGE (features/live).
 */
export type Unanswered = { why: "drafting" | "failed" | "stub"; reason?: string };
export function unanswered(judge: boolean, answer: { loading: boolean; data?: unknown; error?: string }): Unanswered | undefined {
  if (!judge || (answer.data as { source?: unknown } | undefined)?.source === "model") return undefined;
  if (answer.loading) return { why: "drafting" };
  if (answer.error) return { why: "failed", reason: answer.error };
  // Not asked (no visit, a section still closed) reads as a stub too: either way no model has answered.
  const waking = wakingOf(answer.data);
  // The model answered and the server's checks kept none of it (`withheld`): said as that, never as silence.
  if ((answer.data as { withheld?: unknown } | undefined)?.withheld) return { why: "stub", reason: "Sona's model answered, but nothing in its answer kept to the record" };
  return { why: "stub", reason: waking ? `Sona's model is starting, about ${waking} min` : "Sona's model did not answer" };
}

import { unanswered } from "@/features/clinical/judge-answer";
import { startingLabel } from "@/features/live/waking";

/**
 * SampleLabel's words for an answer no model gave (`source: "fixture"`). Pure, so the wording is tested without the app.
 * Outside the judge build: "Sample · <what> model not switched on", "Rule-based", or "... for now" while the model starts.
 * The judge build has no samples, so the same state is said as what happened, in `unanswered`'s words: the model is
 * starting, or it did not answer (with the call's error when the caller has it: `answerError`, a live-answer hook's).
 * Plain "Rule-based" (no `what`: fixed rules are the answer, no model replaces them) is the same in both.
 * `error`, passed by the caller itself, is said in every mode: a fallback drafted by rules after a failed call was
 * never "model not switched on".
 */
export function sampleText({ judge, rule = false, what, waking, error, answerError }: { judge: boolean; rule?: boolean; what?: string; waking?: number; error?: string; answerError?: string }) {
  const lead = rule ? "Rule-based · " : "";
  if (error) return `${lead}${what ? `the ${what} model` : "Sona's model"} could not be reached: ${error}`;
  if (!judge) return waking ? startingLabel(waking, rule) : `${rule ? "Rule-based" : "Sample"}${what ? ` · ${what} model not switched on` : ""}`;
  if (rule && !what && !waking) return "Rule-based";
  const said = unanswered(true, { loading: false, data: { source: "fixture", waking }, error: answerError })!;
  return `${waking && rule ? "Rule-based for now · " : lead}${said.why === "failed" ? `Sona's model did not answer: ${said.reason}` : said.reason}`;
}

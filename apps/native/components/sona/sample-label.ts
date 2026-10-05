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

/**
 * What a SampleLabel means, the one line it unfolds under itself when tapped, in the About data sheet's words. In place:
 * the label sits inside review pages (Discharge, the guarantee letter, X-ray, a scan, the consultation), and a sheet
 * opened over them only to say this stacked on top of the work. The sheet stays for the "Synthetic data" pill.
 */
export function labelMeaning({ judge, model = false, rule = false, waking, error }: { judge: boolean; model?: boolean; rule?: boolean; waking?: number; error?: string }) {
  if (model) return "Written by a model: check it before acting.";
  if (rule) return "Fixed rules worked this out, not a model.";
  if (judge) return "Until Sona's model answers, nothing is shown in its place.";
  return `An authored example, shown ${error ? "because the model could not be reached" : waking ? "until the model has started" : "until the AI model is switched on"}.`;
}

const MODEL_NAMES: [RegExp, string][] = [[/^medgemma/i, "MedGemma"], [/^gemma/i, "Gemma"], [/asr/i, "Sona speech"]];
/** A hosted model's plain name for its label ("gemma-4-26b-a4b" → "Gemma"). */
export const modelName = (id?: string) => MODEL_NAMES.find(([re]) => id && re.test(id))?.[1] ?? "a hosted model";

// As the check-in follow-up writes a time: the hospital's clock (Malaysia), whatever the phone's.
const WHEN = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" } as const;
/**
 * A model answer's label. With `storedAt` the model was not asked now: the server gave back the answer it kept
 * (packages/api answers), so the label says when it was drafted, and a model that is off now is not read as answering now.
 */
export const draftText = (model?: string, storedAt?: Date | string) =>
  `AI draft · ${modelName(model)}${storedAt ? ` · drafted earlier, ${new Date(storedAt).toLocaleString("en-GB", WHEN)}` : ""} · check before acting`;

type By = { source: string; model?: string; decidedBy?: string };
/**
 * Who read a patient's words (a message's triage, a check-in reply's label) when it was not a model alone: the urgent-word
 * rule deciding over the model ("Safety rule"), the rules with no model ("Rule-based"), or no one ("Not triaged": the
 * label shown is only the default). Nothing for a model's own reading, and no claim for a row from before this was kept.
 * `source` is the server's: "model", "fixture", "none", "unknown", or (check-ins) the model's name itself.
 */
export const readerText = (by?: By) =>
  !by || by.source === "unknown" ? undefined : by.source === "none" ? "Not triaged" : by.source === "fixture" ? "Rule-based" : by.decidedBy === "rules" ? "Safety rule" : undefined;

/** Who made something kept as sent (a letter's codes, an appeal): "<verb> Gemma", "Rule-based", or no claim when it was not kept. */
export const keptByText = (by: By | undefined, verb: string) => by?.source === "model" ? `${verb} ${modelName(by.model)}` : by?.source === "fixture" ? "Rule-based" : undefined;

/** Who took the patient's name out before a hosted model read a scan (scan.read's `deidentifier`); nothing when nothing left the server ("none"). */
export const deidentifiedText = (by?: string) => !by || by === "none" ? undefined : `Name removed before reading · ${by === "rules" ? "Rule-based" : by}`;

/**
 * An empty findings list, said as what it is (findings.status): a model read the film and found nothing, or no model
 * has read it (`unread`: never a clean result; null is a film nobody read, "fixture" the stub). Nothing while the
 * status is not known, when the reading did find something, or for a reading whose reader was not kept.
 */
export function emptyReadText(read?: (By & { found: number }) | null) {
  if (read === undefined || read?.source === "unknown") return undefined;
  if (read?.source === "model") return read.found ? undefined : { text: `Read by ${modelName(read.model)} · nothing found`, unread: false };
  return { text: "This film has not been read by a model", unread: true };
}

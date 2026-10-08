import type { Claim, Reference } from "@sona-ai/domain/evidence";
import { modelName } from "@sona-ai/domain/model-names";

import type { client } from "@/lib/orpc";

export type Answer = Awaited<ReturnType<typeof client.evidence.ask>>;
/** What `evidence.stream` sends: the steps, the parts as they are written, then the whole answer. */
export type StreamEvent =
  | { type: "step"; step: "search" | "write" }
  | { type: "step"; step: "read"; studies: number; passages: number; references: Reference[] }
  | { type: "bottomLine"; text: string }
  | { type: "claim"; claim: Claim }
  | { type: "answer"; answer: Answer };

/** One question and what has arrived of its answer so far. `answer` is set once the server has finished. */
export type Turn = {
  id: string;
  question: string;
  step: string;
  bottomLine?: string;
  claims: Claim[];
  references: Reference[];
  answer?: Answer;
  failed?: string;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const newTurn = (id: string, question: string): Turn => ({ id, question, step: "Searching the literature", claims: [], references: [] });

/** The turn after one stream event. The finished answer replaces the parts that arrived early. */
export function apply(turn: Turn, event: StreamEvent): Turn {
  if (event.type === "bottomLine") return { ...turn, bottomLine: event.text };
  if (event.type === "claim") return { ...turn, claims: [...turn.claims, event.claim] };
  if (event.type === "answer") return { ...turn, answer: event.answer, bottomLine: event.answer.bottomLine, claims: event.answer.claims, references: event.answer.references };
  if (event.step === "read") return { ...turn, references: event.references, step: `Reading the sources · ${plural(event.studies, "study", "studies")}, ${plural(event.passages, "library passage")}` };
  return event.step === "write" ? { ...turn, step: "Reading the sources and writing the answer" } : turn;
}

/**
 * The number of the film that leads an answer: its first source, when that is a patient's X-ray the answer cites, so the
 * page can open it before the clinician does. A film the answer does not cite stays one of the sources, opened on a tap.
 */
export const leadFilm = (references: Reference[], cited: Pick<Claim, "cites">[]) => {
  const first = references[0];
  return first?.kind === "image" && cited.some(c => c.cites.includes(first.n)) ? first.n : undefined;
};

/** The film an answer carries in place (a page's Sona thread); on a patient's page (`encounterId`) only that visit's own film, never another patient's. */
export const answerFilm = (references: Reference[], cited: Pick<Claim, "cites">[], encounterId?: string) => {
  const film = leadFilm(references, cited) && references[0]?.encounterId ? references[0] : undefined;
  return film && (!encounterId || film.encounterId === encounterId) ? film : undefined;
};

/** The earlier turns the way the router expects them: at most four, answered ones only, the answer as plain text. */
export const threadOf = (turns: Turn[]) =>
  turns
    .filter(t => t.answer)
    .slice(-4)
    .map(t => ({ question: t.question, answer: [t.bottomLine, ...t.claims.map(c => c.text)].filter(Boolean).join(" ").slice(0, 4000) }));

/** The label for an answer the model did not write, in plain words; undefined for a model answer. */
export function sampleLabel(answer: Pick<Answer, "source"> & { waking?: number }) {
  if (answer.source === "cached") return "Prepared answer, not written by the model";
  if (answer.source !== "fixture") return undefined;
  const minutes = Math.ceil(answer.waking ?? 0);
  if (minutes <= 0) return "Sample answer";
  return `Sample for now · Sona's model is starting, ${minutes <= 1 ? "about a minute" : `about ${minutes} min`}. Ask again then.`;
}

/** Who wrote a finished answer, for the caption under Sona's mark: the sample label, or the model by Sona's name, never its id. */
export const answerBy = (answer: Pick<Answer, "source"> & { waking?: number }) => sampleLabel(answer) ?? modelName(answer.source);

/** Where a turn's answer is, for its steps line: done once answered, writing once the write step or a claim arrived, reading once sources came. */
export function phaseOf(turn: Turn): "search" | "read" | "write" | "done" {
  if (turn.answer || turn.failed) return "done";
  if (turn.bottomLine || turn.claims.length || turn.step.includes("writing")) return "write";
  return turn.step.startsWith("Reading") ? "read" : "search";
}

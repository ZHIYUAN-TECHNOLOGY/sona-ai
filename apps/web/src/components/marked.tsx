import { type Mark, type MarkKind, markKindOf } from "@sona-ai/domain/answer-parts";
import { Fragment } from "react";

// The phone apps' rules, read as they are: one dictionary decides which clinical words get a colour everywhere.
import { segments } from "../../../native/components/sona/marked-terms";
// Sona Care's rules (the patient app's): her medicines, how much and when, and when to worry.
import { chosenIn, marked, piecesOf } from "../../../care/features/assistant/terms";

/** Pieces as spans, each mark under its kind as it is now (`markKindOf` reads Pro's old alert and finding); an unknown kind stays plain. */
const spans = (pieces: { text: string; mark?: string }[], className: string) => pieces.map((p, i) => {
  const kind = markKindOf(p.mark);
  return kind ? <span key={i} className={className} data-mark={kind}>{p.text}</span> : <Fragment key={i}>{p.text}</Fragment>;
});

/** Clinical text with its terms coloured by kind, so the eye lands on what matters first: the model's choice (`marks`, from `partsOf`) when it gave one, else the word lists. */
export function Marked({ text, marks }: { text: string; marks?: Mark[] }) {
  return <>{spans(marks ? piecesOf(text, chosenIn(text, marks)) : segments(text), "mark")}</>;
}

/** A patient's answer with its words coloured as in the Sona Care app: the model's own choice (`marks`) when it gave one, else her app's word lists. */
export function CareMarked({ text, marks }: { text: string; marks?: Mark[] }) {
  return <>{spans(marks ? piecesOf(text, chosenIn(text, marks)) : marked(text), "care-mark")}</>;
}

/** Text in the app's own look: Sona Care's coloured words for patients, Sona Pro's chips for clinicians. */
export const MarkedFor = ({ app, text, marks }: { app: "pro" | "care"; text: string; marks?: Mark[] }) => (app === "care" ? <CareMarked text={text} marks={marks} /> : <Marked text={text} marks={marks} />);

// The kinds the clinical word lists colour, in the legend's words (docs/answer-parts.md); condition and symptom share teal.
const KEY: [MarkKind, string][] = [["warning", "Must not miss"], ["caution", "Check"], ["medicine", "Medicine"], ["condition", "Condition or symptom"]];

/** What each colour means. Show it once on a page that uses `Marked`. */
export function MarkKey() {
  return (
    <ul className="mark-key" aria-label="Colour key">
      {KEY.map(([mark, label]) => <li key={mark}><span className="mark" data-mark={mark}>{label}</span></li>)}
    </ul>
  );
}

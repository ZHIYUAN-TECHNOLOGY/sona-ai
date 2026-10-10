import { Fragment } from "react";

// The phone apps' rules, read as they are: one dictionary decides which clinical words get a colour everywhere.
import { type Mark, segments } from "../../../native/components/sona/marked-terms";
// Sona Care's rules (the patient app's): her medicines, how much and when, and when to worry.
import { marked } from "../../../care/features/assistant/terms";

/** Clinical text with its terms coloured by kind, so the eye lands on what matters first. */
export function Marked({ text }: { text: string }) {
  return (
    <>
      {segments(text).map((seg, i) => seg.mark ? <span key={i} className="mark" data-mark={seg.mark}>{seg.text}</span> : <Fragment key={i}>{seg.text}</Fragment>)}
    </>
  );
}

/** A patient's answer with its medicines, doses and warning signs coloured as in the Sona Care app. */
export function CareMarked({ text }: { text: string }) {
  return (
    <>
      {marked(text).map((p, i) => p.mark ? <span key={i} className="care-mark" data-mark={p.mark}>{p.text}</span> : <Fragment key={i}>{p.text}</Fragment>)}
    </>
  );
}

/** Text in the app's own colours: Sona Care's three for patients, Sona Pro's five for clinicians. */
export const MarkedFor = ({ app, text }: { app: "pro" | "care"; text: string }) => (app === "care" ? <CareMarked text={text} /> : <Marked text={text} />);

const KEY: [Mark, string][] = [["alert", "Must not miss"], ["medicine", "Medicine"], ["finding", "Diagnosis"], ["symptom", "Symptom"], ["caution", "Unconfirmed"]];

/** What each colour means. Show it once on a page that uses `Marked`. */
export function MarkKey() {
  return (
    <ul className="mark-key" aria-label="Colour key">
      {KEY.map(([mark, label]) => <li key={mark}><span className="mark" data-mark={mark}>{label}</span></li>)}
    </ul>
  );
}

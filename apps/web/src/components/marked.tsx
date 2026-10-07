import { Fragment } from "react";

// The phone apps' rules, read as they are: one dictionary decides which clinical words get a colour everywhere.
import { type Mark, segments } from "../../../native/components/sona/marked-terms";

/** Clinical text with its terms coloured by kind, so the eye lands on what matters first. */
export function Marked({ text }: { text: string }) {
  return (
    <>
      {segments(text).map((seg, i) => seg.mark ? <span key={i} className="mark" data-mark={seg.mark}>{seg.text}</span> : <Fragment key={i}>{seg.text}</Fragment>)}
    </>
  );
}

const KEY: [Mark, string][] = [["alert", "Must not miss"], ["medicine", "Medicine"], ["finding", "Diagnosis"], ["symptom", "Symptom"], ["caution", "Unconfirmed"]];

/** What each colour means. Show it once on a page that uses `Marked`. */
export function MarkKey() {
  return (
    <ul className="mark-key" aria-label="Colour key">
      {KEY.map(([mark, label]) => <li key={mark}><span className="mark" data-mark={mark}>{label}</span></li>)}
    </ul>
  );
}

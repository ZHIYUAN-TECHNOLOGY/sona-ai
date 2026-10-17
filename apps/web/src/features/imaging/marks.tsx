import { boxStyle } from "@/features/library/files";
import "@/styles/marks.css";

/** The slice of a findings.list row the marks need: /pro/xray and the evidence film card both pass the server's rows. */
export type Marked = { id: string; imageKey?: string | null; status: string; location: { box?: readonly number[] | null } };

/** Only findings the server marked as read from this very image are drawn on it; dismissed ones leave the film. */
export const onImage = <F extends Marked>(all: F[], imageKey: string | undefined) => (imageKey ? all.filter(f => f.imageKey === imageKey && f.status !== "dismissed") : []);

/** The stored film as an `img` source. */
export const filmUrl = (film: { contentType: string; dataBase64: string }) => `data:${film.contentType};base64,${film.dataBase64}`;

/**
 * Numbered boxes over a film, in the order the findings are listed, so a "2" on the image is the second finding in the
 * list beside it. Spans, not divs, so a card can draw them inside its pick button. The parent is the image's own box.
 */
export const FindingMarks = ({ findings }: { findings: Marked[] }) => (
  <>{findings.map((f, i) => f.location.box && <span key={f.id} className="xr-box" style={boxStyle(f.location.box)}><span>{i + 1}</span></span>)}</>
);

import type { Reference } from "@sona-ai/domain/evidence";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { FindingMarks, filmUrl, onImage } from "@/features/imaging/marks";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/evidence.css";

/**
 * A patient's X-ray an answer cites: the film itself, its findings marked as /pro/xray marks them, the reading under
 * it. With `onPick` it is a pickable source (the evidence rail); without, a plain card (a page's Sona thread). A grey
 * card with the title stands in while the film loads; no spinner.
 */
export function FilmCard({ as: Tag = "div", id, reference, encounterId, picked, onPick }: { as?: "li" | "div"; id?: string; reference: Reference; encounterId: string; picked?: boolean; onPick?: () => void }) {
  const input = { encounterId };
  // Up to 10 MB per film: fetched once per visit and kept, not refetched on every focus.
  const film = useQuery({ ...orpc.xray.image.queryOptions({ input }), retry: false, staleTime: Infinity });
  const findings = useQuery({ ...orpc.findings.list.queryOptions({ input }), staleTime: Infinity });
  const body = (
    <>
      <span className="ev-source-meta">{reference.n} · {reference.design} · {reference.year}</span>
      {film.data ? (
        <span className="ev-film-image">
          <img src={filmUrl(film.data)} alt={reference.title} />
          <FindingMarks findings={onImage(findings.data ?? [], film.data.key)} />
        </span>
      ) : (
        <span className="ev-film-image ev-film-wait" aria-busy={film.isPending}>{film.isError ? "Film not available" : reference.title}</span>
      )}
      <span className="ev-source-title">{reference.title}</span>
      <span className="ev-source-text">{reference.text}</span>
    </>
  );
  return (
    <Tag id={id} className="ev-source ev-film" data-picked={picked}>
      {onPick ? <button type="button" aria-pressed={picked} onClick={onPick}>{body}</button> : <div className="ev-film-body">{body}</div>}
      <Link to="/pro/xray" search={{ encounter: encounterId }}>Open film</Link>
    </Tag>
  );
}

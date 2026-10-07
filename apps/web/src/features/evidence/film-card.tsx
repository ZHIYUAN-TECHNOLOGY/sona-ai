import type { Reference } from "@sona-ai/domain/evidence";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Icon } from "@/components/icon";
import { Chip } from "@/components/primitives";
import { FilmArtifact } from "@/features/imaging/film-artifact";
import { filmTitle, findingTone, readingOf } from "@/features/imaging/films";
import { FindingMarks, filmUrl, onImage } from "@/features/imaging/marks";
import { orpc } from "@/lib/orpc";
import "@/styles/film.css";
import "@/styles/pages/evidence.css";

/**
 * A patient's X-ray an answer cites, as a card that opens the film in place (FilmArtifact): a 4:5 thumbnail with the
 * findings boxed, the title line, the reading in two lines and the findings as chips. `size="thumb"` is the film alone,
 * for the Sources list's image slot. A quiet grey box stands in while the film loads; no spinner. `onPick` (the evidence
 * rail's source pick) runs on the same press; `as` and `id` place it in a list.
 */
export function FilmCard({ as: Tag = "div", id, reference, encounterId, picked, onPick, size = "lead" }: { as?: "li" | "div"; id?: string; reference: Reference; encounterId: string; picked?: boolean; onPick?: () => void; size?: "lead" | "thumb" }) {
  const input = { encounterId };
  // Up to 10 MB per film: fetched once per visit and kept, not refetched on every focus.
  const film = useQuery({ ...orpc.xray.image.queryOptions({ input }), retry: false, staleTime: Infinity });
  const findings = useQuery({ ...orpc.findings.list.queryOptions({ input }), staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  const title = filmTitle(reference.title);
  const marked = onImage(findings.data ?? [], film.data?.key);
  const thumb = (
    <span className="film-thumb" aria-busy={film.isPending} data-failed={film.isError || undefined}>
      {film.data ? <span><img src={filmUrl(film.data)} alt="" /><FindingMarks findings={marked} /></span> : film.isError ? "Film not available" : null}
    </span>
  );
  return (
    <Tag id={id} className="ev-film film-holder" data-size={size}>
      <button type="button" className="film-card" data-size={size} data-picked={picked} aria-pressed={onPick ? picked : undefined}
        aria-label={size === "thumb" ? `Open ${title}` : undefined} onClick={() => { onPick?.(); setOpen(true); }}>
        {thumb}
        {size === "lead" && (
          <span className="film-card-text">
            <span className="film-card-title">{title}</span>
            <span className="film-card-read">{readingOf(reference.text)}</span>
            {marked.length > 0 && <span className="film-chips">{marked.map(f => <Chip key={f.id} tone={findingTone(f)}>{f.label}</Chip>)}</span>}
            <span className="film-open">Open<Icon name="chevron-right" size={14} /></span>
          </span>
        )}
      </button>
      <FilmArtifact film={open ? { encounterId, title, patientId: findings.data?.[0]?.patientId } : undefined} onClose={() => setOpen(false)} />
    </Tag>
  );
}

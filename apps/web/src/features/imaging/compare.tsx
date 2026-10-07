import { ORPCError } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";

import { Card, Chip } from "@/components/primitives";
import { type SimilarFilm, groupFilms } from "@/features/imaging/films";
import { FindingMarks, filmUrl, onImage } from "@/features/imaging/marks";
import { messageOf } from "@/features/library/files";
import { orpc } from "@/lib/orpc";
import "@/styles/film.css";

const date = (at: Date | string) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" });

/**
 * Under the viewer: "is this nodule new?" needs this patient's earlier films, then the hospital's films nearest this
 * one, each with what was read on it. A phrase in the find box searches the hospital's films by it instead.
 */
export function Compare({ encounterId, patientId, onOpen, plain }: { encounterId: string; patientId: string | undefined; /** A film opens in place (the film panel) instead of loading on /pro/xray. */ onOpen?: (film: SimilarFilm) => void; /** No card around it (inside the film panel). */ plain?: boolean }) {
  const [draft, setDraft] = useState("");
  const [text, setText] = useState("");
  const input = text ? { text } : { encounterId };
  const similar = useQuery({ ...orpc.xray.similar.queryOptions({ input }), retry: false, staleTime: 5 * 60_000 });
  const find = (event: FormEvent) => { event.preventDefault(); setText(draft.trim()); };
  const off = similar.error instanceof ORPCError && similar.error.code === "SERVICE_UNAVAILABLE";
  const { earlier, similar: others } = groupFilms(similar.data?.films ?? [], patientId);
  const body = (
    <>
      <form className="xr-find" onSubmit={find}>
        <input aria-label="Find films" placeholder="Find films: effusion on the left" maxLength={200} value={draft}
          onChange={e => { setDraft(e.target.value); if (!e.target.value.trim()) setText(""); }} />
      </form>
      {off ? <p className="xr-note">Film search is off on this server.</p>
        : similar.isError ? <p className="xr-error" role="alert">{messageOf(similar.error)}</p>
        : similar.data && !similar.data.indexed ? <p className="xr-note">This film is not indexed yet; re-upload to compare.</p>
        : similar.data && similar.data.films.length === 0 ? <p className="xr-note">{text ? "No films match that." : "No other films in this hospital to compare with yet."}</p>
        : !similar.data ? <ul className="xr-films" aria-busy="true">{[0, 1, 2].map(i => <li key={i} className="xr-film"><span className="xr-thumb" /></li>)}</ul>
        : (
          <>
            {!text && <Films title="This patient's earlier films" films={earlier} none="No earlier film for this patient." onOpen={onOpen} />}
            <Films title={text ? `Films matching "${text}"` : "Similar films in this hospital"} films={others} none="No similar film found." onOpen={onOpen} />
          </>
        )}
    </>
  );
  return plain ? body : <Card title="Compare">{body}</Card>;
}

function Films({ title, films, none, onOpen }: { title: string; films: SimilarFilm[]; none: string; onOpen?: (film: SimilarFilm) => void }) {
  return (
    <section className="xr-group">
      <h3 className="xr-group-title">{title}</h3>
      {films.length === 0 ? <p className="xr-note">{none}</p> : (
        <ul className="xr-films">
          {films.map(film => {
            const body = (
              <>
                <Thumb encounterId={film.encounterId} alt={`Chest X-ray: ${film.patientName}, ${date(film.uploadedAt)}`} />
                <span className="xr-film-who">{film.patientName}</span>
                <span className="xr-note">{date(film.uploadedAt)}</span>
                {film.findings.length > 0 && <span className="xr-film-chips">{film.findings.map((label, i) => <Chip key={i}>{label}</Chip>)}</span>}
              </>
            );
            return (
              <li key={film.encounterId} className="xr-film">
                {onOpen ? <button type="button" onClick={() => onOpen(film)}>{body}</button> : <Link to="/pro/xray" search={{ encounter: film.encounterId }}>{body}</Link>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The small film, fetched once it scrolls into view or is hovered; a grey box before. Films are big (up to 10 MB), so never all at once. */
function Thumb({ encounterId, alt }: { encounterId: string; alt: string }) {
  const [box, setBox] = useState<HTMLElement | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!box || seen) return;
    const watch = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) setSeen(true); }, { rootMargin: "200px" });
    watch.observe(box);
    return () => watch.disconnect();
  }, [box, seen]);
  const input = { encounterId };
  const film = useQuery({ ...orpc.xray.image.queryOptions({ input }), enabled: seen, retry: false, staleTime: Infinity });
  const findings = useQuery({ ...orpc.findings.list.queryOptions({ input }), enabled: seen && Boolean(film.data), staleTime: Infinity });
  return (
    <span ref={setBox} className="xr-thumb" onMouseEnter={() => setSeen(true)} onFocus={() => setSeen(true)}>
      {film.data ? <><img src={filmUrl(film.data)} alt={alt} /><FindingMarks findings={onImage(findings.data ?? [], film.data.key)} /></>
        : film.isError ? <span className="xr-note">Film not available</span> : null}
    </span>
  );
}

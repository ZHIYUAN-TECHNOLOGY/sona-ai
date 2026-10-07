import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { createPortal } from "react-dom";

import { Artifact, Notice, Shimmer } from "@/components/ai";
import { Button, Chip, Signal } from "@/components/primitives";
import { Compare } from "@/features/imaging/compare";
import { FilmStage, ZoomSlider } from "@/features/imaging/film-stage";
import { filmTitle, findingTone, followUpOf } from "@/features/imaging/films";
import { filmUrl, onImage } from "@/features/imaging/marks";
import { orpc } from "@/lib/orpc";

/** The film the panel shows: its visit, the title line, and whose it is (for Compare's "earlier films"). */
export type PanelFilm = { encounterId: string; title: string; patientId?: string };

/**
 * A film opened in place from an answer or from Compare: the film large on the same draggable, zoomable stage as
 * /pro/xray, the findings boxed and listed with their follow-up, Sona's draft read, and two actions: the X-ray page
 * (`goLabel`, where the decision is made) and Compare, which swaps the body for this visit's earlier and similar films;
 * a compared film opens here too. `film` undefined closes it. Portalled to the body so no glass parent traps it.
 */
export function FilmArtifact({ film, onClose, goLabel = "Open X-ray page" }: { film: PanelFilm | undefined; onClose: () => void; goLabel?: string }) {
  // What the panel shows: the film it was opened on, or one picked from Compare; kept while it slides out.
  const [view, setView] = useState<{ film: PanelFilm; compare: boolean }>();
  const [from, setFrom] = useState<string>();
  if (film?.encounterId !== from) { setFrom(film?.encounterId); if (film) setView({ film, compare: false }); }
  if (!view) return null;
  const { encounterId, title } = view.film;
  return createPortal(
    // The tokens live on `.pro`; display: contents keeps them without a box.
    <div className="pro film-portal">
      <Artifact open={Boolean(film)} onClose={onClose} title={title} subtitle={<Lead encounterId={encounterId} />}
        actions={
          <>
            <Button size="sm" aria-pressed={view.compare} onClick={() => setView({ ...view, compare: !view.compare })}>{view.compare ? "Back to film" : "Compare"}</Button>
            <Link className="btn btn-secondary" data-size="sm" to="/pro/xray" search={{ encounter: encounterId }} onClick={onClose}>{goLabel}</Link>
          </>
        }>
        {view.compare ? (
          <div className="film-art">
            <Compare plain encounterId={encounterId} patientId={view.film.patientId}
              onOpen={f => setView({ film: { encounterId: f.encounterId, title: filmTitle({ name: f.patientName, at: f.uploadedAt }), patientId: f.patientId }, compare: false })} />
          </div>
        ) : <FilmBody key={encounterId} encounterId={encounterId} />}
      </Artifact>
    </div>,
    document.body,
  );
}

const filmQueries = (encounterId: string) => {
  const input = { encounterId };
  return [
    // Up to 10 MB per film: fetched once per visit and kept.
    { ...orpc.xray.image.queryOptions({ input }), retry: false, staleTime: Infinity },
    { ...orpc.findings.list.queryOptions({ input }), staleTime: 60_000 },
  ] as const;
};

/** Insight first: what is waiting on this film, under its title. */
function Lead({ encounterId }: { encounterId: string }) {
  const [image, findings] = filmQueries(encounterId);
  const film = useQuery(image), rows = useQuery(findings);
  const open = onImage(rows.data ?? [], film.data?.key).filter(f => f.status === "open");
  if (!open.length) return "Draft read, not validated";
  return <Signal tone={open.some(f => f.kind === "nodule") ? "urgent" : "soon"}>{open.length} finding{open.length === 1 ? "" : "s"} waiting for a decision</Signal>;
}

function FilmBody({ encounterId }: { encounterId: string }) {
  const [image, findings] = filmQueries(encounterId);
  const film = useQuery(image), rows = useQuery(findings);
  const read = useQuery({ ...orpc.xray.read.queryOptions({ input: { encounterId } }), retry: false });
  const [zoom, setZoom] = useState(1);
  const marked = onImage(rows.data ?? [], film.data?.key);
  const sample = read.data && read.data.source !== "model";
  return (
    <div className="film-art">
      <FilmStage src={film.data && filmUrl(film.data)} alt="Chest X-ray" findings={marked} zoom={zoom} setZoom={setZoom}>
        {film.data ? null : film.isError ? <p className="xr-note">Film not available</p> : <Shimmer>Loading the film</Shimmer>}
      </FilmStage>
      {film.data && (
        <div className="film-art-tools">
          <span className="xr-note">Drag to move · double-click or pinch to zoom</span>
          <ZoomSlider zoom={zoom} setZoom={setZoom} />
        </div>
      )}
      {marked.length > 0 && (
        <section aria-label="Findings">
          <h3>Findings on this film</h3>
          <ol className="film-findings">
            {marked.map((f, i) => (
              <li key={f.id} className="film-finding">
                <span className="film-num" aria-hidden="true">{i + 1}</span>
                <strong>{f.label}</strong>
                <span className="xr-note">{[f.location.zone, f.sizeMm ? `${f.sizeMm} mm` : null, f.status === "tracked" ? null : "possible, not confirmed"].filter(Boolean).join(" · ")}</span>
                <span className="film-chips">
                  <Chip tone={findingTone(f)}>{f.status === "tracked" ? "Tracked" : f.kind === "nodule" ? "Must not miss" : "Waiting for a decision"}</Chip>
                  {followUpOf(f) ? <Chip tone="neutral" icon="calendar">{followUpOf(f)}</Chip> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section aria-label="Sona's draft read">
        <h3>{sample ? "Sample read, not from this image" : "Sona's draft read"}</h3>
        {read.data ? (
          read.data.findings.length ? <ul className="film-lines">{read.data.findings.map((line, i) => <li key={i}>{line}</li>)}</ul> : <p className="xr-note">Nothing described on this image.</p>
        ) : read.isError ? <Notice kind="empty">No read for this film yet.</Notice> : <Shimmer>Reading the film</Shimmer>}
        <p className="xr-note">Not validated: not a radiologist's report or a diagnosis.</p>
      </section>
    </div>
  );
}

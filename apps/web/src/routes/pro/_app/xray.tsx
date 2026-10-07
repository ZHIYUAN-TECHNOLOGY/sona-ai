import { ORPCError } from "@orpc/client";
import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icon";
import { InsightCard } from "@/components/insight-card";
import { PageHeader } from "@/components/page";
import { Button, Card, Chip, Field, ListCard, ListRow, Select, Signal, Skeleton } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { useVisitAsk } from "@/features/evidence/ask";
import { Compare } from "@/features/imaging/compare";
import { FilmArtifact, type PanelFilm } from "@/features/imaging/film-artifact";
import { FilmStage, ZoomSlider } from "@/features/imaging/film-stage";
import { filmTitle, testOf } from "@/features/imaging/films";
import { filmUrl, onImage as readFrom } from "@/features/imaging/marks";
import { messageOf, toBase64 } from "@/features/library/files";
import { client, orpc } from "@/lib/orpc";
import "@/styles/pages/xray.css";

export const Route = createFileRoute("/pro/_app/xray")({
  // An answer's "Open film" link preselects the visit it cites.
  validateSearch: (search: Record<string, unknown>): { encounter?: string } => (typeof search.encounter === "string" && search.encounter ? { encounter: search.encounter } : {}),
  component: Page,
});

/** A visit with no X-ray yet answers NOT_FOUND: that is the empty state, not an error to show. */
const missing = (error: unknown) => error instanceof ORPCError && error.code === "NOT_FOUND";
const when = (at: Date | string) => new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });

function Page() {
  const { me } = Route.useRouteContext();
  const mayUpload = can(me.role, "xray.upload");
  const queryClient = useQueryClient();
  const patients = useQuery(orpc.patients.list.queryOptions());
  const wanted = Route.useSearch().encounter;
  const [encounterId, setEncounterId] = useState(wanted ?? "");
  // A compared film's link lands on this same page: the new search selects its visit.
  const [followed, setFollowed] = useState(wanted);
  if (wanted !== followed) { setFollowed(wanted); if (wanted) setEncounterId(wanted); }
  // "Is this nodule new?" in the Sona bar is answered here, the film under the question.
  useVisitAsk(encounterId, can(me.role, "evidence.stream"));
  // The image sent from this browser, by storage key: shown at once, before the stored copy is fetched back.
  const [sent, setSent] = useState<{ key: string; url: string }>();
  const [zoom, setZoom] = useState(1);
  const [stream, setStream] = useState<MediaStream>();
  const [cameraError, setCameraError] = useState<string>();
  const video = useRef<HTMLVideoElement>(null);

  const read = useQuery({ ...orpc.xray.read.queryOptions({ input: { encounterId } }), enabled: Boolean(encounterId), retry: false });
  const findings = useQuery({ ...orpc.findings.list.queryOptions({ input: { encounterId } }), enabled: Boolean(encounterId) });
  const refresh = () => Promise.all([orpc.xray.read.key(), orpc.findings.list.key(), orpc.findings.status.key()].map(queryKey => queryClient.invalidateQueries({ queryKey })));
  const upload = useMutation({
    mutationFn: async (file: Blob) => {
      const { key } = await client.xray.upload({ encounterId, contentType: file.type || "image/jpeg", dataBase64: await toBase64(file) });
      return { key, url: URL.createObjectURL(file) };
    },
    onSuccess: next => { setSent(next); setZoom(1); return refresh(); },
  });
  const detect = useMutation(orpc.findings.detect.mutationOptions({ onSuccess: refresh }));

  useEffect(() => {
    if (video.current) video.current.srcObject = stream ?? null;
    return () => stream?.getTracks().forEach(t => t.stop());
  }, [stream]);
  const openCamera = () => navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
    .then(s => { setCameraError(undefined); setStream(s); }, () => setCameraError("The camera could not be opened. Allow it in the browser, or choose a file."));
  const snap = () => {
    const v = video.current;
    if (!v) return;
    const canvas = Object.assign(document.createElement("canvas"), { width: v.videoWidth, height: v.videoHeight });
    canvas.getContext("2d")?.drawImage(v, 0, 0);
    canvas.toBlob(blob => { if (blob) upload.mutate(blob); setStream(undefined); }, "image/jpeg", 0.92);
  };

  const data = read.data;
  // A film added elsewhere, or in an earlier session, comes back from storage.
  const stored = useQuery({ ...orpc.xray.image.queryOptions({ input: { encounterId } }), enabled: Boolean(data) && sent?.key !== data?.key, retry: false, staleTime: Infinity });
  const shown = !data ? undefined : sent?.key === data.key ? sent.url : stored.data && stored.data.key === data.key ? filmUrl(stored.data) : undefined;
  const all = findings.data ?? [];
  const onImage = readFrom(all, data?.key);

  const mayDetect = can(me.role, "findings.detect");
  const mayDecide = can(me.role, "findings.track");
  const track = useMutation(orpc.findings.track.mutationOptions({ onSuccess: refresh }));
  const dismiss = useMutation(orpc.findings.dismiss.mutationOptions({ onSuccess: () => { setDismissing(undefined); return refresh(); } }));
  // Who read this film for findings, and when (findings.status is per visit, not per finding).
  const origin = useQuery({ ...orpc.findings.status.queryOptions({ input: { encounterId } }), enabled: Boolean(encounterId) });
  const mayAdd = can(me.role, "findings.addToVisit");
  const timeline = useQuery({ ...orpc.encounter.timeline.queryOptions({ input: { encounterId } }), enabled: Boolean(encounterId) && mayAdd });
  // ponytail: no staff procedure lists a patient's visits, so the next visit is the first timeline event dated ahead
  // (only appointments are); addToVisit refuses any id that is not this patient's visit. Use a visits list when one exists.
  const visit = (timeline.data ?? []).find(e => !e.id.startsWith("recall:") && +new Date(e.at) > Date.now());
  const [adding, setAdding] = useState<string>();
  const addToVisit = useMutation(orpc.findings.addToVisit.mutationOptions({
    onSuccess: () => { setAdding(undefined); return Promise.all([refresh(), ...[orpc.encounter.timeline.key(), orpc.tasks.list.key()].map(queryKey => queryClient.invalidateQueries({ queryKey }))]); },
  }));
  // The finding being dismissed and the reason typed so far: the server keeps the reason on record.
  const [dismissing, setDismissing] = useState<{ id: string; reason: string }>();
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const decision = useRef<HTMLDivElement>(null);
  // A compared film opens in the film panel; "Make this the current view" loads it here.
  const [peek, setPeek] = useState<PanelFilm>();
  const take = (file?: Blob | null) => { if (file && encounterId && mayUpload) upload.mutate(file); };

  // Anything the server does not mark as read by the model (a fixture, a waking model) is shown as a sample.
  const sample = Boolean(data) && data?.source !== "model";
  const open = onImage.filter(f => f.status === "open");
  const hasImage = Boolean(data);
  const lead = !encounterId ? "Choose a patient to see or add a chest X-ray."
    : upload.isPending ? "Sending the image to be read…"
    : read.isPending ? "Looking for this visit's X-ray…"
    : !data ? "No image yet for this visit."
    : (
      <>
        {sample ? <Signal tone="soon">Sample read, not from this image</Signal> : "Draft read ready"}
        {" · "}
        {open.length
          ? <Signal tone={open.some(f => f.kind === "nodule") ? "urgent" : "soon"}>{open.length} finding{open.length === 1 ? "" : "s"} waiting for your decision</Signal>
          : "not validated, check it against the image"}
      </>
    );

  // Sona's read: the draft wording and what it rests on.
  const insight = (
    <>
      {/* The header already reads the image: that suggested step is text only. */}
      <div className={data && !open.length ? "xr-wrap xr-step-only" : "xr-wrap"}>
      <InsightCard label={sample ? "Sona · sample" : "Sona draft"}
        title={!data ? (encounterId && read.isPending ? "Looking for a read" : "No read yet") : sample ? "Sample read, not from this image" : "Chest X-ray draft read"}
        lead={!data ? (encounterId && read.isError && !missing(read.error) ? messageOf(read.error) : "Sona drafts a read as soon as an image is added. You confirm or change it.")
          : data.findings[0] ?? "Nothing described on this image."}
        evidence={data ? [
          ...data.findings.slice(1, 4).map(text => ({ icon: "scan" as const, text })),
          { icon: "shield-check" as const, text: "Not validated: not a radiologist's report or a diagnosis." },
        ] : undefined}
        sources={data ? 1 + onImage.length : undefined}
        next={!data ? undefined : open.length
          ? { label: "Review findings", step: "Check each finding against the image, then track or dismiss it.", onAct: () => decision.current?.querySelector("button")?.focus() }
          : mayDetect ? { label: "Read for findings", step: "Have the image read for findings that must not be missed.", onAct: () => detect.mutate({ encounterId }) } : undefined} />
      </div>
    </>
  );
  // The decision, one finding at a time, each with its evidence beside the buttons.
  const decide = (
    <>
      {data && (
        <Card title="Your decision">
          <div className="xr-decide" ref={decision}>
            {origin.data && <p className="xr-note">Read for findings by {"model" in origin.data ? origin.data.model : origin.data.source === "fixture" ? "the sample reader" : "an unrecorded reader"} · {when(origin.data.readAt)} · {origin.data.found} found</p>}
            {!onImage.length && <p className="xr-note">No findings to decide on yet. {mayDetect ? "Read the image for findings, then track or dismiss each one here." : "A doctor reads the image for findings."}</p>}
            {onImage.map((f, i) => (
              <div key={f.id} className="xr-finding">
                <p><span className="xr-num">{i + 1}</span>{f.label}</p>
                <p className="xr-note xr-evidence">
                  {[f.location.zone, f.sizeMm ? `${f.sizeMm} mm` : null, f.status === "tracked" ? null : "Possible, not confirmed"].filter(Boolean).join(" · ")}
                  {f.kind === "nodule" && f.status === "open" ? <Chip tone="urgent" icon="alert">Must not miss</Chip> : null}
                </p>
                {f.status === "tracked" ? <p className="xr-done"><Icon name="check" size={16} /> Tracked for follow-up</p>
                  : !mayDecide ? <p className="xr-note">Waiting for a doctor's decision.</p>
                  : dismissing?.id === f.id ? (
                    <form onSubmit={e => { e.preventDefault(); dismiss.mutate({ findingId: f.id, reason: dismissing.reason }); }}>
                      <Field label="Why dismiss it? Kept on record.">{c => <input {...c} autoFocus required maxLength={500} value={dismissing.reason} onChange={e => setDismissing({ id: f.id, reason: e.target.value })} />}</Field>
                      <div className="xr-actions">
                        <Button size="sm" variant="danger" type="submit" pending={dismiss.isPending} disabled={!dismissing.reason.trim()}>Dismiss finding</Button>
                        <Button size="sm" onClick={() => setDismissing(undefined)}>Keep it</Button>
                      </div>
                    </form>
                  ) : (
                    <div className="xr-actions">
                      <Button size="sm" variant="secondary" icon="check" pending={track.isPending && track.variables?.findingId === f.id} onClick={() => track.mutate({ findingId: f.id, requestId: crypto.randomUUID() })}>Confirm and track</Button>
                      <Button size="sm" icon="edit" onClick={() => setDismissing({ id: f.id, reason: "" })}>Dismiss</Button>
                    </div>
                  )}
                {mayAdd && visit && f.status !== "dismissed" && (
                  f.dueAt && +new Date(f.dueAt) === +new Date(visit.at) ? <p className="xr-done"><Icon name="check" size={16} /> {testOf(f.action)} added to the visit on {when(visit.at)}</p>
                  : adding === f.id ? (
                    <div className="xr-review">
                      <p className="xr-note">Will be added to the {visit.title.toLowerCase()} on {when(visit.at)}, tracked, and shown in the patient's Sona Care as:</p>
                      <p><strong>{testOf(f.action)}</strong> · {f.label}</p>
                      <div className="xr-actions">
                        <Button size="sm" variant="primary" icon="check" pending={addToVisit.isPending} onClick={() => addToVisit.mutate({ findingId: f.id, appointmentId: visit.id })}>Add to the visit</Button>
                        <Button size="sm" onClick={() => setAdding(undefined)}>Cancel</Button>
                      </div>
                    </div>
                  ) : <Button size="sm" icon="plus" onClick={() => setAdding(f.id)}>Add to the visit</Button>
                )}
              </div>
            ))}
            {(track.isError || dismiss.isError || addToVisit.isError) && <p className="xr-error" role="alert">{messageOf(track.error ?? dismiss.error ?? addToVisit.error)}</p>}
          </div>
        </Card>
      )}
    </>
  );

  return (
    <>
      <PageHeader title="X-ray" lead={lead} actions={
        hasImage && mayDetect
          ? <Button variant="primary" icon="scan" pending={detect.isPending} onClick={() => detect.mutate({ encounterId })}>Read for findings</Button>
          : mayUpload && encounterId && <Button variant="primary" icon="plus" pending={upload.isPending} onClick={() => picker.current?.click()}>Add X-ray</Button>
      } />
      <WithRail rail={
        <RightRail label="Sona's read">
          {open.length ? decide : null}
          {insight}
          {detect.isError && <p className="xr-error" role="alert">{messageOf(detect.error)}</p>}
          {open.length ? null : decide}
        </RightRail>
      }>
        <Card className="xr-viewer">
          <div className="xr-bar">
            <Field label="Patient">{c => (
              <Select label="Patient" {...c} value={encounterId} onChange={e => { setEncounterId(e.target.value); setZoom(1); setStream(undefined); setDismissing(undefined); upload.reset(); detect.reset(); }}>
                <option value="">{patients.isPending ? "Loading patients…" : patients.data?.length === 0 ? "No patients yet" : "Choose a patient"}</option>
                {patients.data?.map(p => <option key={p.encounterId} value={p.encounterId}>{p.name}</option>)}
              </Select>
            )}</Field>
            {shown && <ZoomSlider zoom={zoom} setZoom={setZoom} />}
          </div>
          {patients.isError && <p className="xr-error" role="alert">{messageOf(patients.error)}</p>}
          <input ref={picker} className="xr-file" type="file" accept="image/*" aria-label="Choose an X-ray image" tabIndex={-1} disabled={upload.isPending}
            onChange={e => { take(e.target.files?.[0]); e.target.value = ""; }} />
          <FilmStage src={stream ? undefined : shown} alt="Chest X-ray added for this visit" findings={onImage} zoom={zoom} setZoom={setZoom} data-over={over || undefined}
            onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); }}>
            {stream ? <video ref={video} className="xr-video" autoPlay playsInline muted />
              : shown ? null : (
                <div className="xr-drop">
                  <Icon name="scan" size={32} />
                  {encounterId && (read.isPending || (hasImage && stored.isPending)) ? <Skeleton width={220} height={18} /> : (
                    <>
                      <strong>{!encounterId ? "Choose a patient first" : hasImage ? "This visit's X-ray could not be fetched" : mayUpload ? "Drop a chest X-ray here" : "No X-ray for this visit yet"}</strong>
                      <span>{!encounterId ? "Then drop a chest X-ray here or choose a file."
                        : hasImage ? "Try again, or add it again here to see it."
                        : mayUpload ? "Or choose a file, or take a picture. PNG or JPEG."
                        : "Only doctors can add an X-ray."}</span>
                    </>
                  )}
                </div>
              )}
            {upload.isPending && <p className="xr-progress" role="status">Sending the image…</p>}
          </FilmStage>
          {upload.isError && <p className="xr-error" role="alert"><Icon name="alert" size={16} /> The image was not accepted: {messageOf(upload.error)}</p>}
          {cameraError && <p className="xr-error" role="alert">{cameraError}</p>}
          {encounterId && mayUpload && (
            <div className="xr-actions">
              {stream ? <><Button size="sm" variant="secondary" pending={upload.isPending} onClick={snap}>Take picture</Button><Button size="sm" onClick={() => setStream(undefined)}>Close camera</Button></>
                : <>
                  <Button size="sm" variant="secondary" icon="file" disabled={upload.isPending} onClick={() => picker.current?.click()}>{hasImage ? "Replace image" : "Choose file"}</Button>
                  <Button size="sm" onClick={openCamera}>Use webcam</Button>
                  {shown && <Button size="sm" icon="x" onClick={() => { setSent(undefined); setZoom(1); }}>Remove from view</Button>}
                </>}
            </div>
          )}
        </Card>
        {data && <Compare encounterId={encounterId} patientId={patients.data?.find(p => p.encounterId === encounterId)?.id}
          onOpen={f => setPeek({ encounterId: f.encounterId, title: filmTitle({ name: f.patientName, at: f.uploadedAt }), patientId: f.patientId })} />}
        <FilmArtifact film={peek} onClose={() => setPeek(undefined)} goLabel="Make this the current view" />
        {data && (data.findings.length > 4 || all.length > onImage.length) ? (
          <ListCard title="More from the draft">
            {data.findings.slice(4).map((f, i) => <ListRow key={`d${i}`} icon="scan" title={f} />)}
            {all.length > onImage.length ? <ListRow icon="file" title={`${all.length - onImage.length} other finding(s) on this visit`} caption="Not read from this image, so not drawn on it." /> : null}
          </ListCard>
        ) : null}
      </WithRail>
    </>
  );
}

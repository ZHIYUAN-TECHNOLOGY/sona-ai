import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icon";
import { InsightCard } from "@/components/insight-card";
import { PageHeader } from "@/components/page";
import { Button, Card, Chip, Field, ListCard, ListRow, Skeleton } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { boxStyle, messageOf, toBase64 } from "@/features/library/files";
import { client, orpc } from "@/lib/orpc";
import "@/styles/pages/xray.css";

export const Route = createFileRoute("/pro/_app/xray")({ component: Page });

function Page() {
  const { me } = Route.useRouteContext();
  const mayUpload = can(me.role, "xray.upload");
  const queryClient = useQueryClient();
  const patients = useQuery(orpc.patients.list.queryOptions());
  const [encounterId, setEncounterId] = useState("");
  // The image sent from this browser, by storage key: the server has no way to send a stored image back.
  const [sent, setSent] = useState<{ key: string; url: string }>();
  const [zoom, setZoom] = useState(1);
  const [stream, setStream] = useState<MediaStream>();
  const [cameraError, setCameraError] = useState<string>();
  const video = useRef<HTMLVideoElement>(null);

  const read = useQuery({ ...orpc.xray.read.queryOptions({ input: { encounterId } }), enabled: Boolean(encounterId), retry: false });
  const findings = useQuery({ ...orpc.findings.list.queryOptions({ input: { encounterId } }), enabled: Boolean(encounterId) });
  const refresh = () => Promise.all([orpc.xray.read.key(), orpc.findings.list.key()].map(queryKey => queryClient.invalidateQueries({ queryKey })));
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
  const shown = data && sent?.key === data.key ? sent.url : undefined;
  // Only findings the server marked as read from this very image are drawn on it.
  const all = findings.data ?? [];
  const onImage = data ? all.filter(f => f.imageKey === data.key && f.status !== "dismissed") : [];

  const mayDetect = can(me.role, "findings.detect");
  const mayDecide = can(me.role, "findings.track");
  const track = useMutation(orpc.findings.track.mutationOptions({ onSuccess: refresh }));
  const dismiss = useMutation(orpc.findings.dismiss.mutationOptions({ onSuccess: () => { setDismissing(undefined); return refresh(); } }));
  // The finding being dismissed and the reason typed so far: the server keeps the reason on record.
  const [dismissing, setDismissing] = useState<{ id: string; reason: string }>();
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const decision = useRef<HTMLDivElement>(null);
  const take = (file?: Blob | null) => { if (file && encounterId && mayUpload) upload.mutate(file); };

  // Anything the server does not mark as read by the model (a fixture, a waking model) is shown as a sample.
  const sample = Boolean(data) && data?.source !== "model";
  const open = onImage.filter(f => f.status === "open");
  const hasImage = Boolean(data);
  const lead = !encounterId ? "No patient chosen yet. Choose one to see or add a chest X-ray."
    : upload.isPending ? "Sending the image to be read…"
    : read.isPending ? "Looking for this visit's X-ray…"
    : !data ? "No image yet for this visit."
    : open.length ? `Draft ready to review: ${open.length} finding${open.length === 1 ? "" : "s"} waiting for your decision.`
    : "Draft ready to review. It is not a validated read: check it against the image.";

  return (
    <>
      <PageHeader title="X-ray" lead={lead} actions={
        hasImage && mayDetect
          ? <Button variant="primary" icon="scan" pending={detect.isPending} onClick={() => detect.mutate({ encounterId })}>Read for findings</Button>
          : mayUpload && <Button variant="primary" icon="plus" disabled={!encounterId} pending={upload.isPending} onClick={() => picker.current?.click()}>Add X-ray</Button>
      } />
      <WithRail rail={
        <RightRail label="Sona's read">
          <InsightCard label={sample ? "Sona · sample" : "Sona draft"}
            title={!data ? "No read yet" : sample ? "Sample read, not from this image" : "Chest X-ray draft read"}
            lead={!data ? (encounterId && read.isError ? messageOf(read.error) : "Sona drafts a read as soon as an image is added. You confirm or change it.")
              : data.findings[0] ?? "Nothing described on this image."}
            evidence={data ? [
              ...data.findings.slice(1, 4).map(text => ({ icon: "scan" as const, text })),
              { icon: "shield-check" as const, text: "Not validated: not a radiologist's report or a diagnosis." },
            ] : undefined}
            sources={data ? 1 + onImage.length : undefined}
            next={!data ? undefined : open.length
              ? { label: "Review findings", step: "Check each finding against the image, then track or dismiss it.", onAct: () => decision.current?.querySelector("button")?.focus() }
              : mayDetect ? { label: "Read for findings", step: "Have the image read for findings that must not be missed.", onAct: () => detect.mutate({ encounterId }) } : undefined} />
          {detect.isError && <p className="xr-error" role="alert">{messageOf(detect.error)}</p>}
          {data && (
            <Card title="Your decision">
              <div className="xr-decide" ref={decision}>
                {!onImage.length && <p className="xr-note">No findings to decide on yet. {mayDetect ? "Read the image for findings, then track or dismiss each one here." : "A doctor reads the image for findings."}</p>}
                {onImage.map((f, i) => (
                  <div key={f.id} className="xr-finding">
                    <p><span className="xr-num">{i + 1}</span>{f.label}</p>
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
                  </div>
                ))}
                {(track.isError || dismiss.isError) && <p className="xr-error" role="alert">{messageOf(track.error ?? dismiss.error)}</p>}
              </div>
            </Card>
          )}
        </RightRail>
      }>
        <Card className="xr-viewer">
          <div className="xr-bar">
            <Field label="Patient">{c => (
              <select {...c} value={encounterId} onChange={e => { setEncounterId(e.target.value); setZoom(1); setStream(undefined); setDismissing(undefined); upload.reset(); detect.reset(); }}>
                <option value="">{patients.isPending ? "Loading patients…" : "Choose a patient"}</option>
                {patients.data?.map(p => <option key={p.encounterId} value={p.encounterId}>{p.name}</option>)}
              </select>
            )}</Field>
            {shown && (
              <label className="xr-zoom">Zoom
                <input type="range" min={1} max={4} step={0.25} value={zoom} onChange={e => setZoom(Number(e.target.value))} />
              </label>
            )}
          </div>
          {patients.isError && <p className="xr-error" role="alert">{messageOf(patients.error)}</p>}
          <input ref={picker} className="xr-file" type="file" accept="image/*" aria-label="Choose an X-ray image" tabIndex={-1} disabled={upload.isPending}
            onChange={e => { take(e.target.files?.[0]); e.target.value = ""; }} />
          <div className="xr-stage" data-over={over || undefined}
            onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); }}>
            {stream ? <video ref={video} className="xr-video" autoPlay playsInline muted />
              : shown ? (
                <div className="xr-scroll">
                  <div className="xr-image" style={zoom > 1 ? { width: `${zoom * 100}%` } : undefined}>
                    <img src={shown} alt="Chest X-ray added for this visit" />
                    {onImage.map((f, i) => f.location.box && <div key={f.id} className="xr-box" style={boxStyle(f.location.box)}><span>{i + 1}</span></div>)}
                  </div>
                </div>
              ) : (
                <div className="xr-drop">
                  <Icon name="scan" size={32} />
                  {encounterId && read.isPending ? <Skeleton width={220} height={18} /> : (
                    <>
                      <strong>{!encounterId ? "Choose a patient first" : hasImage ? "This visit's X-ray was added elsewhere" : mayUpload ? "Drop a chest X-ray here" : "No X-ray for this visit yet"}</strong>
                      <span>{!encounterId ? "Then drop a chest X-ray here or choose a file."
                        : hasImage ? "It cannot be shown in this browser yet. Add it again here to see it."
                        : mayUpload ? "Or choose a file, or take a picture. PNG or JPEG."
                        : "Only doctors can add an X-ray."}</span>
                    </>
                  )}
                </div>
              )}
            {upload.isPending && <p className="xr-progress" role="status">Sending the image…</p>}
          </div>
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
        {data && (
          <ListCard title="What the draft describes">
            {data.findings.map((f, i) => <ListRow key={`d${i}`} icon="scan" title={f} caption="Draft wording. Check it against the image." />)}
            {onImage.map((f, i) => (
              <ListRow key={f.id} leading={<span className="xr-num">{i + 1}</span>} title={f.label}
                caption={[f.location.zone, f.sizeMm ? `${f.sizeMm} mm` : null, f.status === "tracked" ? "Tracked" : "Possible, not confirmed"].filter(Boolean).join(" · ")}
                trailing={f.kind === "nodule" && f.status === "open" ? <Chip tone="urgent" icon="alert">Must not miss</Chip> : undefined} />
            ))}
            {!data.findings.length && !onImage.length && <ListRow icon="check" title="Nothing described" caption="The draft names no findings on this image." />}
            {all.length > onImage.length && <ListRow icon="file" title={`${all.length - onImage.length} other finding(s) on this visit`} caption="Not read from this image, so not drawn on it." />}
          </ListCard>
        )}
      </WithRail>
    </>
  );
}

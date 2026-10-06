import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { EmptyState, PageHeader } from "@/components/page";
import { Button, Chip, Field } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { boxStyle, messageOf, toBase64 } from "@/features/library/files";
import { client, orpc } from "@/lib/orpc";
import "@/styles/pages/library.css";

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

  return (
    <>
      <PageHeader title="X-ray" lead="Add a film and see what the image model describes. Not a validated read." />
      <div className="lib-form">
        <Field label="Patient">{c => (
          <select {...c} style={{ maxWidth: "22rem" }} value={encounterId} onChange={e => { setEncounterId(e.target.value); setZoom(1); upload.reset(); detect.reset(); }}>
            <option value="">{patients.isPending ? "Loading patients…" : "Choose a patient"}</option>
            {patients.data?.map(p => <option key={p.encounterId} value={p.encounterId}>{p.name}</option>)}
          </select>
        )}</Field>
        {patients.isError && <p className="lib-error" role="alert">{messageOf(patients.error)}</p>}
        {encounterId && (mayUpload ? (
          <div className="lib-row">
            <input type="file" accept="image/*" capture="environment" aria-label="Choose or take an X-ray image" disabled={upload.isPending}
              onChange={e => { const file = e.target.files?.[0]; if (file) upload.mutate(file); e.target.value = ""; }} />
            {stream ? <><Button variant="primary" pending={upload.isPending} onClick={snap}>Take picture</Button><Button onClick={() => setStream(undefined)}>Close camera</Button></>
              : <Button onClick={openCamera}>Use webcam</Button>}
            {upload.isPending && <span className="lib-note" role="status">Sending the image…</span>}
          </div>
        ) : <p className="lib-note">Only doctors can add an X-ray. You can see the latest read.</p>)}
        {cameraError && <p className="lib-error" role="alert">{cameraError}</p>}
        {upload.isError && <p className="lib-error" role="alert">{messageOf(upload.error)}</p>}
      </div>
      {stream && <video ref={video} className="xray-video" autoPlay playsInline muted />}

      {!encounterId ? <EmptyState>Choose a patient to see or add an X-ray.</EmptyState>
        : read.isPending ? <EmptyState>Reading the image…</EmptyState>
        : read.isError || !data ? <EmptyState>{messageOf(read.error)}</EmptyState>
        : (
          <WithRail rail={
            <RightRail label="Findings">
              <div className="lib-row">
                <Chip tone="soon">Not a validated read</Chip>
                {data.source === "fixture" && <Chip>Sample, not read from this image</Chip>}
              </div>
              <p className="lib-note">Unvalidated: not a radiologist's report or a diagnosis. Check it against the image.</p>
              {data.findings.length ? <ul className="xray-findings">{data.findings.map((f, i) => <li key={i}>{f}</li>)}</ul> : <p>Nothing described.</p>}
              {onImage.length > 0 && <ol className="xray-findings">{onImage.map(f => <li key={f.id}>{f.label} <span className="lib-note">{f.location.zone}</span></li>)}</ol>}
              {all.length > onImage.length && <p className="lib-note">{all.length - onImage.length} other finding(s) on this visit were not read from this image, so they are not drawn on it.</p>}
              {can(me.role, "findings.detect") && <Button pending={detect.isPending} onClick={() => detect.mutate({ encounterId })}>Read this image for findings</Button>}
              {detect.isError && <p className="lib-error" role="alert">{messageOf(detect.error)}</p>}
            </RightRail>
          }>
            {shown ? (
              <>
                <div className="lib-row lib-form">
                  <label className="lib-row">Zoom <input type="range" min={1} max={4} step={0.25} value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
                  <Button disabled={zoom === 1} onClick={() => setZoom(1)}>Reset</Button>
                </div>
                <div className="xray-stage">
                  <div className="xray-image" style={{ transform: `scale(${zoom})` }}>
                    <img src={shown} alt="Uploaded X-ray" />
                    {onImage.map((f, i) => f.location.box && <div key={f.id} className="xray-box" style={boxStyle(f.location.box)}><span>{i + 1}</span></div>)}
                  </div>
                </div>
              </>
            ) : <EmptyState>This visit has an X-ray, but it was added elsewhere and cannot be shown here yet. Add it again from this browser to see it.</EmptyState>}
          </WithRail>
        )}
    </>
  );
}

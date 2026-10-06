import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useEffect, useRef, useState } from "react";

import { Button, Card, Chip } from "@/components/primitives";
import { refusal } from "@/features/visit/visit";
import { orpc } from "@/lib/orpc";

import { checkedCount, type Draft, draftOf, kept, SECTIONS } from "./draft";
import { toBase64, toJpeg } from "./image";
import { originLine } from "./reasoning";

const CHANGE = { new: "New", changed: "Changed", stopped: "Stopped", continue: "Continue" } as const;

/** Photo of a handwritten note → Sona's reading as a proposal → only the doctor's ticked items into the record. */
export function Scan({ encounterId, allowed }: { encounterId: string; allowed: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string>();
  const [image, setImage] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  // One id per reading, so pressing the button twice writes once.
  const [requestId, setRequestId] = useState("");
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!camera) return;
    let stream: MediaStream | undefined, gone = false;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" } }).then(s => {
      if (gone) return s.getTracks().forEach(t => t.stop());
      stream = s;
      if (video.current) video.current.srcObject = s;
    }).catch(() => { setCamera(false); setCameraError("The camera is not available. Allow it in the browser, or choose a photo."); });
    if (!navigator.mediaDevices) { setCamera(false); setCameraError("This browser has no camera access. Choose a photo."); }
    return () => { gone = true; stream?.getTracks().forEach(t => t.stop()); };
  }, [camera]);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image); }, [image]);

  const read = useMutation({
    mutationFn: async (blob: Blob) => {
      const { key } = await orpc.scan.upload.call({ encounterId, contentType: "image/jpeg", dataBase64: await toBase64(blob) });
      return { key, reading: await orpc.scan.read.call({ encounterId, key }) };
    },
    onSuccess: ({ reading }) => { setDraft(draftOf(reading)); setRequestId(crypto.randomUUID()); },
  });
  const apply = useMutation(orpc.scan.apply.mutationOptions({
    onSuccess: () => {
      setDraft(undefined); setImage(undefined); read.reset();
      for (const queryKey of [orpc.note.get.key({ input: { encounterId } }), orpc.encounter.get.key({ input: { encounterId } }), orpc.patients.list.key()]) void queryClient.invalidateQueries({ queryKey });
    },
  }));

  if (!allowed) return <Card title="Scan a handwritten note"><p className="visit-muted">Only doctors can scan a handwritten note into the record.</p></Card>;

  const start = (blob: Blob) => { setCamera(false); setDraft(undefined); apply.reset(); setImage(URL.createObjectURL(blob)); read.mutate(blob); };
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try { const bitmap = await createImageBitmap(file); start(await toJpeg(bitmap, bitmap.width, bitmap.height)); }
    catch { setCameraError("This file is not a picture Sona can read. Choose a photo."); }
  };
  const snap = async () => { const v = video.current; if (v?.videoWidth) start(await toJpeg(v, v.videoWidth, v.videoHeight)); };
  const edit = (change: (d: Draft) => Draft) => setDraft(d => d && change(d));

  if (!open) {
    return (
      <Card title="Scan a handwritten note">
        <p className="visit-muted">Photograph a paper note. Sona reads it, you check each item, and only what you tick is added.</p>
        <div className="visit-actions"><Button variant="secondary" icon="scan" onClick={() => setOpen(true)}>Scan a note</Button></div>
      </Card>
    );
  }
  const reading = read.data?.reading;
  const origin = reading && originLine(reading);
  const count = draft ? checkedCount(draft) : 0;
  const unsure = reading?.lines.filter(l => l.confidence === "low").length ?? 0;
  return (
    <Card title="Scan a handwritten note">
      <div className="visit-actions vt-capture">
        <label className="vt-file">Choose or take a photo<input type="file" accept="image/*" capture="environment" onChange={choose} /></label>
        <Button onClick={() => { setCameraError(undefined); setCamera(c => !c); }}>{camera ? "Close the camera" : "Use this computer's camera"}</Button>
        <Button onClick={() => { setCamera(false); setOpen(false); }}>Close</Button>
      </div>
      {cameraError ? <p className="visit-refused" role="alert">{cameraError}</p> : null}
      {camera ? <div className="vt-camera"><video ref={video} autoPlay playsInline muted /><Button variant="primary" onClick={snap}>Take the photo</Button></div> : null}
      {read.isPending ? <p className="visit-muted" role="status">Sona is reading the note…</p> : null}
      {read.isError ? <p className="visit-refused" role="alert">{refusal(read.error).message}</p> : null}
      {apply.data ? <p className="vt-done" role="status">{apply.data.line}</p> : null}
      {image && !camera ? (
        <div className="vt-review">
          <img className="vt-photo" src={image} alt="The photographed note" />
          {reading && draft ? (
            <div className="vt-reading">
              {origin ? <p className="vt-origin"><Chip tone="amber">Sample</Chip> {origin}</p> : null}
              <h3>Sona's reading</h3>
              <p className="vt-answer">{reading.lines.map((l, i) => l.confidence === "low" ? <mark key={i} title="Sona is unsure of this word">{l.text}</mark> : l.text)}</p>
              <p className="visit-muted">{unsure ? `${unsure} highlighted ${unsure === 1 ? "word" : "words"} to check against the photo.` : "Sona marked no words as unsure."}</p>
              <h3>Proposed for the record</h3>
              {SECTIONS.map(([key, label]) => draft.sections[key].text || reading.sections[key] ? (
                <label key={key} className="vt-item">
                  <input type="checkbox" checked={draft.sections[key].on} onChange={e => edit(d => ({ ...d, sections: { ...d.sections, [key]: { ...d.sections[key], on: e.target.checked } } }))} aria-label={`Add ${label}`} />
                  <span>{label}<textarea rows={2} value={draft.sections[key].text} onChange={e => edit(d => ({ ...d, sections: { ...d.sections, [key]: { ...d.sections[key], text: e.target.value } } }))} /></span>
                </label>
              ) : null)}
              {draft.medicines.map((m, i) => {
                const set = (patch: Partial<typeof m>) => edit(d => ({ ...d, medicines: d.medicines.map((x, j) => j === i ? { ...x, ...patch } : x) }));
                return (
                  <div key={i} className="vt-item">
                    <input type="checkbox" checked={m.on} onChange={e => set({ on: e.target.checked })} aria-label={`Add medicine ${m.name}`} />
                    <span>Medicine · {CHANGE[m.change]} {m.confidence === "low" ? <Chip tone="amber" icon="alert">Check this</Chip> : null}
                      <span className="vt-fields">
                        <input value={m.name} onChange={e => set({ name: e.target.value })} aria-label="Medicine name" />
                        <input value={m.dose ?? ""} onChange={e => set({ dose: e.target.value })} aria-label="Dose" placeholder="Dose" />
                        <input value={m.frequency ?? ""} onChange={e => set({ frequency: e.target.value })} aria-label="Frequency" placeholder="Frequency" />
                      </span>
                    </span>
                  </div>
                );
              })}
              {draft.tasks.map((t, i) => {
                const set = (patch: Partial<typeof t>) => edit(d => ({ ...d, tasks: d.tasks.map((x, j) => j === i ? { ...x, ...patch } : x) }));
                return (
                  <label key={i} className="vt-item">
                    <input type="checkbox" checked={t.on} onChange={e => set({ on: e.target.checked })} aria-label={`Add task ${t.title}`} />
                    <span>Task{t.due ? ` · due ${t.due}` : ""}<input value={t.title} onChange={e => set({ title: e.target.value })} /></span>
                  </label>
                );
              })}
              {draft.followUp ? (
                <label className="vt-item">
                  <input type="checkbox" checked={draft.followUp.on} onChange={e => edit(d => ({ ...d, followUp: { ...d.followUp!, on: e.target.checked } }))} aria-label="Add follow-up" />
                  <span>Book follow-up in<input value={draft.followUp.text} onChange={e => edit(d => ({ ...d, followUp: { ...d.followUp!, text: e.target.value } }))} /></span>
                </label>
              ) : null}
              {apply.isError ? <p className="visit-refused" role="alert">{refusal(apply.error).message}</p> : null}
              <div className="visit-actions">
                <Button variant="primary" icon="check" disabled={!count} pending={apply.isPending}
                  onClick={() => apply.mutate({ encounterId, key: read.data!.key, requestId, ...kept(draft) })}>
                  {count ? `Add the ${count} checked ${count === 1 ? "item" : "items"}` : "Nothing is checked"}
                </Button>
                <span className="visit-muted">Nothing enters the record until you press this.</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

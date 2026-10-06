import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { Button, Card, Chip, Field } from "@/components/primitives";
import { client, orpc } from "@/lib/orpc";

/**
 * "Add a medicine from a photo", worded as the phone app (apps/care/features/doses/photo.tsx): the photo is read
 * (care.readMedicinePhoto), the patient checks and can correct it, and it goes to the care team as a message.
 * Nothing joins their medicines until the care team confirms it.
 */
type Reading = { name: string; dose: string; how: string };
type Step =
  | { kind: "choose"; error?: string }
  | { kind: "camera" }
  | { kind: "reading" }
  | { kind: "read"; key?: string; reading: Reading; note?: string; sample: boolean }
  | { kind: "sent"; med: string };

const medLine = (r: Reading) => [r.name, r.dose, r.how].map(s => s.trim()).filter(Boolean).join(", ");
const FIELDS = [["name", "Medicine"], ["dose", "Dose"], ["how", "How often"]] as const;

export function MedicinePhoto() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | undefined>(undefined);
  const requestId = useRef(crypto.randomUUID());

  const stopCamera = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = undefined; };
  useEffect(() => stopCamera, []);

  async function read(dataUrl: string) {
    const [head, dataBase64] = dataUrl.split(",");
    const contentType = /^data:(image\/[a-z0-9.+-]+)/i.exec(head ?? "")?.[1];
    if (!contentType || !dataBase64) { setStep({ kind: "choose", error: "That is not a photo. Choose a photo of the box or letter." }); return; }
    if (dataBase64.length > 14_000_000) { setStep({ kind: "choose", error: "That photo is too large. Choose a smaller one." }); return; }
    setStep({ kind: "reading" });
    try {
      const r = await client.care.readMedicinePhoto({ photo: { contentType, dataBase64 } });
      // A fixture answer is not a reading of this photo: say so, and let them type it in.
      const sample = r.source === "fixture";
      const note = sample
        ? (r.waking ? `Photo reading is starting (about ${r.waking} min). Type the medicine in below, or try again then.` : "We couldn't read a medicine on this photo. Type it in below, or take another photo.")
        : !r.name.trim() ? "We couldn't read a medicine on this photo. Type it in below, or take another photo." : undefined;
      setStep({ kind: "read", key: r.key, sample, note, reading: sample ? { name: "", dose: "", how: "" } : { name: r.name, dose: r.dose ?? "", how: r.frequency ?? "" } });
    } catch { setStep({ kind: "choose", error: "We couldn't read that photo. Try again." }); }
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => void read(String(reader.result));
    reader.onerror = () => setStep({ kind: "choose", error: "We couldn't read that photo. Try again." });
    reader.readAsDataURL(file);
  }

  async function openCamera() {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setStep({ kind: "camera" });
    } catch { setStep({ kind: "choose", error: "No camera here. Choose a photo." }); }
  }
  useEffect(() => {
    if (step.kind === "camera" && video.current && stream.current) video.current.srcObject = stream.current;
    if (step.kind !== "camera") stopCamera();
  }, [step.kind]);

  function snap() {
    const v = video.current;
    if (!v?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext("2d")?.drawImage(v, 0, 0);
    void read(canvas.toDataURL("image/jpeg", 0.85));
  }

  async function send() {
    if (step.kind !== "read" || sending || !step.reading.name.trim()) return;
    const med = medLine(step.reading), { name, dose, how } = step.reading;
    setSending(true); setSendError(undefined);
    try {
      await client.care.messages.send({
        text: `Please check a medicine I added from a photo: ${med}.`, requestId: requestId.current,
        attachment: { kind: "medicine-photo", key: step.key, reading: { name: name.trim(), dose: dose.trim() || undefined, frequency: how.trim() || undefined } },
      });
      void queryClient.invalidateQueries({ queryKey: orpc.care.messages.key() });
      requestId.current = crypto.randomUUID();
      setStep({ kind: "sent", med });
    } catch { setSendError("Not sent. Check your connection and try again."); }
    finally { setSending(false); }
  }

  return (
    <Card title="Add a medicine from a photo">
      <div className="med-photo" aria-live="polite">
        {step.kind === "choose" && <>
          <p>Photograph the medicine box or the letter. We read it, you check it, and your care team confirms it.</p>
          {step.error && <p role="alert" className="med-note">{step.error}</p>}
          <div className="med-actions">
            <Button variant="primary" onClick={() => void openCamera()}>Take photo</Button>
            <label className="btn btn-quiet med-file">Choose a photo<input type="file" accept="image/*" capture="environment" onChange={onFile} /></label>
          </div>
        </>}
        {step.kind === "camera" && <>
          <video ref={video} autoPlay playsInline muted className="med-video" aria-label="Camera" />
          <div className="med-actions">
            <Button variant="primary" onClick={snap}>Take photo</Button>
            <Button onClick={() => setStep({ kind: "choose" })}>Cancel</Button>
          </div>
        </>}
        {step.kind === "reading" && <p>Reading your photo…</p>}
        {step.kind === "read" && <>
          {step.note ? <p className="med-note">{step.note}</p> : <p><Chip tone="soon">We read</Chip> <strong>{medLine(step.reading)}</strong></p>}
          <p>Check it against the box. Correct anything that is wrong.</p>
          {FIELDS.map(([k, label]) => (
            <Field key={k} label={label}>
              {control => <input {...control} className="med-input" value={step.reading[k]} onChange={e => setStep({ ...step, reading: { ...step.reading, [k]: e.target.value } })} />}
            </Field>
          ))}
          <p className="med-muted">It isn't added to your medicines until your care team checks it.</p>
          {sendError && <p role="alert" className="med-note">{sendError}</p>}
          <div className="med-actions">
            <Button variant="primary" pending={sending} disabled={!step.reading.name.trim()} onClick={() => void send()}>Send to my care team to check</Button>
            <Button onClick={() => setStep({ kind: "choose" })}>Take another photo</Button>
          </div>
        </>}
        {step.kind === "sent" && <>
          <p><Chip tone="soon">Waiting for your care team</Chip></p>
          <p>Sent to your care team. They will add {step.med} or decline it. You'll see their reply in Messages.</p>
          <div className="med-actions"><Button onClick={() => setStep({ kind: "choose" })}>Add another</Button></div>
        </>}
      </div>
    </Card>
  );
}

import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { Button, Field } from "@/components/primitives";
import { orpc } from "@/lib/orpc";
import { startRecording, type Recording } from "@/lib/recorder";

import { toBase64, type Lang } from "./model";

type Props = { lang: Lang; pending: boolean; error?: string; onSend: (text: string) => void };

/** The reply in place: type it, or hold "Say it instead" and check the words before sending. */
export function ReplyForm({ lang, pending, error, onSend }: Props) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState<string>();
  // The promise, so a quick release still stops a recording that is only just starting.
  const rec = useRef<Promise<Recording> | null>(null);
  const transcribe = useMutation(orpc.care.transcribe.mutationOptions());

  const start = () => {
    if (rec.current) return;
    setMicError(undefined);
    setRecording(true);
    rec.current = startRecording();
    rec.current.catch(() => { rec.current = null; setRecording(false); setMicError("We could not use your microphone. Please type instead."); });
  };
  const stop = async () => {
    const started = rec.current;
    if (!started) return;
    rec.current = null;
    setRecording(false);
    try {
      const wav = await (await started).stop();
      const heard = await transcribe.mutateAsync({ audio: toBase64(wav), language: lang });
      if (heard.text.trim()) setText(heard.text.trim());
      else setMicError("We did not hear any words. Hold the button and try again.");
    } catch (e) {
      setMicError(e instanceof Error ? e.message : "We could not hear that. Please type instead.");
    }
  };
  const isHoldKey = (key: string) => key === " " || key === "Enter";

  return (
    <form className="reply" onSubmit={e => { e.preventDefault(); if (text.trim()) onSend(text.trim()); }}>
      <Field label="Your reply" hint="Check the words before you send." error={error ?? micError}>
        {control => <textarea {...control} rows={3} maxLength={1000} value={text} onChange={e => setText(e.target.value)} placeholder="Tell us how you feel today." />}
      </Field>
      <div className="reply-actions">
        <Button variant="primary" type="submit" pending={pending} disabled={!text.trim()}>Send to my care team</Button>
        <Button
          className={recording ? "reply-recording" : undefined}
          pending={transcribe.isPending}
          aria-pressed={recording}
          onPointerDown={start}
          onPointerUp={() => { void stop(); }}
          onPointerLeave={() => { void stop(); }}
          onKeyDown={e => { if (isHoldKey(e.key) && !e.repeat) start(); }}
          onKeyUp={e => { if (isHoldKey(e.key)) void stop(); }}
        >
          {recording ? "Listening… let go when done" : transcribe.isPending ? "Writing your words…" : "Say it instead (hold)"}
        </Button>
      </div>
    </form>
  );
}

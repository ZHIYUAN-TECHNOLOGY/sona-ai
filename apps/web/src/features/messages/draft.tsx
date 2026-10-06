import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";

import { Button, Chip, Field } from "@/components/primitives";
import { type client, orpc } from "@/lib/orpc";

import { labelTone, triageBy } from "./format";

export type Draft = NonNullable<Awaited<ReturnType<typeof client.messages.draft>>>;

/** What the draft procedure returns about the draft, as checks a clinician reads before sending. */
export function DraftChecks({ draft }: { draft: Draft }) {
  return (
    <ul className="msg-checks">
      <li><Chip tone={labelTone(draft.label)}>{draft.label}</Chip> {triageBy(draft.triagedBy)}</li>
      <li>
        {draft.source === "model"
          ? <>Drafted by Sona ({draft.model})</>
          : <><Chip>Sample</Chip> {draft.waking ? "The model is waking; this is a rule-based sample draft" : "Rule-based sample draft, not a model's"}</>}
      </li>
    </ul>
  );
}

/** The numbered sources the draft stands on: the message it answers and the triage reading. */
export function DraftSources({ draft, asked }: { draft: Draft; asked?: string }) {
  return (
    <ol className="msg-sources">
      <li>Patient's message{asked ? <>: <q>{asked}</q></> : null}</li>
      <li>Triage: {draft.reason}</li>
    </ol>
  );
}

/**
 * Sona's reply as a proposal, editable in place. Nothing is sent until the clinician presses send on the text they
 * see. With no draft it is a plain reply box. `extra` sits beside the buttons (the review queue's Dismiss).
 */
export function ReplyEditor({ patientId, draft, sendLabel = "Send reply", extra }: { patientId: string; draft: Draft | null; sendLabel?: string; extra?: ReactNode }) {
  const queryClient = useQueryClient();
  // One id per draft shown, so a retried send is the same send.
  const [requestId] = useState(() => crypto.randomUUID());
  const done = () => queryClient.invalidateQueries({ queryKey: orpc.messages.key() });
  const reply = useMutation(orpc.messages.reply.mutationOptions({ onSuccess: done }));
  const handle = useMutation(orpc.messages.handle.mutationOptions({ onSuccess: done }));
  const send = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = String(new FormData(e.currentTarget).get("text") ?? "").trim();
    if (text) reply.mutate({ patientId, text, requestId });
  };
  const error = reply.error ?? handle.error;
  return (
    <form className="msg-editor" onSubmit={send}>
      <Field label={draft ? "Sona drafted a reply · check before sending" : "Reply"} error={error?.message}>
        {c => <textarea {...c} name="text" rows={6} maxLength={1000} required defaultValue={draft?.text ?? ""} />}
      </Field>
      <div className="msg-actions">
        <Button type="submit" variant="primary" pending={reply.isPending}>{sendLabel}</Button>
        {draft ? <Button pending={handle.isPending} onClick={() => handle.mutate({ patientId })}>Mark handled</Button> : null}
        {extra}
      </div>
    </form>
  );
}

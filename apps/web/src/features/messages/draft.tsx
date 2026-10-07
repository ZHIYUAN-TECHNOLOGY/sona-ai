import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";

import { Button, Chip, Field } from "@/components/primitives";
import { countOf, formatNumber } from "@/lib/format";
import { type client, orpc } from "@/lib/orpc";

import { modelName } from "@sona-ai/domain/model-names";

import { labelTone, triageBy } from "./format";

/** messages.reply takes 1,000 characters; a model's draft is unbounded. */
const MAX_REPLY = 1000;

export type Draft = NonNullable<Awaited<ReturnType<typeof client.messages.draft>>>;

/** What the draft procedure returns about the draft, as checks a clinician reads before sending. */
export function DraftChecks({ draft }: { draft: Draft }) {
  return (
    <ul className="msg-checks">
      <li><Chip tone={labelTone(draft.label)}>{draft.label}</Chip> {triageBy(draft.triagedBy)}</li>
      <li>
        {draft.source === "model"
          ? <>Drafted by {modelName(draft.model)}</>
          : <><Chip>Sample</Chip> {draft.waking ? "The model is waking, so this was written from rules" : "Written from rules, not by a model"}</>}
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
 * see. With no draft it is a plain reply box. `extra` sits beside the buttons (the review queue's Dismiss);
 * `onSent` runs once the reply is sent.
 */
export function ReplyEditor({ patientId, draft, sendLabel = "Send reply", extra, onSent }: { patientId: string; draft: Draft | null; sendLabel?: string; extra?: ReactNode; onSent?: () => void }) {
  const queryClient = useQueryClient();
  // One id per draft shown, so a retried send is the same send.
  const [requestId] = useState(() => crypto.randomUUID());
  // A draft longer than a reply may be is said before sending, not by a failed send.
  const [text, setText] = useState(draft?.text ?? "");
  const length = text.trim().length;
  const over = length - MAX_REPLY;
  const done = () => queryClient.invalidateQueries({ queryKey: orpc.messages.key() });
  const reply = useMutation(orpc.messages.reply.mutationOptions({ onSuccess: () => { onSent?.(); return done(); } }));
  const handle = useMutation(orpc.messages.handle.mutationOptions({ onSuccess: done }));
  const send = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (length && over <= 0) reply.mutate({ patientId, text: text.trim(), requestId });
  };
  const error = (reply.error ?? handle.error)?.message
    ?? (over > 0 ? `${formatNumber(length)} characters: a reply can be ${formatNumber(MAX_REPLY)}. Shorten it by ${countOf(over, "character")} before sending.` : undefined);
  return (
    <form className="msg-editor" onSubmit={send}>
      <Field label={draft ? "Check before sending" : "Reply"} error={error}>
        {c => <textarea {...c} name="text" rows={6} maxLength={MAX_REPLY} required value={text} onChange={e => setText(e.target.value)} />}
      </Field>
      <div className="msg-actions">
        <Button type="submit" variant="primary" pending={reply.isPending} disabled={over > 0}>{sendLabel}</Button>
        {draft ? <Button pending={handle.isPending} onClick={() => handle.mutate({ patientId })}>Mark handled</Button> : null}
        {extra}
      </div>
    </form>
  );
}

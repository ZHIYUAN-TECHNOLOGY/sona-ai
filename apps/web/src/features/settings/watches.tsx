import { can, type Role } from "@sona-ai/api/roles";
import { MAX_WATCHES, parseWatch } from "@sona-ai/domain/watch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Button, Card, Field } from "@/components/primitives";
import { orpc } from "@/lib/orpc";

import { hospitalTime, hourLabel } from "./rules";

type Spec = { root: string; elements: Record<string, { type: string; props: Record<string, unknown>; children?: string[] }> };
/** A watch's latest answer, read loosely: the ask bar's answer plus when it was asked. */
type Last = { at: string; source?: string; retried?: true; unanswered?: unknown; waking?: number; spec?: Spec } | null;

// ponytail: the answer's plain text only (lead, rows, review), as the Sona bar shows it; its actions stay on Today.
function AnswerText({ spec }: { spec?: Spec }) {
  const parts = (spec?.elements[spec.root]?.children ?? []).map(id => spec!.elements[id]);
  const lines = parts.flatMap(part =>
    part?.type === "AskLead" ? [String(part.props.text)]
    : part?.type === "AskRows" ? (part.props.rows as { title: string; detail: string }[]).map(row => (row.detail ? `${row.title}: ${row.detail}` : row.title))
    : part?.type === "AskReview" ? [String(part.props.title), ...(part.props.items as string[])]
    : []);
  if (!lines.length) return <p className="settings-muted">Sona answered; open Today to read it.</p>;
  return <ul className="settings-answer">{lines.map((line, i) => <li key={i}>{line}</li>)}</ul>;
}

function Latest({ last, hour }: { last: Last; hour: number }) {
  if (!last) return <p className="settings-muted">First answer at {hourLabel(hour)}.</p>;
  if (last.source === "model") return <AnswerText spec={last.spec} />;
  return (
    <p className="settings-muted">
      {last.unanswered !== undefined ? "Sona couldn't answer this from the results and tasks."
        : last.source === "fixture" ? "Sona's model isn't switched on here, so there is no answer yet."
        : last.waking && !last.retried ? "Sona's model is starting. This is asked again in about 5 min."
        : `Sona's model wasn't ready. This is asked again at ${hourLabel(hour)}.`}
    </p>
  );
}

/** The clinician's own standing questions: each one's latest answer, stop one, start one (reviewed before it starts). */
export function Watches({ role }: { role: Role }) {
  const queryClient = useQueryClient();
  const list = useQuery(orpc.watches.list.queryOptions());
  const reread = () => queryClient.invalidateQueries({ queryKey: orpc.watches.list.key() });
  const [text, setText] = useState("");
  // One id per watch being written, so sending it twice keeps one watch.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const create = useMutation(orpc.watches.create.mutationOptions({ onSuccess: () => { setText(""); setRequestId(crypto.randomUUID()); return reread(); } }));
  const remove = useMutation(orpc.watches.remove.mutationOptions({ onSuccess: reread }));

  const watches = list.data ?? [];
  const draft = text.trim() ? parseWatch(text) : undefined;
  const full = watches.length >= MAX_WATCHES;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft?.question) create.mutate({ requestId, question: draft.question, hour: draft.hour });
  };

  return (
    <Card title="Watches">
      <p className="settings-muted">Questions Sona asks once a day and answers on Today. A watch only reads; it never changes a record.</p>
      {list.isPending ? <p className="settings-muted">Reading your watches…</p>
        : list.isError ? <p className="settings-muted" role="alert">Your watches couldn't be read. {list.error.message}</p>
        : watches.length === 0 ? <p className="settings-muted">You have no watches yet.</p>
        : (
          <ul className="settings-watches">
            {watches.map(watch => (
              <li key={watch.id}>
                <div className="settings-watch-head">
                  <div>
                    <p className="settings-lead">{watch.question}</p>
                    <p className="settings-muted">Daily at {hourLabel(watch.hour)}{watch.last ? ` · asked ${hospitalTime(new Date(watch.last.at))}` : ""}</p>
                  </div>
                  {can(role, "watches.remove") ? (
                    <Button pending={remove.isPending && remove.variables?.watchId === watch.id} onClick={() => remove.mutate({ watchId: watch.id })}>Stop watching</Button>
                  ) : null}
                </div>
                <Latest last={watch.last as unknown as Last} hour={watch.hour} />
              </li>
            ))}
          </ul>
        )}
      {remove.isError ? <p className="field-error" role="alert">{remove.error.message}</p> : null}
      {!can(role, "watches.create") ? <p className="settings-muted">Your role can't start a watch.</p>
        : full ? <p className="settings-muted">You can keep {MAX_WATCHES} watches. Stop one to start another.</p>
        : (
          <form className="settings-form" onSubmit={submit}>
            <Field label="Start a watch" hint="Say what to ask and when, such as “Every morning at 7, who has a potassium result above 5?”" error={create.isError ? create.error.message : undefined}>
              {control => <input {...control} value={text} maxLength={500} onChange={event => { create.reset(); setText(event.target.value); }} />}
            </Field>
            {draft?.question ? (
              <div className="settings-review">
                <p className="settings-lead">{draft.question}</p>
                <p>Every day at {hourLabel(draft.hour)} · from the hospital's lab results and open tasks</p>
                <div className="settings-actions">
                  <Button type="submit" variant="primary" pending={create.isPending}>{create.isPending ? "Starting…" : "Start watching"}</Button>
                </div>
              </div>
            ) : null}
          </form>
        )}
    </Card>
  );
}

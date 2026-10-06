import { can, refusal, type Role } from "@sona-ai/api/roles";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type MouseEvent, useState } from "react";

import { Avatar, Button, Card, Chip } from "@/components/primitives";
import { type client, orpc } from "@/lib/orpc";

import { splitMarkers } from "./markers";

export type SummaryItem = Awaited<ReturnType<typeof client.review.list>>[number];
type Check = SummaryItem["checks"][number];
/** What the page says once a card has left the queue. `checks` are the server's re-run on an edited text. */
export type Done = { id: string; name: string; outcome: "approved" | "dismissed"; checks?: Check[] };

const KIND = { note: "Visit note", prescription: "Prescription", "follow-up": "Follow-up" } as const;

export const failingOf = (checks: readonly Check[]) => checks.filter(c => !c.ok);

/** The automatic checks: passed is green, a failing one is amber ("check before sending", not an alarm). */
export function Checks({ checks }: { checks: readonly Check[] }) {
  return (
    <ul className="rv-list">
      {checks.map(c => (
        <li key={c.id}>
          <Chip tone={c.ok ? "done" : "soon"}>{c.ok ? "Passed" : "Check"}</Chip> {c.label}
          {!c.ok && c.detail ? <span className="msg-meta"> · {c.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function VisitSummaryCard({ item, role, onDone }: { item: SummaryItem; role: Role; onDone: (done: Done) => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(item.text);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"approve" | "dismiss" | null>(null);
  const [active, setActive] = useState<number | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.review.list.key() });
  const approve = useMutation(orpc.review.approve.mutationOptions({
    onSuccess: (res, sent) => onDone({ id: item.id, name: item.patient.name, outcome: "approved", checks: sent.text ? res.checks : undefined }),
    onSettled: refresh,
  }));
  const dismiss = useMutation(orpc.review.dismiss.mutationOptions({
    onSuccess: () => onDone({ id: item.id, name: item.patient.name, outcome: "dismissed" }),
    onSettled: refresh,
  }));

  const edited = text.trim() !== item.text.trim();
  const failing = failingOf(item.checks);
  const busy = approve.isPending || dismiss.isPending;
  const send = () => approve.mutate({ id: item.id, ...(edited ? { text: text.trim() } : {}) });
  const sourceId = (n: number) => `rv-${item.id}-source-${n}`;
  // Highlights and reveals source n without a hash navigation (the router owns the URL).
  const showSource = (e: MouseEvent, n: number) => {
    e.preventDefault();
    setActive(n);
    document.getElementById(sourceId(n))?.scrollIntoView({ block: "nearest" });
  };

  return (
    <Card>
      <header className="msg-row-top">
        <Avatar name={item.patient.name} />
        <strong>{item.patient.name}</strong>
        <span className="msg-meta">After-visit summary · drafted {new Date(item.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
        {item.origin === "fixture" ? <Chip>Sample draft</Chip> : null}
        <Link to="/pro/visit" search={{ encounterId: item.encounterId }} className="msg-meta">Open the visit</Link>
      </header>

      <h3 className="rv-h">{edited ? "What the patient will read (edited)" : "What the patient will read"}</h3>
      {editing
        ? (
          <div className="msg-editor">
            <textarea aria-label={`After-visit summary for ${item.patient.name}`} rows={8} maxLength={4000} value={text} onChange={e => setText(e.target.value)} />
          </div>
        )
        : (
          <p className="rv-text">
            {splitMarkers(text, item.sources.map(s => s.n)).map((part, i) =>
              typeof part === "string"
                ? part
                : <a key={i} href={`#${sourceId(part.n)}`} aria-label={`Source ${part.n}`} onClick={e => showSource(e, part.n)}>[{part.n}]</a>)}
          </p>
        )}

      {item.whatChanged.length
        ? (
          <>
            <h3 className="rv-h">What changed</h3>
            <ul className="rv-changed">{item.whatChanged.map(line => <li key={line}>{line}</li>)}</ul>
          </>
        )
        : null}

      {item.sources.length
        ? (
          <>
            <h3 className="rv-h">Sources</h3>
            <ol className="rv-sources">
              {item.sources.map(s => (
                <li key={s.n} id={sourceId(s.n)} value={s.n} aria-current={active === s.n || undefined}>
                  <Chip>{KIND[s.kind]}</Chip> {s.text}
                </li>
              ))}
            </ol>
          </>
        )
        : null}

      <h3 className="rv-h">Automatic checks{edited ? " (on the draft; run again on your edit when you approve)" : ""}</h3>
      <Checks checks={item.checks} />

      {approve.error ? <p className="msg-error" role="alert">Not sent: {approve.error.message}</p> : null}
      {dismiss.error ? <p className="msg-error" role="alert">Not dismissed: {dismiss.error.message}</p> : null}

      {!can(role, "review.approve")
        ? <p className="msg-meta">{refusal(role, "review.approve")}</p>
        : confirm === "approve"
          ? (
            <div className="rv-confirm" data-tone="soon" role="group" aria-label="Confirm sending">
              <p>
                {failing.length === 1 ? "1 check did not pass" : `${failing.length} checks did not pass`}: {failing.map(c => c.label).join("; ")}.
                {" "}Send this summary to {item.patient.name} anyway?
              </p>
              <div className="msg-actions">
                <Button variant="primary" pending={approve.isPending} disabled={busy} onClick={send}>Send anyway</Button>
                <Button disabled={busy} onClick={() => setConfirm(null)}>Back</Button>
              </div>
            </div>
          )
          : confirm === "dismiss"
            ? (
              <div className="rv-confirm" data-tone="neutral" role="group" aria-label="Confirm dismissing">
                <p>Dismiss this summary? {item.patient.name} will not receive it.</p>
                <div className="msg-actions">
                  <Button variant="danger" pending={dismiss.isPending} disabled={busy} onClick={() => dismiss.mutate({ id: item.id })}>Dismiss</Button>
                  <Button disabled={busy} onClick={() => setConfirm(null)}>Keep</Button>
                </div>
              </div>
            )
            : (
              <div className="msg-actions">
                <Button variant="primary" pending={approve.isPending} disabled={busy || !text.trim()} onClick={failing.length ? () => setConfirm("approve") : send}>
                  Approve and send to patient
                </Button>
                <Button disabled={busy} onClick={() => setEditing(e => !e)}>{editing ? "Done editing" : "Edit"}</Button>
                {edited ? <Button disabled={busy} onClick={() => setText(item.text)}>Undo edit</Button> : null}
                <Button disabled={busy} onClick={() => setConfirm("dismiss")}>Dismiss</Button>
              </div>
            )}
    </Card>
  );
}

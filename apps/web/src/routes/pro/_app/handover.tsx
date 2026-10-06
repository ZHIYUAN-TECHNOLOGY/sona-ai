import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { EmptyState, PageHeader } from "@/components/page";
import { Avatar, Button, Card, Chip, Field, Skeleton, StatCard, StatRow, Tabs } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/handover.css";

type State = "all" | "watch" | "stable";

export const Route = createFileRoute("/pro/_app/handover")({ component: Page });

function Page() {
  const { me } = Route.useRouteContext();
  const mayAccept = can(me.role, "handover.accept");
  const cards = useQuery(orpc.handover.list.queryOptions());
  const receivers = useQuery(orpc.handover.receivers.queryOptions({ enabled: mayAccept }));
  const [toUser, setToUser] = useState("");
  // Unticked cards; everything is handed over unless the clinician holds one back.
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  // One id per attempt so a retry records the same acceptance once.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const accept = useMutation(orpc.handover.accept.mutationOptions({ onSuccess: () => setRequestId(crypto.randomUUID()) }));

  const all = cards.data ?? [];
  const cardIds = all.filter(c => !held.has(c.id)).map(c => c.id);
  const watch = all.filter(c => c.priority === "watch");
  const [tab, setTab] = useState<State>("all");
  const shown = tab === "all" ? all : all.filter(c => (c.priority === "watch") === (tab === "watch"));
  // Handed over in this sitting; the row settles to done in place.
  const done = new Set(accept.data?.cardIds);
  const n = (count: number) => `${count} patient${count === 1 ? "" : "s"}`;
  const receiver = receivers.data?.find(r => r.id === accept.data?.toUser);
  const toggle = (id: string) => setHeld(prev => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next; });

  return (
    <>
      <PageHeader title="Handover"
        lead={cards.data ? `${n(all.length)} to hand over · ${watch.length} need${watch.length === 1 ? "s" : ""} watching · ${done.size} handed over` : "The patients you hand to the next shift."}
        actions={mayAccept && all.length > 0 && (
          <Button variant="primary" icon="swap" pending={accept.isPending} disabled={!toUser || cardIds.length === 0}
            onClick={() => accept.mutate({ requestId, cardIds, toUser })}>
            Record handover of {n(cardIds.length)}
          </Button>
        )} />
      {cards.data && all.length > 0 && (
        <StatRow>
          <StatCard title="To hand over" value={cardIds.length} unit={`of ${all.length}`} caption={held.size ? `${held.size} held back` : "Everyone on your list"} />
          <StatCard title="Need watching" value={watch.length} chip={watch.length ? "Watch" : undefined} tone="soon" caption={watch.map(c => c.name).join(", ") || "All stable"} />
          <StatCard title="Handed over" value={done.size} tone="done" caption={accept.data ? `To ${receiver?.name ?? "your colleague"}` : "Not recorded yet"} />
        </StatRow>
      )}
      <WithRail rail={
        <RightRail label="Hand over">
          <Card title="Hand over to">
            {!mayAccept ? <p className="ho-muted">Your role can read the handover but cannot accept one.</p> : (
              <div className="ho-form">
                <Field label="Receiving clinician" hint={`${n(cardIds.length)} ticked. Untick a patient to hold them back.`} error={(accept.error ?? receivers.error)?.message}>
                  {control => (
                    <select {...control} className="ho-control" value={toUser} onChange={e => setToUser(e.target.value)}>
                      <option value="" disabled>{receivers.isPending ? "Loading colleagues…" : receivers.data?.length ? "Choose a colleague" : "No colleague has signed in yet"}</option>
                      {receivers.data?.map(r => <option key={r.id} value={r.id}>{r.name} ({r.role})</option>)}
                    </select>
                  )}
                </Field>
                {accept.data
                  ? <p className="ho-done" role="status"><Chip tone="done" icon="check">Handed over</Chip> {n(accept.data.cardIds.length)} to {receiver?.name ?? "your colleague"}.</p>
                  : <p className="ho-muted">Review each patient, pick who takes over, then record the handover.</p>}
              </div>
            )}
          </Card>
        </RightRail>
      }>
        <Card>
          <div className="ho-toolbar">
            <Tabs label="Handover by state" value={tab} onChange={setTab} tabs={[
              { id: "all", label: "All", count: all.length },
              { id: "watch", label: "Watch", count: watch.length },
              { id: "stable", label: "Stable", count: all.length - watch.length },
            ]} />
          </div>
          {cards.isPending ? (
            <div className="ho-loading" aria-busy="true" aria-label="Loading the handover">
              {[0, 1, 2].map(i => <Skeleton key={i} height={96} />)}
            </div>
          ) : cards.error || !cards.data ? (
            <EmptyState icon="swap" title="Could not load the handover">{cards.error?.message ?? "No answer"}. Your role may not be allowed to see this.</EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState icon="swap" title={all.length ? "Nobody in this state" : "Nobody to hand over"}>
              {all.length ? "Choose another tab to see the rest of the handover." : "Patients on your list appear here at the end of the shift."}
            </EmptyState>
          ) : (
            <ul className="ho-list">
              {shown.map(c => (
                <li key={c.id} className="ho-row" data-done={done.has(c.id) || undefined}>
                  <div className="ho-head">
                    {mayAccept && <input type="checkbox" className="ho-check" aria-label={`Hand over ${c.name}`} checked={!held.has(c.id)} disabled={done.has(c.id)} onChange={() => toggle(c.id)} />}
                    <Avatar name={c.name} />
                    <div className="ho-who">
                      <strong>{c.name}</strong>
                      <span className="ho-muted">{c.meta}</span>
                    </div>
                    {done.has(c.id) ? <Chip tone="done" icon="check">Handed over</Chip>
                      : c.priority === "watch" ? <Chip tone="soon">Watch</Chip>
                      : <span className="ho-muted">{held.has(c.id) ? "Held back" : "Stable"}</span>}
                  </div>
                  <dl className="ho-sbar">
                    <dt>Situation</dt><dd>{c.situation}</dd>
                    <dt>Background</dt><dd>{c.background}</dd>
                    <dt>Assessment</dt><dd>{c.assessment}</dd>
                    {c.recommendation.length > 0 && <><dt>To do</dt><dd><ul>{c.recommendation.map(r => <li key={r}>{r}</li>)}</ul></dd></>}
                  </dl>
                  <p className="ho-muted ho-foot">You decide · {c.sources.length} source{c.sources.length === 1 ? "" : "s"}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </WithRail>
    </>
  );
}

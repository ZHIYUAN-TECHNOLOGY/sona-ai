import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { InsightCard, InsightRow } from "@/components/insight-card";
import { PageHeader } from "@/components/page";
import { Button, Card, Chip } from "@/components/primitives";
import { Loaded } from "@/features/ward/state";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/ward.css";

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
  const receiver = receivers.data?.find(r => r.id === accept.data?.toUser);
  const toggle = (id: string) => setHeld(prev => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next; });

  return (
    <>
      <PageHeader title="Handover" lead="Outgoing: the patients you hand to the next shift." />
      {cards.data && (
        <InsightRow>
          <InsightCard tone={watch.length ? "soon" : "done"} sources={all.length}
            lead={watch.length ? `${watch.length} of ${all.length} patients need watching: ${watch.map(c => c.name).join(", ")}` : `${all.length} patients to hand over, all stable`}>
            Review each card, then pick who takes over.
          </InsightCard>
        </InsightRow>
      )}
      <Loaded query={cards} what="the handover" empty="Nobody to hand over.">
        {rows => (
          <ul className="ward-card-list">
            {rows.map(c => (
              <li key={c.id}>
                <Card>
                  <label className="ward-card-head">
                    {mayAccept && <input type="checkbox" checked={!held.has(c.id)} onChange={() => toggle(c.id)} />}
                    <strong>{c.name}</strong> <span className="ward-muted">{c.meta}</span>
                    <Chip tone={c.priority === "watch" ? "soon" : "done"}>{c.priority}</Chip>
                  </label>
                  <p><strong>S</strong> {c.situation}</p>
                  <p><strong>B</strong> {c.background}</p>
                  <p><strong>A</strong> {c.assessment}</p>
                  <ul>{c.recommendation.map(r => <li key={r}>{r}</li>)}</ul>
                  <p className="ward-muted">You decide · {c.sources.length} sources</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Loaded>
      {!mayAccept ? <p className="ward-muted">Your role can read the handover but cannot accept one.</p> : all.length > 0 && (
        <div className="ward-form">
          <select className="ward-control" aria-label="Receiving clinician" value={toUser} onChange={e => setToUser(e.target.value)}>
            <option value="" disabled>{receivers.isPending ? "Loading colleagues…" : receivers.data?.length ? "Hand over to…" : "No colleague has signed in yet"}</option>
            {receivers.data?.map(r => <option key={r.id} value={r.id}>{r.name} ({r.role})</option>)}
          </select>
          <Button variant="primary" pending={accept.isPending} disabled={!toUser || cardIds.length === 0}
            onClick={() => accept.mutate({ requestId, cardIds, toUser })}>
            Record handover of {cardIds.length} patient{cardIds.length === 1 ? "" : "s"}
          </Button>
          {accept.data && <Chip tone="done">Handed over to {receiver?.name ?? "your colleague"} ({accept.data.cardIds.length} patients)</Chip>}
          {(accept.error ?? receivers.error) && <p className="ward-error" role="alert">{(accept.error ?? receivers.error)!.message}</p>}
        </div>
      )}
    </>
  );
}

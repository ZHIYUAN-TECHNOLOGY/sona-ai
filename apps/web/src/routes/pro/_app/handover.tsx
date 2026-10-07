import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { EmptyState, PageHeader } from "@/components/page";
import { Avatar, Button, Card, Chip, Field, Select, Signal, Skeleton, StatCard, StatRow, Status, Tabs } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { orpc } from "@/lib/orpc";
import { Marked, MarkKey } from "@/components/marked";
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
  // Handed over in this sitting; the row settles to done in place and is not recorded twice.
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const accept = useMutation(orpc.handover.accept.mutationOptions({ onSuccess: data => { setRequestId(crypto.randomUUID()); setDone(prev => new Set([...prev, ...data.cardIds])); } }));

  const all = cards.data ?? [];
  const cardIds = all.filter(c => !held.has(c.id) && !done.has(c.id)).map(c => c.id);
  const watch = all.filter(c => c.priority === "watch");
  // Watch patients in this handover, named beside the button.
  const going = watch.filter(c => cardIds.includes(c.id));
  const [tab, setTab] = useState<State>("all");
  const shown = tab === "all" ? all : all.filter(c => (c.priority === "watch") === (tab === "watch"));
  const n = (count: number) => `${count} patient${count === 1 ? "" : "s"}`;
  const receiver = receivers.data?.find(r => r.id === accept.data?.toUser);
  const flip = (prev: ReadonlySet<string>, id: string) => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next; };
  const toggle = (id: string) => setHeld(prev => flip(prev, id));
  // Watch rows start open and stable rows closed; this holds the ones the reader flipped.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const isOpen = (c: { id: string; priority: string }) => (c.priority === "watch") !== flipped.has(c.id);
  // The toolbar acts on the rows in view: tick or untick them all, open or fold them all.
  const pickable = shown.filter(c => !done.has(c.id));
  const picked = pickable.filter(c => !held.has(c.id)).length;
  const pickAll = (on: boolean) => setHeld(prev => { const next = new Set(prev); for (const c of pickable) { if (on) next.delete(c.id); else next.add(c.id); } return next; });
  const allOpen = shown.length > 0 && shown.every(isOpen);
  const openAll = (on: boolean) => setFlipped(prev => { const next = new Set(prev); for (const c of shown) { if ((c.priority === "watch") === on) next.delete(c.id); else next.add(c.id); } return next; });

  return (
    <>
      <PageHeader title="Handover"
        lead={cards.data ? (
          <>
            {n(cardIds.length)} to hand over ·{" "}
            {watch.length ? <Signal tone="soon">{watch.length} need{watch.length === 1 ? "s" : ""} watching</Signal> : "all stable"}
            {done.size ? <> · <Signal tone="done">{done.size} handed over</Signal></> : null}
          </>
        ) : "The patients you hand to the next shift."} />
      {cards.data && all.length > 0 ? (
        <StatRow>
          <StatCard title="To hand over" value={cardIds.length} unit={`of ${all.length}`} caption={held.size ? `${held.size} held back` : done.size ? `${done.size} handed over` : "Everyone on your list"} onSelect={() => setTab("all")} selected={tab === "all"} />
          <StatCard title="Need watching" value={watch.length} chip={watch.length ? "Watch" : undefined} tone="soon" caption={watch.length ? "Read these first" : "Nobody on watch"} onSelect={() => setTab("watch")} selected={tab === "watch"} />
          <StatCard title="Stable" value={all.length - watch.length} caption="Not on watch" onSelect={() => setTab("stable")} selected={tab === "stable"} />
        </StatRow>
      ) : null}
      <WithRail rail={
        <RightRail label="Hand over">
          <Card title="Hand over to">
            {!mayAccept ? <p className="ho-muted">Your role can read the handover but cannot accept one.</p> : (
              <div className="ho-form">
                <Field label="Receiving clinician" hint={!cardIds.length ? "Nobody left to hand over. Tick a held patient to hand them over." : toUser ? "Untick a patient to hold them back." : "Choose who takes over first."} error={(accept.error ?? receivers.error)?.message}>
                  {control => (
                    <Select label="Receiving clinician" {...control} value={toUser} onChange={e => setToUser(e.target.value)}>
                      <option value="" disabled>{receivers.isPending ? "Loading colleagues…" : receivers.data?.length ? "Choose a colleague" : "No colleague has signed in yet"}</option>
                      {receivers.data?.map(r => <option key={r.id} value={r.id}>{r.name} ({r.role})</option>)}
                    </Select>
                  )}
                </Field>
                {/* What the button will record, beside it. */}
                {cardIds.length > 0 ? (
                  <dl className="ho-review">
                    <dt>Handing over</dt><dd>{n(cardIds.length)}</dd>
                    <dt>On watch</dt><dd>{going.length ? going.map(c => c.name).join(", ") : "Nobody"}</dd>
                    {held.size > 0 ? <><dt>Held back</dt><dd>{n(held.size)}, staying with you</dd></> : null}
                  </dl>
                ) : null}
                {cardIds.length > 0 || !accept.data ? (
                  <Button variant="primary" icon="swap" pending={accept.isPending} disabled={!toUser || cardIds.length === 0}
                    onClick={() => accept.mutate({ requestId, cardIds, toUser })}>
                    Hand over {n(cardIds.length)}
                  </Button>
                ) : null}
                {accept.data ? (
                  <div className="ho-done" role="status">
                    <Chip tone="done" icon="check">Handed over</Chip>
                    <span>{n(accept.data.cardIds.length)} to {receiver?.name ?? "your colleague"}.{held.size ? ` ${n(held.size)} held back: tick them to hand over too.` : ""}</span>
                    {held.size ? null : <Button to="/pro/today" icon="arrow-right">Back to Today</Button>}
                  </div>
                ) : null}
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
          {shown.length > 0 && (
            <div className="ho-bulk" role="toolbar" aria-label="Rows in view">
              {mayAccept && (
                <label className="ho-bulk-pick">
                  <input type="checkbox" className="ho-check" checked={pickable.length > 0 && picked === pickable.length} disabled={pickable.length === 0}
                    ref={el => { if (el) el.indeterminate = picked > 0 && picked < pickable.length; }} onChange={e => pickAll(e.target.checked)} />
                  <span>{picked} of {pickable.length} selected</span>
                </label>
              )}
              {mayAccept && watch.length > 0 && watch.length < all.length && (
                <Button size="sm" onClick={() => setHeld(new Set(all.filter(c => c.priority !== "watch").map(c => c.id)))}>Only those to watch</Button>
              )}
              <Button size="sm" onClick={() => openAll(!allOpen)}>{allOpen ? "Fold all" : "Open all"}</Button>
              <MarkKey />
            </div>
          )}
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
                      : held.has(c.id) ? <Status tone="soon">Held back</Status> : <Status tone="done">Stable</Status>}
                  </div>
                  <details className="ho-more" open={isOpen(c)}>
                    <summary onClick={e => { e.preventDefault(); setFlipped(prev => flip(prev, c.id)); }}><span><Marked text={c.situation} /></span></summary>
                  <dl className="ho-sbar">
                    <dt>Background</dt><dd><Marked text={c.background} /></dd>
                    <dt>Assessment</dt><dd><Marked text={c.assessment} /></dd>
                    {c.recommendation.length > 0 && <><dt>To do</dt><dd><ul>{c.recommendation.map(r => <li key={r}><Marked text={r} /></li>)}</ul></dd></>}
                  </dl>
                  {c.sources.length > 0 && <p className="ho-muted">You decide · {c.sources.length} source{c.sources.length === 1 ? "" : "s"}</p>}
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </WithRail>
    </>
  );
}

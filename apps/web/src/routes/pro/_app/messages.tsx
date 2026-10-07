import { can } from "@sona-ai/api/roles";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Chip, ListCard, ListRow, SearchField, Signal, Tabs } from "@/components/primitives";
import { ReplyEditor } from "@/features/messages/draft";
import { ago, triageBy } from "@/features/messages/format";
import { Thread } from "@/features/messages/thread";
import { orpc } from "@/lib/orpc";

import "@/styles/pages/messages.css";

export const Route = createFileRoute("/pro/_app/messages")({
  // `patient` opens that patient's thread, so "Message" from a record or a check-in lands on the right conversation.
  validateSearch: (search: Record<string, unknown>): { patient?: string } => typeof search.patient === "string" && search.patient ? { patient: search.patient } : {},
  component: Page,
});

/** The page's one Sona panel: the drafted reply with why and what it stands on, sent only by the clinician who has read it. */
function ReplyPanel({ patientId, name, waiting }: { patientId: string; name: string; waiting: boolean }) {
  const draft = useQuery(orpc.messages.draft.queryOptions({ input: { patientId }, enabled: waiting }));
  const d = draft.data ?? null;
  const drafting = waiting && draft.isPending;
  // InsightCard folds its children under "Details"; a reply must be in view, so this page keeps it open (the summary is hidden in messages.css).
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.querySelector("details")?.setAttribute("open", ""); });
  return (
    <div ref={panel}>
    <InsightCard
      label={d ? "Draft reply" : "Reply"}
      meta={d && d.source !== "model" ? <Chip tone="amber">{d.waking ? "Sample · model waking" : "Sample · not a model"}</Chip> : undefined}
      tone={d?.label === "urgent" ? "urgent" : "info"}
      title={`Reply to ${name}`}
      lead={drafting ? "Sona is drafting…" : d ? d.reason : draft.error ? `No draft: ${draft.error.message}. Write the reply yourself.` : waiting ? "No draft for this message. Write the reply yourself." : "Nothing is waiting here. You can still write."}
      evidence={d
        ? [
            { text: "The patient's message" },
            { text: <>Triage: {d.label} · {triageBy(d.triagedBy)}</> },
            ...(d.source === "model" ? [{ text: `Drafted by Sona (${d.model})` }] : []),
          ]
        : undefined}
      sources={d ? 2 : undefined}
    >
      {drafting ? null : <ReplyEditor key={d?.messageId ?? patientId} patientId={patientId} draft={d} />}
    </InsightCard>
    </div>
  );
}

type Filter = "waiting" | "all";

function Page() {
  const { me } = Route.useRouteContext();
  const inbox = useQuery(orpc.messages.inbox.queryOptions());
  // Read before any early return: hooks run in the same order on every render.
  const { patient } = Route.useSearch();
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  if (!can(me.role, "messages.inbox")) return <><PageHeader title="Messages" /><EmptyState>Your role cannot see the care inbox.</EmptyState></>;
  if (inbox.isPending) return <><PageHeader title="Messages" /><EmptyState>Loading messages…</EmptyState></>;
  if (inbox.error) return <><PageHeader title="Messages" /><EmptyState>Could not load the inbox: {inbox.error.message}</EmptyState></>;

  const { threads, now } = inbox.data;
  if (!threads.length) return <><PageHeader title="Messages" lead="0 unread · 0 waiting for a reply" /><section className="msg-thread"><EmptyState>No patient messages yet. They arrive from Sona Care.</EmptyState></section></>;

  // Sorted by the server: waiting first, urgent first.
  const waiting = threads.filter(t => !t.handled);
  const unread = threads.reduce((n, t) => n + t.unread, 0);
  const oldest = waiting.reduce<(typeof waiting)[number] | undefined>((a, t) => (!a || new Date(t.waitingSince!) < new Date(a.waitingSince!) ? t : a), undefined);
  const needle = q.trim().toLowerCase();
  const visible = (filter === "waiting" ? waiting : threads).filter(t => !needle || `${t.name} ${t.lastText ?? ""}`.toLowerCase().includes(needle));
  const selected = visible.find(t => t.patientId === (picked ?? patient)) ?? visible[0];
  const urgent = waiting.filter(t => t.label === "urgent").length;
  const lead = (
    <>
      {unread} unread ·{" "}
      {waiting.length ? <Signal tone="soon">{waiting.length} waiting for a reply</Signal> : "nobody waiting for a reply"}
      {urgent ? <> · <Signal tone="urgent">{urgent} urgent</Signal></> : null}
      {oldest ? ` · oldest ${ago(oldest.waitingSince!, now)}` : null}
    </>
  );

  return (
    <>
      <PageHeader title="Messages" lead={lead} />
      <div className="msg-panes">
        <div className="msg-inbox">
          <Tabs label="Threads" value={filter} onChange={setFilter} tabs={[{ id: "all", label: "All", count: threads.length }, { id: "waiting", label: "Waiting", count: waiting.length }]} />
          <SearchField label="Search patients or messages" placeholder="Search messages" value={q} onChange={e => setQ(e.target.value)} />
          {visible.length
            ? (
              <ListCard>
                {visible.map(t => (
                  <ListRow
                    key={t.patientId}
                    avatar={t.name}
                    selected={t.patientId === selected?.patientId}
                    onClick={() => setPicked(t.patientId)}
                    title={(
                      <span className="msg-title">
                        <strong>{t.name}</strong>
                        {t.unread ? <span className="msg-unread" role="img" aria-label={`${t.unread} unread`} /> : null}
                        <span className="msg-meta">{ago(t.lastAt, now)}</span>
                      </span>
                    )}
                    caption={(
                      <span className="msg-preview">
                        <span className="msg-row-text">{t.lastFrom === "patient" ? "" : "Care team: "}{t.lastPhoto ? `Photo · ${t.lastPhoto}` : t.lastText}</span>
                        {!t.handled && t.label === "urgent" ? <Chip tone="urgent">Urgent</Chip> : null}
                      </span>
                    )}
                  />
                ))}
              </ListCard>
            )
            : <EmptyState>{needle ? "No thread matches that search." : "No one is waiting for a reply."}</EmptyState>}
        </div>
        {selected
          ? (
            <>
              <Thread key={selected.patientId} patientId={selected.patientId} canResolve={can(me.role, "messages.resolveMedicinePhoto")} />
              <aside className="msg-reply" aria-label="Reply">
                {can(me.role, "messages.reply")
                  ? <ReplyPanel key={selected.patientId} patientId={selected.patientId} name={selected.name} waiting={!selected.handled} />
                  : <section className="msg-thread"><p className="msg-meta">Only a doctor or a nurse replies.</p></section>}
              </aside>
            </>
          )
          : <section className="msg-thread msg-none"><EmptyState>No thread selected. Pick one from the inbox, or clear the search.</EmptyState></section>}
      </div>
    </>
  );
}

import { can } from "@sona-ai/api/roles";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { InsightCard, InsightRow } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Avatar, Chip } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { DraftChecks, DraftSources, ReplyEditor } from "@/features/messages/draft";
import { ago, labelTone } from "@/features/messages/format";
import { Thread } from "@/features/messages/thread";
import { orpc } from "@/lib/orpc";

import "@/styles/pages/messages.css";

export const Route = createFileRoute("/pro/_app/messages")({ component: Page });

/** The right rail: Sona's drafted reply with its sources, sent only by the clinician who has read it. */
function ReplyRail({ patientId, waiting }: { patientId: string; waiting: boolean }) {
  const draft = useQuery(orpc.messages.draft.queryOptions({ input: { patientId }, enabled: waiting }));
  if (waiting && draft.isPending) return <p className="msg-meta">Sona is drafting…</p>;
  const d = draft.data ?? null;
  return (
    <>
      {draft.error ? <p className="msg-error" role="alert">No draft: {draft.error.message}. Write the reply yourself.</p> : null}
      {d ? <><DraftChecks draft={d} /><DraftSources draft={d} /></> : null}
      <ReplyEditor key={d?.messageId ?? patientId} patientId={patientId} draft={d} />
    </>
  );
}

function Page() {
  const { me } = Route.useRouteContext();
  const inbox = useQuery(orpc.messages.inbox.queryOptions());
  const [picked, setPicked] = useState<string | null>(null);

  if (!can(me.role, "messages.inbox")) return <><PageHeader title="Messages" /><EmptyState>Your role cannot see the care inbox.</EmptyState></>;
  if (inbox.isPending) return <><PageHeader title="Messages" /><EmptyState>Loading messages…</EmptyState></>;
  if (inbox.error) return <><PageHeader title="Messages" /><EmptyState>Could not load the inbox: {inbox.error.message}</EmptyState></>;

  const { threads, now } = inbox.data;
  if (!threads.length) return <><PageHeader title="Messages" /><EmptyState>No patient messages yet. They arrive from Sona Care.</EmptyState></>;

  // Sorted by the server: waiting first, urgent first.
  const selected = threads.find(t => t.patientId === picked) ?? threads[0]!;
  const waiting = threads.filter(t => !t.handled);
  const urgent = waiting.filter(t => t.label === "urgent");
  const oldest = waiting.reduce<(typeof waiting)[number] | undefined>((a, t) => (!a || new Date(t.waitingSince!) < new Date(a.waitingSince!) ? t : a), undefined);
  const canReply = can(me.role, "messages.reply");

  return (
    <>
      <PageHeader title="Messages" lead={`${waiting.length} waiting for a reply · ${threads.length} threads`} />
      <InsightRow>
        {urgent.length
          ? <InsightCard tone="urgent" lead={`${urgent.length} urgent ${urgent.length === 1 ? "message is" : "messages are"} waiting: ${urgent[0]!.name} first`} sources={urgent.length} next={{ label: `Open ${urgent[0]!.name}`, onAct: () => setPicked(urgent[0]!.patientId) }} />
          : <InsightCard tone="done" lead="No urgent messages are waiting" sources={threads.length} />}
        {oldest
          ? <InsightCard tone="soon" lead={`${oldest.name} has waited longest: ${ago(oldest.waitingSince!, now)}`} sources={1} next={{ label: "Open the thread", onAct: () => setPicked(oldest.patientId) }} />
          : null}
      </InsightRow>
      <WithRail
        rail={(
          <RightRail label="Reply">
            {canReply
              ? <ReplyRail key={selected.patientId} patientId={selected.patientId} waiting={!selected.handled} />
              : <p className="msg-meta">Only a doctor or a nurse replies.</p>}
          </RightRail>
        )}
      >
        <div className="msg-panes">
          <nav className="msg-list" aria-label="Threads">
            {threads.map(t => (
              <button key={t.patientId} type="button" className="msg-row" aria-current={t.patientId === selected.patientId ? "true" : undefined} onClick={() => setPicked(t.patientId)}>
                <Avatar name={t.name} />
                <span className="msg-row-body">
                  <span className="msg-row-top">
                    <strong>{t.name}</strong>
                    {t.unread ? <span className="msg-unread" aria-label={`${t.unread} unread`}>{t.unread}</span> : null}
                    <span className="msg-meta">{ago(t.lastAt, now)}</span>
                  </span>
                  <span className="msg-row-text">{t.lastFrom === "patient" ? "" : "Care team: "}{t.lastPhoto ? `Photo · ${t.lastPhoto}` : t.lastText}</span>
                  <span className="msg-row-top">
                    {t.handled ? <Chip tone="done">Handled</Chip> : <Chip tone={labelTone(t.label)}>{t.label ?? "waiting"}</Chip>}
                    {t.bed ? <span className="msg-meta">Bed {t.bed}</span> : null}
                  </span>
                </span>
              </button>
            ))}
          </nav>
          <Thread key={selected.patientId} patientId={selected.patientId} canResolve={can(me.role, "messages.resolveMedicinePhoto")} />
        </div>
      </WithRail>
    </>
  );
}

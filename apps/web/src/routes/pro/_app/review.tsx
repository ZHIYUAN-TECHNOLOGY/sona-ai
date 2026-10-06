import { can } from "@sona-ai/api/roles";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { InsightCard, InsightRow } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Avatar, Button, Card } from "@/components/primitives";
import { DraftChecks, DraftSources, ReplyEditor } from "@/features/messages/draft";
import { ago } from "@/features/messages/format";
import { Checks, type Done, failingOf, VisitSummaryCard } from "@/features/review/visit-summary-card";
import { orpc } from "@/lib/orpc";

import "@/styles/pages/messages.css";
import "@/styles/pages/review.css";

export const Route = createFileRoute("/pro/_app/review")({ component: Page });

const summaryId = (id: string) => `rv-summary-${id}`;
const replyId = (patientId: string) => `rv-reply-${patientId}`;
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

function Page() {
  const { me } = Route.useRouteContext();
  const allowed = can(me.role, "messages.draft");
  const canSummaries = can(me.role, "review.list");
  const inbox = useQuery(orpc.messages.inbox.queryOptions({ enabled: allowed }));
  const summaries = useQuery(orpc.review.list.queryOptions({ enabled: canSummaries }));
  const [done, setDone] = useState<readonly Done[]>([]);
  const addDone = useCallback((d: Done) => setDone(all => [d, ...all]), []);
  // Dismissed here only: the message stays waiting in Messages (the API keeps no "draft dismissed").
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const waiting = (inbox.data?.threads ?? []).filter(t => !t.handled && !dismissed.includes(t.patientId));
  // ponytail: one draft call per waiting thread, in parallel (the server keeps each answer); page it if queues grow long.
  const drafts = useQueries({ queries: waiting.map(t => orpc.messages.draft.queryOptions({ input: { patientId: t.patientId } })) });

  const header = <PageHeader title="Review queue" lead="Approve what a patient will read. Nothing is sent until you approve it." />;
  if (!allowed && !canSummaries) return <>{header}<EmptyState>Only a doctor or a nurse reviews what a patient will read.</EmptyState></>;
  if ((allowed && inbox.isPending) || (canSummaries && summaries.isPending)) return <>{header}<EmptyState>Loading the queue…</EmptyState></>;

  const items = summaries.data ?? [];
  const total = items.length + waiting.length;
  const errors = (
    <>
      {summaries.error ? <p className="msg-error" role="alert">Could not load after-visit summaries: {summaries.error.message}</p> : null}
      {inbox.error ? <p className="msg-error" role="alert">Could not load drafted replies: {inbox.error.message}</p> : null}
    </>
  );
  // A card that left the queue: one brief line each, with the server's re-run checks after an edit.
  const doneLines = done.length
    ? (
      <ul className="rv-done" role="status">
        {done.map(d => (
          <li key={d.id} data-tone={d.outcome === "approved" ? "done" : "neutral"}>
            {d.outcome === "approved" ? `After-visit summary sent to ${d.name}.` : `Summary for ${d.name} dismissed. Nothing was sent.`}
            {d.checks ? <> Checks on your edited text:<Checks checks={d.checks} /></> : null}
          </li>
        ))}
      </ul>
    )
    : null;
  if (!total) return <>{header}{errors}{doneLines}{summaries.error || inbox.error ? null : <EmptyState>Nothing is waiting for review.</EmptyState>}</>;

  const urgent = waiting.filter(t => t.label === "urgent").length;
  const flagged = items.filter(s => failingOf(s.checks).length);
  const sampleSummary = items.find(s => s.origin === "fixture");
  const sampleReply = waiting.find((_, i) => drafts[i]?.data && drafts[i].data.source !== "model");
  const samples = items.filter(s => s.origin === "fixture").length + drafts.filter(d => d.data && d.data.source !== "model").length;
  const firstId = items[0] ? summaryId(items[0].id) : replyId(waiting[0]!.patientId);
  const firstSampleId = sampleSummary ? summaryId(sampleSummary.id) : sampleReply ? replyId(sampleReply.patientId) : firstId;
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <>
      {header}
      <InsightRow>
        <InsightCard
          tone={urgent ? "urgent" : "info"}
          lead={`${count(total, "item waits", "items wait")} for review: ${count(items.length, "after-visit summary", "after-visit summaries")}, ${count(waiting.length, "drafted reply", "drafted replies")}${urgent ? ` (${urgent} urgent)` : ""}`}
          next={{ label: "Start with the first", onAct: () => jump(firstId) }}
          sources={total}
        />
        {flagged.length
          ? (
            <InsightCard
              tone="soon"
              lead={`${count(flagged.length, "summary has", "summaries have")} a check to look at before sending`}
              next={{ label: "Go to the first one", onAct: () => jump(summaryId(flagged[0]!.id)) }}
              sources={flagged.length}
            />
          )
          : null}
        {samples
          ? (
            <InsightCard
              tone="soon"
              lead={`${count(samples, "draft is a sample", "drafts are samples")}, not a model's: read closely`}
              next={{ label: "Read the first sample", onAct: () => jump(firstSampleId) }}
              sources={samples}
            />
          )
          : null}
      </InsightRow>
      {errors}
      {doneLines}
      <ol className="review-queue">
        {items.map(item => (
          <li key={item.id} id={summaryId(item.id)}>
            <VisitSummaryCard item={item} role={me.role} onDone={addDone} />
          </li>
        ))}
        {waiting.map((t, i) => {
          const draft = drafts[i];
          return (
            <li key={t.patientId} id={replyId(t.patientId)}>
              <Card>
                <header className="msg-row-top">
                  <Avatar name={t.name} />
                  <strong>{t.name}</strong>
                  <span className="msg-meta">Reply to a patient message · waiting {t.waitingSince && inbox.data ? ago(t.waitingSince, inbox.data.now) : ""}</span>
                  <Link to="/pro/messages" className="msg-meta">Open in Messages</Link>
                </header>
                {!draft || draft.isPending ? <p className="msg-meta">Sona is drafting…</p> : null}
                {draft?.error ? <p className="msg-error" role="alert">No draft: {draft.error.message}</p> : null}
                {draft?.data
                  ? (
                    <>
                      <DraftChecks draft={draft.data} />
                      <DraftSources draft={draft.data} asked={t.lastFrom === "patient" && !t.lastPhoto ? t.lastText : undefined} />
                      <ReplyEditor
                        key={draft.data.messageId}
                        patientId={t.patientId}
                        draft={draft.data}
                        sendLabel="Approve and send"
                        extra={<Button onClick={() => setDismissed(d => [...d, t.patientId])}>Dismiss</Button>}
                      />
                    </>
                  )
                  : null}
              </Card>
            </li>
          );
        })}
      </ol>
    </>
  );
}

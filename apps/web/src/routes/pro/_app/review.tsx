import { can } from "@sona-ai/api/roles";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { InsightCard, InsightRow } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Avatar, Button, Card } from "@/components/primitives";
import { DraftChecks, DraftSources, ReplyEditor } from "@/features/messages/draft";
import { ago } from "@/features/messages/format";
import { orpc } from "@/lib/orpc";

import "@/styles/pages/messages.css";

export const Route = createFileRoute("/pro/_app/review")({ component: Page });

function Page() {
  const { me } = Route.useRouteContext();
  const allowed = can(me.role, "messages.draft");
  const inbox = useQuery(orpc.messages.inbox.queryOptions({ enabled: allowed }));
  // Dismissed here only: the message stays waiting in Messages (the API keeps no "draft dismissed").
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const waiting = (inbox.data?.threads ?? []).filter(t => !t.handled && !dismissed.includes(t.patientId));
  // ponytail: one draft call per waiting thread, in parallel (the server keeps each answer); page it if queues grow long.
  const drafts = useQueries({ queries: waiting.map(t => orpc.messages.draft.queryOptions({ input: { patientId: t.patientId } })) });

  const header = <PageHeader title="Review queue" lead="Approve what a patient will read. Nothing is sent until you approve it." />;
  if (!allowed) return <>{header}<EmptyState>Only a doctor or a nurse reviews replies to patients.</EmptyState></>;
  if (inbox.isPending) return <>{header}<EmptyState>Loading the queue…</EmptyState></>;
  if (inbox.error) return <>{header}<EmptyState>Could not load the queue: {inbox.error.message}</EmptyState></>;
  if (!waiting.length) return <>{header}<EmptyState>Nothing is waiting for review.</EmptyState></>;

  const urgent = waiting.filter(t => t.label === "urgent").length;
  const samples = drafts.filter(d => d.data && d.data.source !== "model").length;
  return (
    <>
      {header}
      <InsightRow>
        <InsightCard tone={urgent ? "urgent" : "info"} lead={`${waiting.length} drafted ${waiting.length === 1 ? "reply waits" : "replies wait"} for you${urgent ? `, ${urgent} urgent` : ""}`} sources={waiting.length} />
        {samples ? <InsightCard tone="soon" lead={`${samples} ${samples === 1 ? "draft is a sample" : "drafts are samples"}, not a model's: read closely`} sources={samples} /> : null}
      </InsightRow>
      <ol className="review-queue">
        {waiting.map((t, i) => {
          const draft = drafts[i];
          return (
            <li key={t.patientId}>
              <Card>
                <header className="msg-row-top">
                  <Avatar name={t.name} />
                  <strong>{t.name}</strong>
                  <span className="msg-meta">Reply to a patient message · waiting {t.waitingSince ? ago(t.waitingSince, inbox.data.now) : ""}</span>
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

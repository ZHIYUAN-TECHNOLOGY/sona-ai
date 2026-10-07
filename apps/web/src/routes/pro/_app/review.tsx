import { can } from "@sona-ai/api/roles";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Avatar, Button, Card, Chip, ListCard, ListRow, Signal, Tabs } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { DraftChecks, DraftSources, ReplyEditor } from "@/features/messages/draft";
import { ago } from "@/features/messages/format";
import { flaggedFirst } from "@/features/review/rank";
import { Checks, type Done, failingOf, VisitSummaryCard } from "@/features/review/visit-summary-card";
import { countOf, formatNumber } from "@/lib/format";
import { orpc } from "@/lib/orpc";

import "@/styles/pages/messages.css";
import "@/styles/pages/review.css";

export const Route = createFileRoute("/pro/_app/review")({ component: Page });

type Tab = "all" | "reply" | "summary";
const PAGE = 50;
/** A line for an item that left the queue; `reply` marks a sent reply, the rest are visit summaries. */
type Sent = Done & { reply?: true };
// The document's own "Approve and send" is the one place that sends. The rail's suggested step takes the clinician to it, with the
// draft in view, and never presses it for them.
const approveOpen = () => {
  const button = [...document.querySelectorAll<HTMLButtonElement>("#rv-open button")].find(b => b.textContent?.startsWith("Approve and send"));
  button?.scrollIntoView({ block: "center", behavior: "smooth" });
  button?.focus({ preventScroll: true });
};

function Page() {
  const { me } = Route.useRouteContext();
  const allowed = can(me.role, "messages.draft");
  const canSummaries = can(me.role, "review.list");
  const inbox = useQuery(orpc.messages.inbox.queryOptions({ enabled: allowed }));
  const summaries = useQuery(orpc.review.list.queryOptions({ enabled: canSummaries }));
  const [done, setDone] = useState<readonly Sent[]>([]);
  const addDone = useCallback((d: Sent) => setDone(all => [d, ...all]), []);
  // Dismissed here only: the message stays waiting in Messages (the API keeps no "draft dismissed").
  const [tab, setTab] = useState<Tab>("all");
  const [sel, setSel] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const waiting = (inbox.data?.threads ?? []).filter(t => !t.handled && !dismissed.includes(t.patientId));
  // The queue draws `limit` rows; a reply's row is never later than its place among the waiting, so drafts for the first
  // `limit` waiting threads cover every row drawn. ponytail: one draft call per drawn reply, in parallel (the server keeps each answer).
  const [limit, setLimit] = useState(PAGE);
  const drafts = useQueries({ queries: waiting.slice(0, limit).map(t => orpc.messages.draft.queryOptions({ input: { patientId: t.patientId }, enabled: allowed })) });

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
            {d.outcome === "approved" ? `${d.reply ? "Reply" : "After-visit summary"} sent to ${d.name}.` : `Summary for ${d.name} dismissed. Nothing was sent.`}
            {d.checks ? <> Checks on your edited text:<Checks checks={d.checks} /></> : null}
          </li>
        ))}
      </ul>
    )
    : null;
  if (!total) return <>{header}{errors}{doneLines}{summaries.error || inbox.error ? null : <EmptyState>Nothing is waiting for review.</EmptyState>}</>;

  const now = inbox.data?.now;
  // Flagged first, so the item opened by default is the one that most needs reading.
  const entries = flaggedFirst([
    ...items.map(item => ({
      key: `s-${item.id}`, kind: "summary" as const, name: item.patient.name, item, failing: failingOf(item.checks).map(c => c.label),
      sample: item.origin === "fixture", sources: item.sources.length,
      caption: `Visit summary · ${new Date(item.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
    })),
    ...waiting.map((t, i) => {
      const draft = drafts[i];
      return {
        key: `r-${t.patientId}`, kind: "reply" as const, name: t.name, t, draft, failing: t.label === "urgent" ? ["Triaged urgent: answer this first"] : [],
        sample: !!draft?.data && draft.data.source !== "model", sources: 1,
        caption: `Reply${t.waitingSince && now ? ` · ${ago(t.waitingSince, now)}` : ""}`,
      };
    }),
  ]);
  const shown = entries.filter(e => tab === "all" || e.kind === tab);
  const open = shown.find(e => e.key === sel) ?? shown[0];
  const flagged = entries.filter(e => e.failing.length);
  const samples = entries.filter(e => e.sample).length;
  const otherFlagged = flagged.find(e => e.key !== open?.key);
  const what = open?.kind === "summary" ? "after-visit summary" : "reply";

  return (
    <>
      <PageHeader
        title="Review queue"
        lead={(
          <>
            <Signal tone="soon">{countOf(total, "item waits", "items wait")} for your approval</Signal>
            {flagged.length ? <> · <Signal tone="urgent">{formatNumber(flagged.length)} flagged</Signal></> : null}
            {" · "}Nothing is sent until you approve it
          </>
        )}
      />
      {errors}
      {doneLines}
      <WithRail first
        rail={open
          ? (
            <RightRail label="Why this needs review">
              <InsightCard
                label="Sona insight"
                lead={open.failing.length
                  ? `${open.name}'s ${what} has ${countOf(open.failing.length, "check", "checks")} to look at before it is sent`
                  : open.sample
                    ? `This ${what} for ${open.name} is a rule-based sample, not written by a model. Read it closely`
                    : `${open.name} reads this ${what} as soon as you approve it. Sona's checks found nothing to flag`}
                evidence={[
                  ...open.failing.map(text => ({ icon: "alert" as const, text })),
                  ...(open.sample && open.failing.length ? [{ icon: "file" as const, text: "Sample draft, not written by a model" }] : []),
                  ...(otherFlagged ? [{ icon: "clipboard" as const, text: `${countOf(flagged.length, "item", "items")} in the queue flagged` }] : []),
                  ...(samples > (open.sample ? 1 : 0) ? [{ icon: "file" as const, text: countOf(samples, "draft in the queue is a sample", "drafts in the queue are samples") }] : []),
                ]}
                next={otherFlagged && !open.failing.length
                  ? { label: "Open the first flagged item", onAct: () => { setTab("all"); setSel(otherFlagged.key); } }
                  : { label: "Go to the approve button", step: "Read the draft, then approve it at its foot.", onAct: approveOpen }}
                sources={open.sources}
              />
            </RightRail>
          )
          : null}
      >
        <div className="rv-body">
          <div className="rv-queue">
            <Tabs<Tab>
              label="Kind of item"
              value={tab}
              onChange={setTab}
              tabs={[{ id: "all", label: "All", count: total }, { id: "reply", label: "Replies", count: waiting.length }, { id: "summary", label: "Visit summaries", count: items.length }]}
            />
            {shown.length
              ? (
                <ListCard>
                  {shown.slice(0, limit).map(e => (
                    <ListRow
                      key={e.key}
                      wrap
                      avatar={e.name}
                      title={e.name}
                      caption={e.caption}
                      selected={e.key === open?.key}
                      onClick={() => setSel(e.key)}
                      trailing={e.failing.length ? <Chip tone="soon">Check</Chip> : e.sample ? <Chip>Sample</Chip> : undefined}
                    />
                  ))}
                  {shown.length > limit ? <Button onClick={() => setLimit(l => l + PAGE)}>Show {countOf(Math.min(PAGE, shown.length - limit), "more item")}</Button> : null}
                </ListCard>
              )
              : <EmptyState>{tab === "reply" ? "No replies are waiting." : "No visit summaries are waiting."}</EmptyState>}
          </div>
          <div id="rv-open">
            {open?.kind === "summary" ? <VisitSummaryCard key={open.key} item={open.item} role={me.role} onDone={addDone} /> : null}
            {open?.kind === "reply"
              ? (
                <Card key={open.key} title="Draft reply to a patient message" className="rv-doc">
                  <header className="rv-strip">
                    <Avatar name={open.name} size="sm" />
                    <strong>{open.name}</strong>
                    <span className="msg-meta">{open.caption.replace("Reply · ", "Waiting ")}</span>
                    <Link to="/pro/messages" search={{ patient: open.t.patientId }} className="rv-link">Open in Messages</Link>
                  </header>
                  {!open.draft || open.draft.isPending ? <p className="msg-meta">Sona is drafting…</p> : null}
                  {open.draft?.error ? <p className="msg-error" role="alert">No draft: {open.draft.error.message}</p> : null}
                  {open.draft?.data
                    ? (
                      <>
                        <DraftChecks draft={open.draft.data} />
                        <DraftSources draft={open.draft.data} asked={open.t.lastFrom === "patient" && !open.t.lastPhoto ? open.t.lastText : undefined} />
                        <ReplyEditor
                          key={open.draft.data.messageId}
                          patientId={open.t.patientId}
                          draft={open.draft.data}
                          sendLabel="Approve and send"
                          onSent={() => addDone({ id: crypto.randomUUID(), name: open.name, outcome: "approved", reply: true })}
                          extra={<Button variant="secondary" onClick={() => setDismissed(d => [...d, open.t.patientId])}>Dismiss</Button>}
                        />
                      </>
                    )
                    : null}
                </Card>
              )
              : null}
          </div>
        </div>
      </WithRail>
    </>
  );
}

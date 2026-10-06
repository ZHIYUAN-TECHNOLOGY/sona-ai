import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { InsightCard, InsightRow } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button } from "@/components/primitives";
import { dateOf, leadOf, openOf, paragraphsOf } from "@/features/care-summaries/model";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-summaries.css";

export const Route = createFileRoute("/care/_app/visit-summaries")({
  // `id` comes from a link: keep it only if it looks like an id; the page then opens it only if it is this patient's.
  validateSearch: (search: Record<string, unknown>): { id?: string } =>
    typeof search.id === "string" && /^[\w-]{1,200}$/.test(search.id) ? { id: search.id } : {},
  component: Page,
});

const locale = (typeof navigator === "undefined" ? "" : navigator.language) || "en-MY";
const readIt = () => document.getElementById("vs-open")?.scrollIntoView({ behavior: "smooth", block: "start" });

function Page() {
  const { id } = Route.useSearch();
  const list = useQuery(orpc.care.visitSummaries.list.queryOptions());

  if (list.isPending) return <><PageHeader title="Visit summaries" /><EmptyState>Getting your summaries…</EmptyState></>;
  if (list.isError)
    return (
      <><PageHeader title="Visit summaries" />
        <EmptyState>We couldn't open your summaries. Check your connection and try again.
          <Button onClick={() => { void list.refetch(); }}>Try again</Button>
        </EmptyState></>
    );
  const summaries = list.data, newest = summaries[0], open = openOf(summaries, id);
  if (!newest || !open) return <><PageHeader title="Visit summaries" /><EmptyState>After a visit, your care team's summary shows here.</EmptyState></>;
  const others = summaries.filter(s => s.id !== open.id);

  return (
    <div className="vs-page">
      <PageHeader title="Visit summaries" />
      <InsightRow>
        <InsightCard lead={leadOf(newest, locale)} next={open.id === newest.id ? { label: "Read the summary", onAct: readIt } : undefined} />
      </InsightRow>

      <article id="vs-open" className="vs-open" aria-labelledby="vs-open-title">
        <h2 id="vs-open-title">Your visit on {dateOf(open.at, locale, true)}</h2>
        {paragraphsOf(open.text).map((p, i) => <p key={i}>{p}</p>)}
        {open.whatChanged.length ? (
          <>
            <h3>What changed</h3>
            <ul className="vs-changes">{open.whatChanged.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </>
        ) : null}
        <p className="vs-approved">Approved by your care team.</p>
        <div className="vs-actions">
          <Button variant="primary" onClick={() => window.print()}>Download PDF</Button>
          <Link className="btn btn-quiet" to="/care/messages">Ask about this</Link>
        </div>
      </article>

      {others.length ? (
        <section className="vs-others" aria-labelledby="vs-others-title">
          <h2 id="vs-others-title">{open.id === newest.id ? "Earlier visits" : "Other visits"}</h2>
          <ul>
            {others.map(s => (
              <li key={s.id}>
                <Link className="vs-row" to="/care/visit-summaries" search={s.id === newest.id ? {} : { id: s.id }} resetScroll={false} onClick={readIt}>
                  <span>{dateOf(s.at, locale, true)}</span>
                  <span className="vs-muted">{s.id === newest.id ? "Newest" : s.whatChanged.length === 1 ? "1 change" : `${s.whatChanged.length} changes`}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

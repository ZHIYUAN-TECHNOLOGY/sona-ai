import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, ListCard, ListRow } from "@/components/primitives";
import { changesLabel, dateOf, leadOf, openOf, paragraphsOf } from "@/features/care-summaries/model";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-summaries.css";

export const Route = createFileRoute("/care/_app/visit-summaries")({
  // `id` comes from a link: keep it only if it looks like an id; the page then opens it only if it is this patient's.
  validateSearch: (search: Record<string, unknown>): { id?: string } =>
    typeof search.id === "string" && /^[\w-]{1,200}$/.test(search.id) ? { id: search.id } : {},
  component: Page,
});

const locale = (typeof navigator === "undefined" ? "" : navigator.language) || "en-MY";
const LEAD = "What your care team wrote after each visit, in plain words.";

/** A state with nothing to read yet: one centred card across the page. */
const Blank = ({ children, ...rest }: Parameters<typeof EmptyState>[0]) => (
  <div className="vs-page">
    <PageHeader title="Visit summaries" lead={LEAD} />
    <Card className="vs-blank"><EmptyState {...rest}>{children}</EmptyState></Card>
  </div>
);

function Page() {
  const { id } = Route.useSearch();
  const list = useQuery(orpc.care.visitSummaries.list.queryOptions());

  if (list.isPending) return <Blank icon="clock">Getting your summaries…</Blank>;
  if (list.isError)
    return (
      <Blank icon="refresh" title="We couldn't open your summaries" action={<Button variant="primary" onClick={() => { void list.refetch(); }}>Try again</Button>}>
        Check your connection and try again.
      </Blank>
    );
  const summaries = list.data, newest = summaries[0], open = openOf(summaries, id);
  if (!newest || !open)
    return (
      <Blank icon="file" title="No visit summaries yet">
        Your summary appears here after your care team approves it. It says what happened at your visit and what changed, in plain words.
      </Blank>
    );
  const several = summaries.length > 1, on = dateOf(open.at, locale, true);

  return (
    <div className="vs-page">
      <PageHeader title="Visit summaries" lead={LEAD} actions={<Button variant="primary" icon="message" to="/care/messages">Message your care team</Button>} />
      <div className="vs-split" data-several={several || undefined}>
        {several ? (
          <ListCard title="Your visits">
            {summaries.map(s => (
              <ListRow key={s.id} icon="calendar" title={dateOf(s.at, locale, true)} caption={`${changesLabel(s.whatChanged.length)} · Approved by your care team`}
                to="/care/visit-summaries" search={s.id === newest.id ? {} : { id: s.id }} selected={s.id === open.id} />
            ))}
          </ListCard>
        ) : null}
        <div className="vs-summary">
          <InsightCard label="In plain words" meta="Approved by your care team" title={`Your visit on ${on}`} lead={leadOf(open, locale)}
            evidence={open.whatChanged.slice(0, 3).map(text => ({ icon: "check" as const, text }))} />
          {open.whatChanged.length ? (
            <ListCard title="What changed">
              {open.whatChanged.map((c, i) => <ListRow key={i} icon="swap" title={c} />)}
            </ListCard>
          ) : null}
          <Card title="The full summary" className="vs-full">
            {paragraphsOf(open.text).map((p, i) => <p key={i}>{p}</p>)}
            <p className="vs-approved">Approved by your care team · Visit on {on}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

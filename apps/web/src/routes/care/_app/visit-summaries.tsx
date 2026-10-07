import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, ListCard, ListRow } from "@/components/primitives";
import { dateOf, firstWords, headerLead, insightOf, openOf, sectionsOf } from "@/features/care-summaries/model";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-summaries.css";

export const Route = createFileRoute("/care/_app/visit-summaries")({
  // `id` comes from a link: keep it only if it looks like an id; the page then opens it only if it is this patient's.
  validateSearch: (search: Record<string, unknown>): { id?: string } =>
    typeof search.id === "string" && /^[\w-]{1,200}$/.test(search.id) ? { id: search.id } : {},
  component: Page,
});

const locale = (typeof navigator === "undefined" ? "" : navigator.language) || "en-MY";
const LEAD = "What your care team wrote after each visit.";
const ASK = { label: "Ask Sona about this summary", step: "Not sure what a line means? Sona can explain it.", to: "/care/ask" } as const;
/** The panel lists this many changes; the rest open under "Details", so a long list never buries the next step. */
const SHOWN = 5;
const MEDICINES = { label: "See your medicines", step: "Check this against your medicine list.", to: "/care/medicines" } as const;

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
  const several = summaries.length > 1, on = dateOf(open.at, locale, true), insight = insightOf(open);
  // One filled button on the page: the panel's suggested step, or "Ask Sona" in the help card when there is no panel.
  const panelAsks = insight ? !insight.medicine : false;

  return (
    <div className="vs-page">
      <PageHeader title="Visit summaries" lead={headerLead(summaries, locale)} actions={
        <Button variant="secondary" icon="download" onClick={() => window.print()}>Download PDF</Button>
      } />
      <div className="vs-split" data-panel={insight || several ? true : undefined}>
        <Card title={`Your visit on ${on}`} className="vs-full">
          {sectionsOf(open.text).map(sec => (
            <section key={sec.body}>
              {sec.heading ? <h3 className="vs-overline">{sec.heading}</h3> : null}
              <p>{sec.body}</p>
            </section>
          ))}
          <p className="vs-approved">Approved by your care team</p>
        </Card>
        <aside className="vs-rail" aria-label="About this summary">
          {insight ? (
            <InsightCard label="Sona" title="What this means for you" lead={insight.lead}
              evidence={insight.rows.slice(0, SHOWN).map(text => ({ icon: "check" as const, text }))} next={insight.medicine ? MEDICINES : ASK}>
              {insight.rows.length > SHOWN ? <ul className="vs-more">{insight.rows.slice(SHOWN).map((text, i) => <li key={i}>{text}</li>)}</ul> : null}
            </InsightCard>
          ) : null}
          {several ? (
            <ListCard title="Your visits">
              {summaries.map(s => (
                <ListRow key={s.id} icon="calendar" title={dateOf(s.at, locale, true)} caption={firstWords(s.text)}
                  to="/care/visit-summaries" search={s.id === newest.id ? {} : { id: s.id }} selected={s.id === open.id} />
              ))}
            </ListCard>
          ) : null}
          <Card title="Not sure about something?" className="vs-help">
            <p>{panelAsks ? "Your care team can answer questions about this visit." : "Sona can explain a line in plain words, or your care team can answer."}</p>
            <div className="vs-help-acts">
              {panelAsks ? null : <Button variant={insight ? "secondary" : "primary"} icon="sparkle" to="/care/ask">Ask Sona</Button>}
              <Button variant="secondary" icon="message" to="/care/messages">Message your care team</Button>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

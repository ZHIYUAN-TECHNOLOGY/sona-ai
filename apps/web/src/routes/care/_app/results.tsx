import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { LineChart, Sparkline } from "@/components/charts";
import { DataTable, TableToolbar, ValueCell, type Column } from "@/components/data-table";
import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Chip, StatCard, StatRow } from "@/components/primitives";
import { langOf } from "@/features/care-medicines/model";
import { Explain } from "@/features/care-results/explain";
import { REVIEWING, countsOf, dateOf, improvedOf, isFlagged, plainOf, plural, statusOf, trendOf, valueOf, type Result } from "@/features/care-results/model";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-results.css";

export const Route = createFileRoute("/care/_app/results")({ component: Page });

const lang = langOf(typeof navigator === "undefined" ? undefined : navigator.language);

/** "Normal" is plain text; anything else is an amber chip. Red is never used for a result. */
function StatusCell({ r }: { r: Result }) {
  if (!r.released) return <Chip tone="amber">Being checked</Chip>;
  const status = statusOf(r.flag);
  return status === "Normal" ? <>Normal</> : <Chip tone="amber">{status === "Check" ? "Needs a look" : status}</Chip>;
}

function Page() {
  const list = useQuery(orpc.care.results.list.queryOptions({ input: { lang } }));
  const [openId, setOpenId] = useState<string>();

  const alone = (body: React.ReactNode) => <div className="res-page"><PageHeader title="Results" lead="Your test results, in plain words." /><Card className="res-alone">{body}</Card></div>;
  if (list.isPending) return alone(<EmptyState icon="flask" title="Getting your results…" />);
  if (list.isError)
    return alone(
      <EmptyState icon="info" title="We couldn't open your results" action={<Button onClick={() => { void list.refetch(); }}>Try again</Button>}>
        Check your connection and try again.
      </EmptyState>,
    );
  const results: Result[] = list.data;
  if (!results.length)
    return alone(
      <EmptyState icon="flask" title="No results yet" action={<Button to="/care/ask">Ask Sona a question</Button>}>
        Results appear here after your doctor has seen them.
      </EmptyState>,
    );

  const { seen, inRange, attention, waiting } = countsOf(results);
  const first = attention.find((r) => results.find((o) => o.released && o.test === r.test)?.id === r.id) ?? attention[0] ?? results.find((r) => r.released) ?? results[0];
  const picked = results.find((r) => r.id === openId) ?? first;
  const trends = new Map(results.map((r) => [r.id, trendOf(results, r.test, lang)]));
  const trend = picked ? trends.get(picked.id) ?? [] : [];

  const columns: Column<Result>[] = [
    { key: "test", header: "Test", cell: (r) => <span className="res-test">{r.test}</span> },
    { key: "value", header: "Result", cell: (r) => (r.released ? <ValueCell value={r.value} unit={r.unit} /> : <span className="res-muted">Not ready</span>) },
    { key: "status", header: "Status", cell: (r) => <StatusCell r={r} /> },
    { key: "at", header: "Received", cell: (r) => dateOf(r.at, lang) },
  ];
  if ([...trends.values()].some((t) => t.length))
    columns.push({
      key: "trend", header: "Trend",
      cell: (r) => {
        const t = trends.get(r.id) ?? [];
        return r.released && t.length ? <Sparkline values={t.map((p) => p.y)} label={`${r.test} over time`} tone={statusOf(r.flag) === "Normal" ? "neutral" : "amber"} /> : null;
      },
    });

  const improved = improvedOf(results);
  // An older flagged value that a newer in-range one replaced no longer needs a look.
  const open = attention.filter((r) => !improved.some((i) => i.test === r.test));
  const need = open.length;
  const needLine = `${need} ${need === 1 ? "needs" : "need"} a look.`;
  const leadLine = !seen ? "Your doctor has not seen your results yet."
    : `${plural(seen, "result")} your doctor has seen. ${need ? needLine : "All in the usual range."}`;
  const flagged = picked?.released ? isFlagged(picked.flag) : false;

  return (
    <div className="res-page">
      <PageHeader title="Results" lead={leadLine} />

      <div className="res-top">
        <InsightCard
          label="Sona"
          title="What your results mean"
          tone={need ? "soon" : "info"}
          lead={
            !seen ? REVIEWING
              : need ? `${inRange} of ${seen} are in the usual range. ${needLine}`
                : `All ${plural(seen, "result")} are in the usual range.`
          }
          evidence={[
            ...open.slice(0, 3).map((r) => ({ text: `${r.test}: ${plainOf(r.flag).toLowerCase()} (${valueOf(r)}, ${dateOf(r.at, lang)})` })),
            ...improved.slice(0, 2).map((r) => ({ text: `${r.test}: back in the usual range (${valueOf(r)}, ${dateOf(r.at, lang)})` })),
          ]}
          next={open[0] && open[0].id !== picked?.id ? { label: `See ${open[0].test}`, onAct: () => setOpenId(open[0]?.id) } : undefined}
        />
        <StatRow>
          {need ? <StatCard title="Need a look" value={need} tone="amber" caption={`of ${plural(seen, "result")}`} /> : null}
          {inRange ? <StatCard title="In range" value={inRange} caption={`of ${plural(seen, "result")}`} /> : null}
          {waiting ? <StatCard title="Being checked" value={waiting} caption="Results appear after your doctor has seen them." /> : null}
        </StatRow>
      </div>

      <div className="with-rail">
        <div className="with-rail-main">
          <Card title="All results">
            <DataTable
              columns={columns}
              rows={results}
              rowKey={(r) => r.id}
              selectedKey={picked?.id}
              onRowOpen={(r) => setOpenId(r.id)}
              toolbar={<TableToolbar><span className="res-muted">Choose a result to see what it means.</span></TableToolbar>}
              count={plural(results.length, "result")}
            />
          </Card>
        </div>
        <aside className="rail" aria-label="Chosen result">
          {picked ? (
            <Card title={picked.test} className="res-detail">
              {picked.released ? (
                <>
                  <p className="res-big"><span>{picked.value}</span>{picked.unit ? <small> {picked.unit}</small> : null}</p>
                  <p className="res-meta">{flagged ? <Chip tone="amber">{plainOf(picked.flag)}</Chip> : <span>{plainOf(picked.flag)}</span>}<span className="res-muted">{dateOf(picked.at, lang)}</span></p>
                  {trend.length ? <LineChart points={trend} label={`Your ${picked.test} results over time`} unit={picked.unit} height={160} /> : null}
                  <h3 className="res-h">What this means</h3>
                  <Explain key={picked.id} resultId={picked.id} lang={lang} />
                  <div className="res-next">
                    <span className="res-muted">Suggested next step</span>
                    {flagged ? <Button to="/care/messages" icon="message">Message your care team</Button> : <Button to="/care/ask" icon="sparkle">Ask Sona about this result</Button>}
                  </div>
                </>
              ) : (
                <p className="res-note">{REVIEWING}</p>
              )}
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

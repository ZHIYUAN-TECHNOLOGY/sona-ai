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
import { REVIEWING, countsOf, dateOf, plural, statusOf, trendOf, valueOf, type Result } from "@/features/care-results/model";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-results.css";

export const Route = createFileRoute("/care/_app/results")({ component: Page });

const lang = langOf(typeof navigator === "undefined" ? undefined : navigator.language);

/** "Normal" is plain text; anything else is an amber chip. Red is never used for a result. */
function StatusCell({ r }: { r: Result }) {
  if (!r.released) return <Chip tone="amber">Being checked</Chip>;
  const status = statusOf(r.flag);
  return status === "Normal" ? <>Normal</> : <Chip tone="amber">{status === "Check" ? "Needs attention" : status}</Chip>;
}

function Page() {
  const list = useQuery(orpc.care.results.list.queryOptions({ input: { lang } }));
  const [openId, setOpenId] = useState<string>();

  if (list.isPending) return <><PageHeader title="Results" /><EmptyState>Getting your results…</EmptyState></>;
  if (list.isError)
    return (
      <><PageHeader title="Results" />
        <EmptyState title="We couldn't open your results" action={<Button onClick={() => { void list.refetch(); }}>Try again</Button>}>
          Check your connection and try again.
        </EmptyState></>
    );
  const results: Result[] = list.data;
  if (!results.length)
    return <><PageHeader title="Results" /><EmptyState title="No results yet">Results appear here after your doctor has seen them.</EmptyState></>;

  const { seen, inRange, attention, waiting } = countsOf(results);
  const first = attention[0] ?? results.find((r) => r.released) ?? results[0];
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

  const leadLine = [
    seen ? `${plural(seen, "result")} your doctor has seen` : "Your doctor has not seen your results yet",
    attention.length ? `${attention.length} ${attention.length === 1 ? "needs" : "need"} attention` : undefined,
  ].filter(Boolean).join(" · ");

  return (
    <div className="res-page">
      <PageHeader title="Results" lead={leadLine} actions={<Button variant="primary" to="/care/ask">Ask Sona about my results</Button>} />

      <div className="res-top">
        <InsightCard
          label="Summary"
          title="Your latest results"
          tone={attention.length ? "soon" : "info"}
          lead={
            !seen ? REVIEWING
              : attention.length ? `${inRange} of ${seen} are in the normal range. ${plural(attention.length, "result")} ${attention.length === 1 ? "needs" : "need"} attention.`
                : `All ${plural(seen, "result")} are in the normal range.`
          }
          evidence={attention.slice(0, 3).map((r) => ({ text: `${r.test} was ${valueOf(r)} on ${dateOf(r.at, lang)}` }))}
          next={attention[0] && attention[0].id !== picked?.id ? { label: "See this result", onAct: () => setOpenId(attention[0]?.id) } : undefined}
        />
        <StatRow>
          <StatCard title="In range" value={inRange} caption={`of ${plural(seen, "result")}`} />
          <StatCard title="Need attention" value={attention.length} tone={attention.length ? "amber" : "neutral"} chip={attention.length ? "Talk to your doctor" : undefined} />
          <StatCard title="Being checked" value={waiting} caption="Shown after your doctor has seen them" />
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
                  <p className="res-meta"><StatusCell r={picked} /><span className="res-muted">{dateOf(picked.at, lang)}</span></p>
                  {trend.length ? <LineChart points={trend} label={`Your ${picked.test} results over time`} unit={picked.unit} height={160} /> : null}
                  <Explain key={picked.id} resultId={picked.id} lang={lang} />
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

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { LineChart } from "@/components/charts";
import { InsightCard, InsightRow } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button } from "@/components/primitives";
import { langOf } from "@/features/care-medicines/model";
import { Explain } from "@/features/care-results/explain";
import { REVIEWING, dateOf, isFlagged, leadOf, trendOf, valueOf } from "@/features/care-results/model";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-results.css";

export const Route = createFileRoute("/care/_app/results")({ component: Page });

const lang = langOf(typeof navigator === "undefined" ? undefined : navigator.language);

function Page() {
  const list = useQuery(orpc.care.results.list.queryOptions({ input: { lang } }));
  const [openId, setOpenId] = useState<string>();

  if (list.isPending) return <><PageHeader title="Results" /><EmptyState>Getting your results…</EmptyState></>;
  if (list.isError)
    return (
      <><PageHeader title="Results" />
        <EmptyState>We couldn't open your results. Check your connection and try again.
          <Button onClick={() => { void list.refetch(); }}>Try again</Button>
        </EmptyState></>
    );
  const results = list.data;
  const lead = leadOf(results, lang);
  if (!lead) return <><PageHeader title="Results" /><EmptyState>You have no test results yet. They show here once your care team has seen them.</EmptyState></>;

  const { openId: leadId } = lead;
  const show = (id: string) => {
    setOpenId(id);
    document.getElementById(`res-${id}`)?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="res-page">
      <PageHeader title="Results" />
      <InsightRow>
        <InsightCard lead={lead.text} tone={lead.tone} next={leadId && leadId !== openId ? { label: "See this result", onAct: () => show(leadId) } : undefined} />
      </InsightRow>

      <ul className="res-list">
        {results.map((r) => {
          if (!r.released)
            return (
              <li key={r.id} className="res-card" data-waiting="">
                <div className="res-head"><span className="res-test">{r.test}</span><span className="res-muted">{dateOf(r.at, lang)}</span></div>
                <p className="res-note">{REVIEWING}</p>
              </li>
            );
          const open = r.id === openId;
          const trend = open ? trendOf(results, r.test, lang) : [];
          return (
            <li key={r.id} id={`res-${r.id}`} className="res-card">
              <button type="button" className="res-head" aria-expanded={open} aria-controls={`res-detail-${r.id}`} onClick={() => setOpenId(open ? undefined : r.id)}>
                <span className="res-test">{r.test}</span>
                <span className="res-muted">{dateOf(r.at, lang)}</span>
                <span className="res-value">{valueOf(r)}</span>
              </button>
              {isFlagged(r.flag) ? <p className="res-note">Your care team has seen this.</p> : null}
              {open ? (
                <div id={`res-detail-${r.id}`} className="res-detail">
                  {trend.length ? <LineChart points={trend} label={`Your ${r.test} results over time`} unit={r.unit} /> : null}
                  <Explain resultId={r.id} lang={lang} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

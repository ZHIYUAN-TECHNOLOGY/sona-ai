import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { LineChart } from "@/components/charts";
import { InsightCard, InsightRow } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button } from "@/components/primitives";
import { browserLang, dayWords, whenWords } from "@/features/care-follow-ups/dates";
import { AddForm, listOptions } from "@/features/care-readings/add-form";
import { since, valueWords } from "@/features/care-readings/readings";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-readings.css";

export const Route = createFileRoute("/care/_app/readings")({ component: Page });

const lang = browserLang();
const DAY = 86_400_000;
const WINDOWS = [7, 30, 90] as const;
const toForm = () => {
  document.getElementById("rd-add")?.scrollIntoView({ behavior: "smooth" });
  document.querySelector<HTMLInputElement>("#rd-add .rd-value")?.focus({ preventScroll: true });
};

function Page() {
  const list = useQuery(listOptions());
  const clock = useQuery(orpc.care.clock.queryOptions());
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(7);

  if (list.isPending) return <><PageHeader title="Readings" /><EmptyState>Loading your readings…</EmptyState></>;
  if (list.isError) {
    return (
      <>
        <PageHeader title="Readings" />
        <EmptyState>We couldn't load your readings. <Button onClick={() => list.refetch()}>Try again</Button></EmptyState>
      </>
    );
  }

  const all = list.data.series;
  // "Now" is the browser's time plus the hospital's demo clock offset, as on Follow-ups.
  const shown = since(all, Date.now() + (clock.data?.offsetMs ?? 0) - days * DAY);
  const log = shown.flatMap(s => s.points.map(p => ({ s, p }))).sort((a, b) => +new Date(b.p.at) - +new Date(a.p.at));
  const chart = (points: { at: Date; y: number | undefined }[]) =>
    points.flatMap(p => (p.y == null ? [] : [{ x: dayWords(new Date(p.at), lang).replace(/^[^ ]+ /, ""), y: p.y }]));

  return (
    <div className="rd">
      <PageHeader title="Readings" lead="Numbers you measure at home." />
      <InsightRow>
        {all.length ? (
          <InsightCard sources={all.length} next={{ label: "Add today's reading", onAct: toForm }}
            lead={`Your latest: ${all.map(s => `${s.label} ${valueWords(s, s.points.at(-1)!)}`).join(", ")}.`} />
        ) : (
          <InsightCard lead="You have not logged a reading yet. Add your first one below." next={{ label: "Add today's reading", onAct: toForm }} />
        )}
      </InsightRow>
      <p className="rd-calm">Your care team can see readings you choose to share before a visit.</p>

      <AddForm />

      <section className="card" aria-labelledby="rd-trend">
        <div className="rd-head">
          <h2 className="card-title" id="rd-trend">{days === 7 ? "This week" : `Last ${days} days`}</h2>
          <div className="rd-kinds rd-days" role="group" aria-label="How far back">
            {WINDOWS.map(d => <button key={d} type="button" aria-pressed={d === days} onClick={() => setDays(d)}>{d} days</button>)}
          </div>
        </div>
        {shown.length ? (
          <div className="rd-charts">
            {shown.map(s => s.kind === "blood_pressure" ? (
              <div key={s.kind} className="rd-chart">
                <h3>Blood pressure, upper number</h3>
                <LineChart height={160} unit={s.unit} label={`Blood pressure, upper number, last ${days} days`} points={chart(s.points.map(p => ({ at: p.at, y: p.value })))} />
                <h3>Blood pressure, lower number</h3>
                <LineChart height={160} unit={s.unit} label={`Blood pressure, lower number, last ${days} days`} points={chart(s.points.map(p => ({ at: p.at, y: p.value2 })))} />
              </div>
            ) : (
              <div key={s.kind} className="rd-chart">
                <h3>{s.label}</h3>
                <LineChart height={160} unit={s.unit} label={`${s.label}, last ${days} days`} points={chart(s.points.map(p => ({ at: p.at, y: p.value })))} />
              </div>
            ))}
          </div>
        ) : (
          <p className="rd-calm">{all.length ? `No readings in the last ${days} days.` : "Your first reading will show here as a chart."}</p>
        )}
      </section>

      {log.length ? (
        <section className="card" aria-labelledby="rd-log">
          <h2 className="card-title" id="rd-log">Your readings</h2>
          <ul className="rd-log">
            {log.map(({ s, p }) => (
              <li key={p.id}>
                <span><strong>{s.label}</strong> {valueWords(s, p)}</span>
                <span className="rd-calm">{whenWords(new Date(p.at), lang)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

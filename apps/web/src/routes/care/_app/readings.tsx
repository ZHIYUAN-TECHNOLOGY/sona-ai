import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { LineChart } from "@/components/charts";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, StatCard, StatRow } from "@/components/primitives";
import { browserLang, dayWords, whenWords } from "@/features/care-follow-ups/dates";
import { AddForm, listOptions } from "@/features/care-readings/add-form";
import { since, valueWords, type Kind } from "@/features/care-readings/readings";
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
  const [picked, setPicked] = useState<Kind>();

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
  // The measure on the chart: the one picked, else the first one logged.
  const main = all.find(s => s.kind === picked) ?? all[0];
  const points = shown.find(s => s.kind === main?.kind)?.points ?? [];
  const chart = (name: string, ys: (number | undefined)[]) => (
    <LineChart height={220} showValues unit={main?.unit} label={`${name}, last ${days} days`}
      points={points.flatMap((p, i) => (ys[i] == null ? [] : [{ x: dayWords(new Date(p.at), lang).replace(/^[^ ]+ /, ""), y: ys[i]! }]))} />
  );

  return (
    <div className="rd">
      <PageHeader title="Readings" lead="Numbers you measure at home" actions={<Button variant="primary" onClick={toForm}>Add a reading</Button>} />
      {all.length ? (
        <StatRow>
          {all.slice(0, 4).map(s => {
            const p = s.points.at(-1)!;
            return <StatCard key={s.kind} title={s.label} value={`${p.value}${p.value2 != null ? `/${p.value2}` : ""}`} unit={s.unit} caption={whenWords(new Date(p.at), lang)} />;
          })}
        </StatRow>
      ) : null}

      <div className="rd-body">
        <div className="rd-main">
          <section className="card" aria-labelledby="rd-trend">
            <div className="rd-head">
              <h2 className="card-title" id="rd-trend">{main ? `${main.label} over time` : "Your readings over time"}</h2>
              <div className="rd-seg" role="group" aria-label="How far back">
                {WINDOWS.map(d => <button key={d} type="button" aria-pressed={d === days} onClick={() => setDays(d)}>{d} days</button>)}
              </div>
            </div>
            {all.length > 1 ? (
              <div className="rd-kinds" role="group" aria-label="Which reading to show">
                {all.map(s => <button key={s.kind} type="button" aria-pressed={s.kind === main?.kind} onClick={() => setPicked(s.kind)}>{s.label}</button>)}
              </div>
            ) : null}
            {!main ? (
              <EmptyState title="Your first reading will show here as a chart" />
            ) : points.length === 0 ? (
              <EmptyState title={`No ${main.label.toLowerCase()} readings in the last ${days} days`} />
            ) : points.length === 1 ? (
              <EmptyState title="Add one more reading to see a line">You have one so far: {valueWords(main, points[0]!)}.</EmptyState>
            ) : main.kind === "blood_pressure" ? (
              <div className="rd-chart">
                <h3>Upper number</h3>
                {chart("Blood pressure, upper number", points.map(p => p.value))}
                <h3>Lower number</h3>
                {chart("Blood pressure, lower number", points.map(p => p.value2 ?? undefined))}
              </div>
            ) : chart(main.label, points.map(p => p.value))}
          </section>

          {log.length ? (
            <Card title="Recent readings">
              <ul className="rd-log">
                {log.map(({ s, p }) => (
                  <li key={p.id}>
                    <span className="rd-calm">{whenWords(new Date(p.at), lang)}</span>
                    <span>{s.label} <strong>{valueWords(s, p)}</strong></span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="rd-rail">
          <AddForm />
          <Card>
            <p className="rd-calm">Your care team sees the readings you choose to share before a visit. <Link to="/care/follow-ups" className="link">Choose what to share</Link></p>
          </Card>
        </div>
      </div>
    </div>
  );
}

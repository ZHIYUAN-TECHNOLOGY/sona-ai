import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { LineChart } from "@/components/charts";
import { EmptyState, PageHeader } from "@/components/page";
import { InsightCard } from "@/components/insight-card";
import { Button, Card } from "@/components/primitives";
import { browserLang, dayWords, whenWords } from "@/features/care-follow-ups/dates";
import { AddForm, listOptions } from "@/features/care-readings/add-form";
import { changeWords, rangeWords, since, valueWords, type Kind } from "@/features/care-readings/readings";
import { countOf, formatNumber } from "@/lib/format";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-readings.css";

export const Route = createFileRoute("/care/_app/readings")({ component: Page });

const lang = browserLang();
const DAY = 86_400_000;
const WINDOWS = [7, 30, 90] as const;
const LOG_CAP = 10;
/** Past this many dots the numbers over them overlap; the axis and the list carry the values. */
const VALUES_MAX = 14;
/** "up 9 since 5 Oct, 8:00 am"; when both readings share a time, "up 9 from the reading before"; with one reading, just its time. */
const changeLine = (change: string | undefined, before: string, last: string) =>
  !change ? last : before === last ? change.replace(/ since$/, " from the reading before") : `${change} ${before}`;
const SHARE = { label: "Share readings before your visit", to: "/care/follow-ups" } as const;
const toForm = () => {
  document.getElementById("rd-add")?.scrollIntoView({ behavior: "smooth" });
  document.querySelector<HTMLInputElement>("#rd-add .rd-value")?.focus({ preventScroll: true });
};

function Page() {
  const list = useQuery(listOptions());
  const clock = useQuery(orpc.care.clock.queryOptions());
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(7);
  const [picked, setPicked] = useState<Kind>();
  const [showAll, setShowAll] = useState(false);

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
  const now = Date.now() + (clock.data?.offsetMs ?? 0);
  const shown = since(all, now - days * DAY);
  // "today 5:32 pm" for a reading taken today, the full date otherwise.
  const timeOf = (at: Date) => whenWords(new Date(at), lang).split(", ").at(-1)!;
  const when = (at: Date) => (new Date(at).toDateString() === new Date(now).toDateString() ? `today ${timeOf(at)}` : whenWords(new Date(at), lang));
  const log = shown.flatMap(s => s.points.map(p => ({ s, p }))).sort((a, b) => +new Date(b.p.at) - +new Date(a.p.at));
  // The measure on the chart: the one picked, else the first one logged.
  const main = all.find(s => s.kind === picked) ?? all[0];
  const points = shown.find(s => s.kind === main?.kind)?.points ?? [];
  // Under the line: the day, or the time when every reading shown is from one day (twice-daily readings would otherwise read as bare times).
  const days_ = points.map(p => dayWords(new Date(p.at), lang).replace(/^[^ ]+ /, ""));
  const xOf = (i: number) => (days_[0] === days_.at(-1) && points.length > 1 ? timeOf(points[i]!.at) : days_[i]!);
  const chart = (name: string, ys: (number | undefined)[]) => (
    <LineChart height={220} showValues={points.length <= VALUES_MAX} unit={main?.unit} label={`${name}, last ${days} days`}
      points={points.flatMap((_, i) => (ys[i] == null ? [] : [{ x: xOf(i), y: ys[i]! }]))} />
  );

  // The header and the Sona panel speak only from the numbers: the newest reading, this week's count and spread.
  const newest = all.flatMap(s => s.points.map(p => ({ s, p }))).sort((a, b) => +new Date(b.p.at) - +new Date(a.p.at))[0];
  const week = since(all, now - 7 * DAY);
  const weekCount = week.reduce((n, s) => n + s.points.length, 0);
  const weekMain = week.find(s => s.kind === main?.kind) ?? week[0];
  const addedToday = newest ? new Date(newest.p.at).toDateString() === new Date(now).toDateString() : false;
  const insight = weekCount === 0
    ? "No readings in the last 7 days."
    : `${countOf(weekCount, "reading")} this week. ${weekMain ? rangeWords(weekMain, weekMain.points) : ""}`.trim();

  return (
    <div className="rd">
      <PageHeader title="Readings" lead={newest ? `Your last reading: ${newest.s.label.toLowerCase()} ${valueWords(newest.s, newest.p)}, ${when(newest.p.at)}.` : "No readings yet. Add your first one."} />
      {newest ? (
        <InsightCard label="Sona" meta="From your numbers, not medical advice" lead={insight} next={addedToday ? SHARE : { label: "Add today's reading", onAct: toForm }} />
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
            {main ? <p className="rd-calm">Each dot is one {main.label.toLowerCase()} reading you added, oldest on the left.</p> : null}
            {all.length ? (
              <dl className="rd-stats">
                {all.map(s => {
                  const change = changeWords(s.points);
                  return (
                    <div key={s.kind}>
                      <dt>{s.label}</dt>
                      <dd><strong>{valueWords(s, s.points.at(-1)!)}</strong>{changeLine(change, when(s.points.at(-2)?.at ?? s.points.at(-1)!.at), when(s.points.at(-1)!.at))}</dd>
                    </div>
                  );
                })}
              </dl>
            ) : null}
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
                {(showAll ? log : log.slice(0, LOG_CAP)).map(({ s, p }) => (
                  <li key={p.id}>
                    <span className="rd-calm">{when(p.at)}</span>
                    <span>{s.label} <strong>{valueWords(s, p)}</strong></span>
                  </li>
                ))}
              </ul>
              {log.length > LOG_CAP && !showAll ? <Button className="rd-more" onClick={() => setShowAll(true)}>Show all {formatNumber(log.length)}</Button> : null}
            </Card>
          ) : null}
        </div>

        <div className="rd-rail">
          <AddForm initialKind={newest?.s.kind} />
          <Card>
            <p className="rd-calm">Your care team sees the readings you choose to share before a visit.{addedToday ? null : <> <Link to="/care/follow-ups" className="link">Choose what to share</Link></>}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

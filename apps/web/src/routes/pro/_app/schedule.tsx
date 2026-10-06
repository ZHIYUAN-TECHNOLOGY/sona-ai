import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useState } from "react";

import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, StatCard, StatRow } from "@/components/primitives";
import { WithRail } from "@/components/rail";
import { addDays, dateKey, dayLabel, hourOf, longLabel, timeOf, weekOf } from "@/features/today/time";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/today.css";

export const Route = createFileRoute("/pro/_app/schedule")({ component: Page });

const cellKey = (at: Date) => `${dateKey(at)} ${hourOf(at)}`;

function Page() {
  const [weeksAhead, setWeeksAhead] = useState(0);
  const today = dateKey(new Date());
  const days = weekOf(addDays(today, weeksAhead * 7));

  // Seven days, the open slots and the patient list are independent: all start at once.
  const week = useQueries({ queries: days.map(date => orpc.day.list.queryOptions({ input: { date } })) });
  const slots = useQuery(orpc.bookings.slots.queryOptions({ retry: false }));
  const patients = useQuery(orpc.patients.list.queryOptions());

  const loading = week.some(q => q.isPending);
  const failed = week.find(q => q.isError);
  const visits = week.flatMap(q => q.data ?? []);
  const open = (slots.data?.days ?? []).flatMap(d => d.times.map(t => new Date(t))).filter(t => days.includes(dateKey(t)));

  const visitsAt = Map.groupBy(visits, v => cellKey(new Date(v.startsAt)));
  const openAt = Map.groupBy(open, cellKey);
  const used = [...visits.map(v => hourOf(new Date(v.startsAt))), ...open.map(hourOf)];
  const from = Math.min(8, ...used);
  const hours = Array.from({ length: Math.max(17, ...used) - from + 1 }, (_, i) => from + i);

  const perDay = days.map(d => visits.filter(v => dateKey(new Date(v.startsAt)) === d).length);
  const busiest = perDay.indexOf(Math.max(...perDay));
  const encounterOf = (patientId: string) => patients.data?.find(p => p.id === patientId)?.encounterId || undefined;

  return (
    <>
      <PageHeader
        title="Schedule"
        lead={`${longLabel(days[0]!)} to ${longLabel(days[6]!)}${loading || failed ? "" : ` · ${visits.length} ${visits.length === 1 ? "visit" : "visits"}${slots.data ? ` · ${open.length} open ${open.length === 1 ? "slot" : "slots"}` : ""}`}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setWeeksAhead(w => w - 1)} aria-label="Week before">‹</Button>
            <Button variant="secondary" onClick={() => setWeeksAhead(w => w + 1)} aria-label="Week after">›</Button>
            <Button variant="primary" onClick={() => setWeeksAhead(0)} disabled={weeksAhead === 0}>This week</Button>
          </>
        }
      />

      {loading || failed ? null : (
        <StatRow>
          <StatCard feature title="Visits this week" value={visits.length} caption={visits.length ? `${dayLabel(days[busiest]!)} is the fullest` : "None booked"} />
          <StatCard title="Fullest day" value={visits.length ? perDay[busiest] : 0} unit="visits" caption={visits.length ? dayLabel(days[busiest]!) : "No visits"} />
          {slots.data ? <StatCard title="Open slots" value={open.length} chip={open.length ? undefined : "Full"} tone="soon" caption={slots.data.doctor.name} /> : null}
        </StatRow>
      )}

      <WithRail
        rail={loading || failed ? null : (
          <InsightCard
            label="Sona AI"
            meta="Schedule check"
            title="This week"
            tone={visits.length ? "info" : "done"}
            lead={visits.length
              ? `${visits.length} ${visits.length === 1 ? "visit" : "visits"} this week; ${dayLabel(days[busiest]!)} is the fullest with ${perDay[busiest]}.`
              : "No visits are booked this week."}
            evidence={slots.data ? [{ text: `${slots.data.doctor.name} has ${open.length} open ${open.length === 1 ? "slot" : "slots"} this week` }] : undefined}
            next={weeksAhead === 0 ? { label: "Open today", to: "/pro/today" } : undefined}
            sources={visits.length + open.length}
          />
        )}
      >
        <Card title="Week calendar">
      {loading ? <EmptyState>Loading the week…</EmptyState>
        : failed ? <EmptyState>The week could not be loaded. {failed.error?.message}</EmptyState>
          : (
            <div className="schedule-scroll">
              <div className="schedule-grid" role="table" aria-label="Week calendar">
                <div role="row" className="schedule-row">
                  <span role="columnheader" className="schedule-head" />
                  {days.map(d => (
                    <span key={d} role="columnheader" className="schedule-head" aria-current={d === today ? "date" : undefined}>
                      {dayLabel(d)}{d === today ? <small> Today</small> : null}
                    </span>
                  ))}
                </div>
                {hours.map(h => (
                  <div key={h} role="row" className="schedule-row">
                    <span role="rowheader" className="schedule-hour">{String(h).padStart(2, "0")}:00</span>
                    {days.map(d => (
                      <div key={d} role="cell" className="schedule-cell" data-today={d === today || undefined}>
                        {visitsAt.get(`${d} ${h}`)?.map(v => {
                          const encounterId = encounterOf(v.patientId);
                          const body = <Fragment><b>{timeOf(new Date(v.startsAt))}</b> {v.patientName}<small>{v.kind}</small></Fragment>;
                          return encounterId
                            ? <Link key={v.id} className="schedule-visit" to="/pro/visit" search={{ encounterId } as never}>{body}</Link>
                            : <span key={v.id} className="schedule-visit">{body}</span>;
                        })}
                        {openAt.get(`${d} ${h}`)?.map(t => <span key={t.getTime()} className="schedule-open">{timeOf(t)} open</span>)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          {slots.isError ? <p className="today-quiet">Open slots are not shown: {slots.error.message}</p> : null}
        </Card>
      </WithRail>
    </>
  );
}

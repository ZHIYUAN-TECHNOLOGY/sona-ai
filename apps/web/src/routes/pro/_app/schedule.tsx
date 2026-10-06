import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Chip, StatCard, StatRow } from "@/components/primitives";
import { WithRail } from "@/components/rail";
import { addDays, dateKey, dayLabel, hourOf, longLabel, timeOf, weekOf, whenOf } from "@/features/today/time";
import { type client, orpc } from "@/lib/orpc";
import "@/styles/pages/today.css";

export const Route = createFileRoute("/pro/_app/schedule")({ component: Page });

type Visit = Awaited<ReturnType<typeof client.day.list>>[number];
type Picked = { id: string; visit?: Visit; slot?: Date };
const minutesOf = (at: Date) => { const [h = 0, m = 0] = timeOf(at).split(":").map(Number); return h * 60 + m; };

function Page() {
  const [weeksAhead, setWeeksAhead] = useState(0);
  const [picked, setPicked] = useState<Picked>();
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

  const visitsOn = Map.groupBy(visits, v => dateKey(new Date(v.startsAt)));
  const openOn = Map.groupBy(open, dateKey);
  // This week the grid reaches the current hour, so the now line always has a place.
  const used = [...visits.map(v => hourOf(new Date(v.startsAt))), ...open.map(hourOf), ...(weeksAhead === 0 ? [hourOf(new Date())] : [])];
  const from = Math.min(8, ...used);
  const hours = Array.from({ length: Math.max(17, ...used) - from + 1 }, (_, i) => from + i);
  const offset = (at: Date) => `calc(${(minutesOf(at) - from * 60) / 60} * var(--week-hour))`;
  // ponytail: visits with the very same start share the column; partly overlapping starts still overlap. Lay out by interval once `day.list` has an end time.
  const sameStart = (visit: Visit, d: string) => {
    const same = (visitsOn.get(d) ?? []).filter(v => String(v.startsAt) === String(visit.startsAt));
    return { i: same.indexOf(visit), n: same.length };
  };
  const place = (at: Date, { i, n }: { i: number; n: number }) => ({ top: offset(at), left: `calc(${(Math.max(i, 0) / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)` });
  const nowMinutes = minutesOf(new Date());
  const nowTop = nowMinutes >= from * 60 && nowMinutes <= (from + hours.length) * 60 ? offset(new Date()) : undefined;

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
          <div className="week-rail">
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
          <Card title={picked?.visit ? "Visit" : picked?.slot ? "Open slot" : "Details"}>
            {picked?.visit ? (
              <div className="week-detail">
                <b>{picked.visit.patientName}</b>
                <span>{whenOf(new Date(picked.visit.startsAt))} · {picked.visit.kind}</span>
                {picked.visit.incomplete ? <Chip tone="soon">Record incomplete</Chip> : null}
                {encounterOf(picked.visit.patientId)
                  ? <Button variant="primary" size="sm" to="/pro/visit" search={{ encounterId: encounterOf(picked.visit.patientId) } as never}>Open visit</Button>
                  : <span className="today-quiet">No visit record to open yet.</span>}
              </div>
            ) : picked?.slot ? (
              <div className="week-detail">
                <b>{whenOf(picked.slot)}</b>
                <span>{slots.data?.doctor.name} is free. Patients book this slot from Sona Care.</span>
              </div>
            ) : <p className="today-quiet">Select a visit or an open slot to see it here.</p>}
          </Card>
          </div>
        )}
      >
        <Card title="Week calendar">
          {loading ? <EmptyState>Loading the week…</EmptyState>
            : failed ? <EmptyState>The week could not be loaded. {failed.error?.message}</EmptyState>
              : (
                <div className="week" role="group" aria-label="Week calendar">
                  <div className="week-head">
                    <span />
                    {days.map(d => (
                      <span key={d} className="week-day" aria-current={d === today ? "date" : undefined}>{dayLabel(d)}</span>
                    ))}
                  </div>
                  <div className="week-body" style={{ height: `calc(${hours.length} * var(--week-hour))` }}>
                    <div className="week-gutter" aria-hidden="true">
                      {hours.map((h, i) => <span key={h} style={{ top: `calc(${i} * var(--week-hour))` }}>{String(h).padStart(2, "0")}:00</span>)}
                    </div>
                    {days.map(d => (
                      <div key={d} className="week-col" data-today={d === today || undefined}>
                        {(visitsOn.get(d) ?? []).map(v => {
                          const at = new Date(v.startsAt);
                          return (
                            <button key={v.id} type="button" className="week-block" style={place(at, sameStart(v, d))}
                              data-attention={v.incomplete || undefined} aria-pressed={picked?.id === v.id}
                              onClick={() => setPicked({ id: v.id, visit: v })}>
                              <b>{timeOf(at)}</b> {v.patientName}<small>{v.kind}</small>
                            </button>
                          );
                        })}
                        {(openOn.get(d) ?? []).map(t => (
                          <button key={t.getTime()} type="button" className="week-block week-open" style={place(t, { i: 0, n: 1 })}
                            aria-pressed={picked?.id === t.toISOString()} onClick={() => setPicked({ id: t.toISOString(), slot: t })}>
                            <b>{timeOf(t)}</b> Open
                          </button>
                        ))}
                        {d === today && nowTop !== undefined ? <span className="week-now" style={{ top: nowTop }} role="img" aria-label={`Now, ${timeOf(new Date())}`} /> : null}
                      </div>
                    ))}
                  </div>
                  <p className="week-legend">
                    <span className="week-key" /> Visit
                    <span className="week-key" data-attention /> Record incomplete
                    <span className="week-key week-open" /> Open slot
                  </p>
                </div>
              )}
          {slots.isError ? <p className="today-quiet">Open slots are not shown: {slots.error.message}</p> : null}
        </Card>
      </WithRail>
    </>
  );
}

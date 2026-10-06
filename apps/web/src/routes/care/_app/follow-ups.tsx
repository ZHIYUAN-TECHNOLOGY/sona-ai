import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { InsightCard, InsightRow } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Chip } from "@/components/primitives";
import { Booking } from "@/features/care-follow-ups/booking";
import { browserLang, dayKey, whenWords } from "@/features/care-follow-ups/dates";
import { downloadIcs } from "@/features/care-follow-ups/ics";
import { MonthCalendar, type Mark } from "@/features/care-follow-ups/month-calendar";
import { VisitPrep } from "@/features/care-readings/visit-prep";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-follow-ups.css";

export const Route = createFileRoute("/care/_app/follow-ups")({ component: Page });

const lang = browserLang();
const toBooking = () => document.getElementById("book")?.scrollIntoView({ behavior: "smooth" });
const inWords = (n: number) => (n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`);

function Page() {
  // Three independent reads, started together.
  const visits = useQuery(orpc.care.followUps.queryOptions({ input: { lang } }));
  const requests = useQuery(orpc.care.bookings.list.queryOptions());
  const clock = useQuery(orpc.care.clock.queryOptions());
  // "Now" is the browser's time plus the hospital's demo clock offset, as in the phone app.
  const now = new Date(Date.now() + (clock.data?.offsetMs ?? 0));

  if (visits.isPending) return <><PageHeader title="Follow-ups" /><EmptyState>Loading your visits…</EmptyState></>;
  if (visits.isError) {
    return (
      <>
        <PageHeader title="Follow-ups" />
        <EmptyState>We couldn't load your visits. <Button onClick={() => visits.refetch()}>Try again</Button></EmptyState>
      </>
    );
  }

  // A visit the care team confirmed from a request carries its doctor and room.
  const booked = new Map((requests.data ?? []).filter(r => r.appointmentId).map(r => [r.appointmentId!, r]));
  const upcoming = visits.data.filter(v => v.inDays >= 0);
  const past = visits.data.filter(v => v.inDays < 0).reverse();
  const open = (requests.data ?? []).filter(r => r.status !== "confirmed");
  const waiting = open.filter(r => r.status === "requested");
  const next = upcoming[0], nextDoctor = next && booked.get(next.id);

  const marks = new Map<string, Mark[]>();
  const mark = (at: Date, m: Mark) => marks.set(dayKey(at), [...(marks.get(dayKey(at)) ?? []), m]);
  for (const v of visits.data) mark(v.date, { label: v.title, tone: v.inDays < 0 ? "neutral" : "done" });
  for (const r of waiting) mark(r.startsAt, { label: `Waiting: ${r.doctorName}`, tone: "soon" });

  const addToCalendar = (v: (typeof upcoming)[number]) => {
    const d = booked.get(v.id);
    downloadIcs({ id: v.id, title: v.title, start: v.date, location: d?.room, description: v.why }, new Date());
  };

  return (
    <div className="fu">
      <PageHeader title="Follow-ups" lead="Your visits, and a way to book one." />
      <InsightRow>
        {next ? (
          <InsightCard tone={nextDoctor ? "done" : "info"} sources={nextDoctor ? 2 : 1}
            lead={`Your next visit: ${next.title}. ${inWords(next.inDays)}, ${whenWords(next.date, lang)}${nextDoctor ? `, with ${nextDoctor.doctorName} at ${nextDoctor.room}` : ""}.`}
            next={nextDoctor ? { label: "Add to calendar", onAct: () => addToCalendar(next) } : { label: "Book another visit", onAct: toBooking }}>
            <p>{next.why}</p>
          </InsightCard>
        ) : waiting[0] ? (
          <InsightCard tone="soon" sources={1} lead={`Your request to see ${waiting[0].doctorName} on ${whenWords(waiting[0].startsAt, lang)} is waiting for the care team.`} />
        ) : (
          <InsightCard sources={1} lead="You have no visits coming up." next={{ label: "Book a visit", onAct: toBooking }} />
        )}
      </InsightRow>
      <VisitPrep />

      <div className="fu-cols">
        <MonthCalendar today={dayKey(now)} marks={marks} lang={lang} />
        <div className="fu-lists">
          <section className="card" aria-labelledby="fu-upcoming">
            <h2 className="card-title" id="fu-upcoming">Coming up</h2>
            {upcoming.length ? (
              <ul className="fu-list">
                {upcoming.map(v => {
                  const d = booked.get(v.id);
                  return (
                    <li key={v.id}>
                      <div>
                        <strong>{v.title}</strong>
                        <span>{whenWords(v.date, lang)}{d ? ` · ${d.doctorName} · ${d.room}` : ""}</span>
                        <span className="fu-muted">{v.why}</span>
                      </div>
                      <div className="fu-side">
                        {d ? <Chip tone="done">Confirmed</Chip> : <Chip>{inWords(v.inDays)}</Chip>}
                        {d ? <Button onClick={() => addToCalendar(v)}>Add to calendar</Button> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="fu-muted">No visits coming up.</p>}
          </section>

          {requests.isError ? <p className="fu-muted">We couldn't load your requests. <Button onClick={() => requests.refetch()}>Try again</Button></p> : null}
          {open.length ? (
            <section className="card" aria-labelledby="fu-requests">
              <h2 className="card-title" id="fu-requests">Your requests</h2>
              <ul className="fu-list">
                {open.map(r => (
                  <li key={r.id}>
                    <div>
                      <strong>{r.doctorName}</strong>
                      <span>{whenWords(r.startsAt, lang)} · {r.specialty} · {r.room}</span>
                      {r.note ? <span className="fu-muted">Care team: {r.note}</span> : null}
                    </div>
                    <div className="fu-side">
                      {r.status === "requested" ? <Chip tone="soon">Waiting for the care team</Chip>
                        : r.status === "declined" ? <Chip>Not booked. Choose another time.</Chip>
                        : <Chip>{r.status}</Chip>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {past.length ? (
            <section className="card" aria-labelledby="fu-past">
              <h2 className="card-title" id="fu-past">Past visits</h2>
              <ul className="fu-list">
                {past.map(v => (
                  <li key={v.id}>
                    <div><strong>{v.title}</strong><span>{whenWords(v.date, lang)}</span></div>
                    <div className="fu-side">{v.status === "attended" ? <Chip tone="done">Attended</Chip> : <Chip>Not marked attended</Chip>}</div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      <Booking lang={lang} />
    </div>
  );
}

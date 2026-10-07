import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Chip, ListRow, Tabs } from "@/components/primitives";
import { Booking } from "@/features/care-follow-ups/booking";
import { browserLang, dayKey, dayWords, timeWords, whenWords } from "@/features/care-follow-ups/dates";
import { downloadIcs } from "@/features/care-follow-ups/ics";
import { MonthCalendar, type Mark } from "@/features/care-follow-ups/month-calendar";
import { VisitPrep } from "@/features/care-readings/visit-prep";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-follow-ups.css";

export const Route = createFileRoute("/care/_app/follow-ups")({ component: Page });

const lang = browserLang();
const scrollTo = (id: string) => () => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
// Scrolls to the booking card and puts focus on its first choice.
const toBook = () => { scrollTo("book")(); document.querySelector<HTMLElement>("#book button")?.focus({ preventScroll: true }); };
const inWords = (n: number) => (n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`);

function Page() {
  // Three independent reads, started together.
  const visits = useQuery(orpc.care.followUps.queryOptions({ input: { lang } }));
  const requests = useQuery(orpc.care.bookings.list.queryOptions());
  const clock = useQuery(orpc.care.clock.queryOptions());
  const prep = useQuery(orpc.care.visitPrep.get.queryOptions());
  // Same options as the booking card, so the request is shared.
  const doctors = useQuery(orpc.care.doctors.list.queryOptions({ input: {} }));
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
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

  const openTimes = new Map<string, string[]>();
  for (const d of doctors.data ?? []) for (const s of d.nextSlots) {
    if (s.times[0]) openTimes.set(dayKey(s.times[0]), [...(openTimes.get(dayKey(s.times[0])) ?? []), `${d.name}: ${s.times.map(t => timeWords(t, lang)).join(", ")}`]);
  }
  const lead = next ? `Your next visit is ${next.inDays === 0 ? "today" : dayWords(next.date, lang)} at ${timeWords(next.date, lang)}.`
    : waiting[0] ? `${waiting.length === 1 ? "1 request is" : `${waiting.length} requests are`} waiting for the hospital. Nothing is booked yet.`
    : "No visit booked. Book one below.";

  const addToCalendar = (v: (typeof upcoming)[number]) => {
    const d = booked.get(v.id);
    downloadIcs({ id: v.id, title: v.title, start: v.date, location: d?.room, description: v.why }, new Date());
  };

  const p = prep.data?.appointment ? prep.data : undefined;
  const asked = p?.questions.length ?? 0;
  const left = (asked ? 0 : 1) + (p?.shareReadings ? 0 : 1);
  const toPrep = scrollTo("prep");

  return (
    <div className="fu">
      <PageHeader title="Follow-ups" lead={lead}
        actions={<Button variant="primary" icon="plus" onClick={toBook}>Book a visit</Button>} />

      <div className="fu-top" data-solo={next ? undefined : true}>
        {next || waiting[0] ? (
        <Card className="fu-hero">
          {next ? (
            <>
              <Chip tone={next.inDays <= 1 ? "info" : "neutral"}>{inWords(next.inDays)}</Chip>
              <h2 className="fu-hero-title">{next.title}</h2>
              {nextDoctor ? <p>{nextDoctor.doctorName} · {nextDoctor.room}</p> : null}
              <p className="fu-muted">{whenWords(next.date, lang)}</p>
              <p>{next.why}</p>
              <div className="fu-side">
                <Button variant="secondary" icon="calendar" onClick={() => addToCalendar(next)}>Add to calendar</Button>
              </div>
            </>
          ) : waiting[0] ? (
            <>
              <Chip tone="soon">Waiting for the hospital</Chip>
              <h2 className="fu-hero-title">{waiting[0].doctorName}</h2>
              <p className="fu-muted">{whenWords(waiting[0].startsAt, lang)} · {waiting[0].room}</p>
              <p>Nothing is booked until the hospital confirms.</p>
            </>
          ) : null}
        </Card>
        ) : null}
        {p ? (
          <InsightCard label="Before your visit" title="Get ready for your visit" meta={dayWords(new Date(p.appointment!.startsAt), lang)}
            lead={left ? `${left} ${left === 1 ? "step" : "steps"} left before your visit.` : "You are ready. Your doctor can read this before you arrive."}
            evidence={[
              { icon: "check", text: asked ? `${asked} of 3 questions saved for your doctor` : "No questions saved yet" },
              { icon: "check", text: p.shareReadings ? "Your last 7 days of readings will be shared" : "Your readings will not be shared" },
            ]}
            next={{ label: asked ? (p.shareReadings ? "Review my prep" : "Share this week's readings") : "Write your questions", step: asked ? "Check what your doctor will see." : "Ask up to three questions.", onAct: toPrep }} />
        ) : next ? (
          <InsightCard label="Before your visit" title="Bring a fresh reading" meta={dayWords(next.date, lang)}
            lead="A reading from home shows your care team how you are doing now."
            next={{ label: "Add a reading before you go", step: "It takes a minute.", to: "/care/readings" }} />
        ) : null}
      </div>

      <div className="fu-cols" data-cal>
        <MonthCalendar today={dayKey(now)} marks={marks} open={openTimes} lang={lang} />

        <Card className="fu-visits">
          <Tabs label="Visits" value={tab} onChange={setTab}
            tabs={[{ id: "upcoming", label: "Upcoming", count: upcoming.length + open.length }, { id: "past", label: "Past", count: past.length }]} />
          {requests.isError ? <p className="fu-muted">We couldn't load your requests. <Button onClick={() => requests.refetch()}>Try again</Button></p> : null}
          <ul className="fu-list">
            {tab === "upcoming" ? (
              <>
                {upcoming.map(v => {
                  const d = booked.get(v.id);
                  return (
                    <ListRow key={v.id} icon="calendar" title={v.title}
                      caption={`${whenWords(v.date, lang)}${d ? ` · ${d.doctorName} · ${d.room}` : ""}`}
                      trailing={
                        <span className="fu-row-end">
                          <Chip tone={d ? "done" : "neutral"}>{d ? "Confirmed" : inWords(v.inDays)}</Chip>
                        </span>
                      } />
                  );
                })}
                {open.map(r => (
                  <li key={r.id}>
                    <div>
                      <strong>{r.doctorName}</strong>
                      <span>{whenWords(r.startsAt, lang)} · {r.specialty} · {r.room}</span>
                      {r.note ? <span className="fu-muted">Care team: {r.note}</span> : null}
                      <span>
                        {r.status === "requested" ? <Chip tone="soon">Waiting for the hospital</Chip>
                          : r.status === "declined" ? <Chip>Not booked. Choose another time.</Chip>
                          : <Chip>{r.status}</Chip>}
                      </span>
                    </div>
                  </li>
                ))}
                {upcoming.length + open.length ? null : <li className="fu-muted">No visits coming up.</li>}
              </>
            ) : (
              <>
                {past.map(v => (
                  <li key={v.id}>
                    <div>
                      <strong>{v.title}</strong>
                      <span>{whenWords(v.date, lang)}</span>
                      <span>{v.status === "attended" ? <Chip tone="done">Attended</Chip> : <Chip>Not marked attended</Chip>}</span>
                    </div>
                    <Button to="/care/visit-summaries">Summary</Button>
                  </li>
                ))}
                {past.length ? null : <li className="fu-muted">No past visits yet.</li>}
              </>
            )}
          </ul>
        </Card>
      </div>

      <div className="fu-cols" data-two>
        <Booking lang={lang} />
        <div id="prep"><VisitPrep /></div>
      </div>
    </div>
  );
}


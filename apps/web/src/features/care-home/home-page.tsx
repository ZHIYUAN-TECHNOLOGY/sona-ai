import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Chip } from "@/components/primitives";
import { orpc } from "@/lib/orpc";

import { dosesToday, inDaysWords, langOf, nextStep } from "./model";

const lang = langOf(typeof navigator === "undefined" ? undefined : navigator.language);
const input = { lang };
const MALAYSIA = "Asia/Kuala_Lumpur";
const timeOf = (d: Date) => d.toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit", timeZone: MALAYSIA });
const dayOf = (d: Date) => d.toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long", timeZone: MALAYSIA });

export function CareHome({ firstName }: { firstName: string }) {
  const queryClient = useQueryClient();
  const plan = useQuery(orpc.care.discharge.queryOptions({ input }));
  const visits = useQuery(orpc.care.followUps.queryOptions({ input }));
  const taken = useQuery(orpc.care.doses.list.queryOptions());
  const checkIns = useQuery(orpc.care.checkIns.list.queryOptions());
  const clock = useQuery(orpc.care.clock.queryOptions());
  const take = useMutation(orpc.care.doses.take.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.care.doses.key() }),
  }));

  const header = <PageHeader title={`Hello, ${firstName}`} />;
  const failed = [plan, visits, taken, checkIns].find(q => q.isError);
  if (failed) {
    return (
      <>
        {header}
        <EmptyState>
          <p>We could not load your day. {failed.error?.message}</p>
          <Button variant="primary" onClick={() => void queryClient.invalidateQueries({ queryKey: orpc.care.key() })}>Try again</Button>
        </EmptyState>
      </>
    );
  }
  if (!plan.data || !visits.data || !taken.data || !checkIns.data) return <>{header}<EmptyState>Loading your day…</EmptyState></>;

  // The hospital's clock (it can run ahead of this computer's), as the phone app reads it.
  const now = new Date(Date.now() + (clock.data?.offsetMs ?? 0));
  const home = plan.data.status === "discharged" ? plan.data : undefined;
  // Stopped medicines are not taken: the same three groups as the phone app.
  const meds = home ? [...home.medicines.new, ...home.medicines.changed, ...home.medicines.continue] : [];
  const doses = dosesToday(meds, home?.dischargedAt, taken.data, now);
  const done = doses.filter(d => d.taken).length;
  const upcoming = doses.find(d => !d.taken);
  const step = nextStep(doses, checkIns.data, visits.data, now);
  const visit = visits.data.find(v => v.inDays >= 0);
  const waiting = checkIns.data.find(c => !c.replies.length && (c.sentAt || c.dueAt <= now));
  const lastAnswered = checkIns.data.findLast(c => c.replies.length > 0);
  const nextCheckIn = checkIns.data.find(c => !c.sentAt && c.dueAt > now);

  return (
    <div className="care-home">
      {header}

      <section className="care-home-lead" aria-label="Next for you">
        <p className="care-home-overline">Next for you</p>
        {step.kind === "dose" ? (
          <>
            <h2>Take {step.dose.name}</h2>
            <p>{step.dose.line}. Due at {timeOf(step.dose.dueAt)}.</p>
            <Button variant="primary" pending={take.isPending} onClick={() => take.mutate({ key: step.dose.key })}>I took it</Button>
            {take.isError ? <p role="alert">That did not save. {take.error.message} Please try again.</p> : null}
          </>
        ) : step.kind === "check-in" ? (
          <>
            <h2>Your check-in is waiting</h2>
            <p>Tell your care team how you feel today. It takes about a minute.</p>
            <Link className="btn btn-primary" to="/care/check-ins">Answer check-in</Link>
          </>
        ) : step.kind === "visit" ? (
          <>
            <h2>{step.visit.title} {inDaysWords(step.visit.inDays)}</h2>
            <p>{dayOf(step.visit.date)}.</p>
            <Link className="btn btn-primary" to="/care/follow-ups">See your visits</Link>
          </>
        ) : (
          <>
            <h2>All done for today</h2>
            <p>{home ? "Nothing needs you right now." : "You are still in hospital. Your plan shows here when you go home."}</p>
          </>
        )}
      </section>

      <Card title="Today's medicines">
        {doses.length === 0 ? <p>No medicines on a timer today.</p> : (
          <>
            <p>
              {done === doses.length ? <Chip tone="done">Every dose taken</Chip> : <Chip tone="soon">{doses.length - done} to take</Chip>}{" "}
              {done} of {doses.length} taken.{upcoming ? ` Next at ${timeOf(upcoming.dueAt)}: ${upcoming.name}.` : ""}
            </p>
          </>
        )}
        <Link className="care-home-link" to="/care/medicines">See medicines</Link>
      </Card>

      <Card title="Next visit">
        {visit ? <p>{visit.title}, {inDaysWords(visit.inDays)}. {dayOf(visit.date)}.</p> : <p>No visits booked.</p>}
        <Link className="care-home-link" to="/care/follow-ups">See follow-ups</Link>
      </Card>

      <Card title="Check-in">
        <p>
          {waiting ? <><Chip tone="soon">Waiting</Chip> Your check-in is waiting.</>
            : lastAnswered ? <><Chip tone="done">Sent</Chip> Day {lastAnswered.day} check-in sent to your care team.{nextCheckIn ? ` Next one on ${dayOf(nextCheckIn.dueAt)}.` : ""}</>
            : nextCheckIn ? `Your first check-in is on ${dayOf(nextCheckIn.dueAt)}.`
            : "No check-ins planned."}
        </p>
        <Link className="care-home-link" to="/care/check-ins">See check-ins</Link>
      </Card>

      {home?.warningSigns.length ? (
        <section className="care-home-call" aria-labelledby="care-home-call-title">
          <h2 id="care-home-call-title">Call the hospital now if</h2>
          <ul>{home.warningSigns.map(sign => <li key={sign}>{sign}</li>)}</ul>
          <a className="btn btn-danger" href="tel:999">Call 999</a>
          <p>Can't call from here? Dial 999 from any phone.</p>
        </section>
      ) : null}
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ReactNode } from "react";

import { type IconName } from "@/components/icon";
import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Chip, type ChipTone, ListCard, ListRow, StatCard, StatRow } from "@/components/primitives";
import { orpc } from "@/lib/orpc";

import { dosesToday, inDaysWords, langOf, nextStep, partOfDay } from "./model";

const lang = langOf(typeof navigator === "undefined" ? undefined : navigator.language);
const input = { lang };
const MALAYSIA = "Asia/Kuala_Lumpur";
const timeOf = (d: Date) => d.toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit", timeZone: MALAYSIA });
const dayOf = (d: Date) => d.toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long", timeZone: MALAYSIA });

const shortDay = (d: Date) => d.toLocaleDateString(lang, { day: "numeric", month: "short", timeZone: MALAYSIA });
/** A row title with a small chip above it that says what kind of thing it is. */
function Over({ chip, tone = "neutral", children }: { chip: string; tone?: ChipTone; children: ReactNode }) {
  return <span className="care-home-over"><Chip tone={tone}>{chip}</Chip><span>{children}</span></span>;
}

export function CareHome({ firstName }: { firstName: string }) {
  const queryClient = useQueryClient();
  const plan = useQuery(orpc.care.discharge.queryOptions({ input }));
  const visits = useQuery(orpc.care.followUps.queryOptions({ input }));
  const taken = useQuery(orpc.care.doses.list.queryOptions());
  const checkIns = useQuery(orpc.care.checkIns.list.queryOptions());
  const clock = useQuery(orpc.care.clock.queryOptions());
  // Messages are a row in "Coming up" only: the page still shows if they fail to load.
  const thread = useQuery(orpc.care.messages.list.queryOptions());
  const take = useMutation(orpc.care.doses.take.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.care.doses.key() }),
  }));

  // The hospital's clock (it can run ahead of this computer's), as the phone app reads it.
  const now = new Date(Date.now() + (clock.data?.offsetMs ?? 0));
  const header = (
    <PageHeader title={`Good ${partOfDay(now)}, ${firstName}`} lead="Here is your day: what to take, what is next and who is waiting to hear from you."
      actions={<Button variant="primary" to="/care/discharge-plan">See your plan</Button>} />
  );
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

  const messages = thread.data ?? [];
  const lastMessage = messages.at(-1);
  const waitingCount = checkIns.data.filter(c => !c.replies.length && (c.sentAt || c.dueAt <= now)).length;
  const isDue = (d: { dueAt: Date }) => d.dueAt.getTime() - now.getTime() <= 30 * 60_000;

  // What the next step rests on: the same numbers the cards below show.
  const evidence: { icon: IconName; text: string }[] = [
    ...(doses.length ? [{ icon: "pill" as const, text: `${done} of ${doses.length} doses taken today` }] : []),
    ...(visit && step.kind !== "visit" ? [{ icon: "calendar" as const, text: `${visit.title} ${inDaysWords(visit.inDays)}` }] : []),
    ...(step.kind === "check-in" ? []
      : waitingCount ? [{ icon: "clipboard" as const, text: waitingCount === 1 ? "1 check-in waiting" : `${waitingCount} check-ins waiting` }]
      : nextCheckIn ? [{ icon: "clipboard" as const, text: `Next check-in on ${shortDay(nextCheckIn.dueAt)}` }]
      : [{ icon: "clipboard" as const, text: "No check-ins waiting" }]),
    ...(lastMessage && lastMessage.from !== "patient" ? [{ icon: "message" as const, text: "Your care team sent you a message" }] : []),
  ];
  const insight =
    step.kind === "dose" ? {
      title: `Take ${step.dose.name}`,
      lead: take.isError ? `That did not save. ${take.error.message} Please try again.` : `${step.dose.line}. Due at ${timeOf(step.dose.dueAt)}.`,
      next: { label: "I took it", step: "Tap when you have taken it.", pending: take.isPending, onAct: () => take.mutate({ key: step.dose.key }) },
    } : step.kind === "check-in" ? {
      title: "Your check-in is waiting",
      lead: "Tell your care team how you feel today. It takes about a minute.",
      next: { label: "Answer check-in", step: "Answer a few short questions.", to: "/care/check-ins" as const },
    } : step.kind === "visit" ? {
      title: `${step.visit.title} ${inDaysWords(step.visit.inDays)}`,
      lead: `${dayOf(step.visit.date)}.`,
      next: { label: "See your visit", step: "Check the time and what to bring.", to: "/care/follow-ups" as const },
    } : {
      title: "All done for today",
      lead: home ? "Nothing needs you right now." : "You are still in hospital. Your plan shows here when you go home.",
      next: undefined,
    };

  return (
    <div className="care-home">
      {header}

      <StatRow>
        {doses.length ? (
          <StatCard title="Doses taken today" value={done} unit={`of ${doses.length}`} progress={done / doses.length}
            caption={upcoming ? `Next at ${timeOf(upcoming.dueAt)}` : "Every dose taken"} />
        ) : null}
        <StatCard title="Next visit" value={visit ? shortDay(visit.date) : "None"} caption={visit ? `${visit.title}, ${inDaysWords(visit.inDays)}` : "No visits booked"} />
        <StatCard title="Check-ins waiting" value={waitingCount}
          caption={waitingCount ? "Your care team is waiting to hear from you" : nextCheckIn ? `Next one on ${shortDay(nextCheckIn.dueAt)}` : "Nothing to answer"} />
      </StatRow>

      <div className="care-home-grid">
        <InsightCard label="Next for you" title={insight.title} lead={insight.lead} evidence={evidence} next={insight.next} />

        <ListCard title="Today's medicines" action={{ label: "All medicines", to: "/care/medicines" }}>
          {doses.length === 0 ? (
            <li><EmptyState icon="pill" title="No medicines on a timer today">{home ? "Your full list is under All medicines." : "Your medicines show here when you go home."}</EmptyState></li>
          ) : doses.map(d => (
            <ListRow key={d.key} icon="pill" title={d.name} caption={`${d.line} · ${timeOf(d.dueAt)}`}
              trailing={d.taken ? <span className="care-home-quiet">Taken</span> : isDue(d) ? <Chip tone="amber">Due</Chip> : <span className="care-home-quiet">{timeOf(d.dueAt)}</span>} />
          ))}
        </ListCard>

        <ListCard title="Coming up">
          {visit ? (
            <ListRow to="/care/follow-ups" icon="calendar" title={<Over chip="Visit">{visit.title}</Over>}
              caption={`${shortDay(visit.date)}, ${inDaysWords(visit.inDays)}`} trailing={<span className="care-home-act">Prepare</span>} />
          ) : null}
          {waiting || lastAnswered || nextCheckIn ? (
            <ListRow to="/care/check-ins" icon="clipboard"
              title={<Over chip="Check-in" tone={waiting ? "amber" : "neutral"}>{waiting ? "Your check-in is waiting" : nextCheckIn ? `Next check-in on ${shortDay(nextCheckIn.dueAt)}` : "No more check-ins planned"}</Over>}
              caption={waiting ? "It takes about a minute" : lastAnswered ? `Day ${lastAnswered.day} check-in sent to your care team` : "Your first one"}
              trailing={<span className="care-home-act">{waiting ? "Answer" : "View"}</span>} />
          ) : null}
          {lastMessage ? (
            <ListRow to="/care/messages" icon="message" title={<Over chip="Message">{lastMessage.from === "patient" ? "You wrote" : "From your care team"}</Over>}
              caption={<span className="care-home-clip">{lastMessage.text}</span>} trailing={<span className="care-home-act">{lastMessage.from === "patient" ? "View" : "Reply"}</span>} />
          ) : null}
          {!visit && !waiting && !lastAnswered && !nextCheckIn && !lastMessage ? (
            <li><EmptyState icon="calendar" title="Nothing coming up">Visits, check-ins and messages show here.</EmptyState></li>
          ) : null}
        </ListCard>
      </div>

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

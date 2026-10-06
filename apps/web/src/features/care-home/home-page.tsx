import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { type IconName } from "@/components/icon";
import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Chip, ListCard, ListRow, StatCard, StatRow } from "@/components/primitives";
import { orpc } from "@/lib/orpc";

import { dayLead, dosesToday, inDaysWords, langOf, nextStep, partOfDay } from "./model";

const lang = langOf(typeof navigator === "undefined" ? undefined : navigator.language);
const input = { lang };
const MALAYSIA = "Asia/Kuala_Lumpur";
const timeOf = (d: Date) => d.toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit", timeZone: MALAYSIA });
const dayOf = (d: Date) => d.toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long", timeZone: MALAYSIA });

const shortDay = (d: Date) => d.toLocaleDateString(lang, { day: "numeric", month: "short", timeZone: MALAYSIA });
/** Rail: the places a patient goes from here; static, so built once. */
const MORE = (
  <ListCard title="More for you">
    <ListRow to="/care/ask" icon="sparkle" title="Ask Sona" caption="Ask a question in your own words" />
    <ListRow to="/care/discharge-plan" icon="clipboard" title="Your discharge plan" caption="What to do at home, step by step" />
    <ListRow to="/care/medicines" icon="pill" title="All medicines" caption="What each one is for and how to take it" />
  </ListCard>
);

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
  const title = `Good ${partOfDay(now)}, ${firstName}`;
  const header = <PageHeader title={title} />;
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
  const nextCheckIn = checkIns.data.find(c => !c.sentAt && c.dueAt > now);

  const messages = thread.data ?? [];
  const lastMessage = messages.at(-1);
  const waitingCount = checkIns.data.filter(c => !c.replies.length && (c.sentAt || c.dueAt <= now)).length;

  // What the next step rests on: the same numbers the cards below show.
  const evidence: { icon: IconName; text: string }[] = [
    ...(doses.length ? [{ icon: "pill" as const, text: `${done} of ${doses.length} doses taken today` }] : []),
    ...(visit && step.kind !== "visit" ? [{ icon: "calendar" as const, text: `${visit.title} ${inDaysWords(visit.inDays)}` }] : []),
    ...(step.kind === "check-in" ? []
      : waitingCount ? [{ icon: "clipboard" as const, text: waitingCount === 1 ? "1 check-in waiting" : `${waitingCount} check-ins waiting` }]
      : nextCheckIn ? [{ icon: "clipboard" as const, text: `Next check-in on ${shortDay(nextCheckIn.dueAt)}` }]
      : []),
    ...(lastMessage && lastMessage.from !== "patient" ? [{ icon: "message" as const, text: "Your care team sent you a message" }] : []),
  ];
  const insight =
    step.kind === "dose" ? {
      title: `Take ${step.dose.name}`,
      lead: `${step.dose.line}. Due at ${timeOf(step.dose.dueAt)}.`,
      next: { label: "I took it", step: "Tap when you have taken it.", pending: take.isPending, onAct: () => take.mutate({ key: step.dose.key }) },
    } : step.kind === "check-in" ? {
      title: "Your check-in is waiting",
      lead: "Tell your care team how you feel today. It takes about a minute.",
      next: { label: "Answer check-in", step: "Answer a few short questions.", to: "/care/check-ins" as const },
    } : step.kind === "visit" ? {
      title: `${step.visit.title} ${inDaysWords(step.visit.inDays)}`,
      lead: `${dayOf(step.visit.date)} at ${timeOf(step.visit.date)}.`,
      next: { label: "See your visit", step: "Check the time and what to bring.", to: "/care/follow-ups" as const },
    } : {
      title: "All done for today",
      lead: home ? "Nothing needs you right now." : "You are still in hospital. Your plan shows here when you go home.",
      next: undefined,
    };

  const visitWords = visit ? (visit.inDays === 0 ? `today at ${timeOf(visit.date)}` : `${inDaysWords(visit.inDays)}, on ${shortDay(visit.date)}`) : undefined;
  const visitCaption = visit ? `${shortDay(visit.date)}, ${timeOf(visit.date)}` : "";
  const stepDoseKey = step.kind === "dose" ? step.dose.key : undefined;
  const marked = take.isSuccess ? doses.find(d => d.key === take.variables.key) : undefined;

  // Only numbers that say something now; one alone is already in the lead and the panel.
  const stats = [
    ...(doses.length ? [<StatCard key="doses" title="Doses taken today" value={done} unit={`of ${doses.length}`} progress={done / doses.length}
      caption={upcoming ? `Next at ${timeOf(upcoming.dueAt)}` : "Every dose taken"} />] : []),
    ...(visit ? [<StatCard key="visit" title="Next visit" value={shortDay(visit.date)} caption={`${visit.title}, ${visit.inDays === 0 ? visitWords : inDaysWords(visit.inDays)}`} />] : []),
    ...(waitingCount ? [<StatCard key="check-ins" title="Check-ins waiting" value={waitingCount} caption="Your care team is waiting to hear from you" />] : []),
  ];

  // One timeline: doses, the visit and the check-in in time order; the latest message closes it.
  // The row that is the panel's next step carries no second button for the same action.
  const rows = [
    ...doses.map(d => ({ at: d.dueAt.getTime(), row: (
      <ListRow key={d.key} icon="pill" title={d.name} caption={`${d.line} · ${timeOf(d.dueAt)}`}
        trailing={d.taken ? <span className="care-home-quiet">Taken</span>
          : d.key === stepDoseKey ? <Chip tone="amber">Due</Chip>
          : <Button pending={take.isPending && take.variables.key === d.key} disabled={take.isPending} onClick={() => take.mutate({ key: d.key })}>I took it</Button>} />
    ) })),
    ...(visit ? [{ at: visit.date.getTime(), row: step.kind === "visit" ? (
      <ListRow key="visit" icon="calendar" title={visit.title} caption={visitCaption} trailing={<span className="care-home-quiet">{inDaysWords(visit.inDays)}</span>} />
    ) : (
      <ListRow key="visit" to="/care/follow-ups" icon="calendar" title={visit.title} caption={visitCaption} trailing={<span className="care-home-act">Prepare</span>} />
    ) }] : []),
    ...(waiting ? [{ at: waiting.dueAt.getTime(), row: step.kind === "check-in" ? (
      <ListRow key="check-in" icon="clipboard" title="Your check-in is waiting" caption="It takes about a minute" trailing={<Chip tone="amber">Waiting</Chip>} />
    ) : (
      <ListRow key="check-in" to="/care/check-ins" icon="clipboard" title="Your check-in is waiting" caption="It takes about a minute" trailing={<span className="care-home-act">Answer</span>} />
    ) }] : nextCheckIn ? [{ at: nextCheckIn.dueAt.getTime(), row: (
      <ListRow key="check-in" to="/care/check-ins" icon="clipboard" title={`Next check-in on ${shortDay(nextCheckIn.dueAt)}`} caption="A few short questions from your care team" trailing={<span className="care-home-act">View</span>} />
    ) }] : []),
  ].sort((a, b) => a.at - b.at).map(r => r.row);

  return (
    <div className="care-home">
      <PageHeader title={title} lead={dayLead(doses.length - done, waitingCount, visitWords, Boolean(home))} />

      {stats.length > 1 ? <StatRow>{stats}</StatRow> : null}

      <div className="care-home-grid">
        <div className="care-home-col">
          <InsightCard label="Next for you" title={insight.title} lead={insight.lead} evidence={evidence} next={insight.next} />

          <ListCard title="Today">
            {home ? null : <ListRow icon="pill" title="Your medicines start when you go home" caption="Each dose will show here with a button to mark it taken." />}
            {rows}
            {lastMessage ? (
              <ListRow to="/care/messages" icon="message" title={lastMessage.from === "patient" ? "You wrote to your care team" : "From your care team"}
                caption={lastMessage.text} trailing={<span className="care-home-act">{lastMessage.from === "patient" ? "View" : "Reply"}</span>} />
            ) : null}
            {home && !rows.length && !lastMessage ? (
              <li><EmptyState icon="calendar" title="Nothing on today">Doses, visits, check-ins and messages show here.</EmptyState></li>
            ) : null}
            <li className="care-home-status" role="status" aria-live="polite">
              {take.isError ? `That did not save. ${take.error.message} Please try again.` : marked ? `Saved. ${marked.name} at ${timeOf(marked.dueAt)} is marked as taken.` : null}
            </li>
          </ListCard>
        </div>

        <div className="care-home-col">
          {home?.warningSigns.length ? (
            <section className="care-home-call" aria-labelledby="care-home-call-title">
              <h2 id="care-home-call-title">Call the hospital now if</h2>
              <ul>{home.warningSigns.map(sign => <li key={sign}>{sign}</li>)}</ul>
              <a className="btn btn-danger" href="tel:999">Call 999</a>
              <p>Can't call from here? Dial 999 from any phone.</p>
            </section>
          ) : null}
          {MORE}
        </div>
      </div>
    </div>
  );
}

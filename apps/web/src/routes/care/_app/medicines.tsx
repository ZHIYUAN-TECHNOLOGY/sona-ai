import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Icon } from "@/components/icon";
import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Chip, ListCard, ListRow, StatCard, StatRow } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { type Dose, dosesToday, dueSoon, early, langOf, nextDose, timeOf, weekDots, whenWords } from "@/features/care-medicines/model";
import { MedicinePhoto } from "@/features/care-medicines/photo";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-medicines.css";

export const Route = createFileRoute("/care/_app/medicines")({ component: Page });

const GROUPS = ["new", "changed", "continue", "stopped"] as const;
const DOT_WORDS = { done: "taken", missed: "not marked", upcoming: "to come" };
const lang = langOf(typeof navigator === "undefined" ? undefined : navigator.language);

type RowProps = { doses: Dose[]; now: Date; confirming?: string; primaryKey?: string; pendingKey?: string; busy: boolean; ask: (key?: string) => void; take: (key: string) => void };

/** One status per medicine: its first dose of today that is not marked yet. Marking cannot be undone, so it asks first. */
function DoseStatus({ doses, now, confirming, primaryKey, pendingKey, busy, ask, take }: RowProps) {
  const d = doses.find(x => !x.taken);
  if (!d) return <span className="med-taken"><Icon name="check" size={18} />Taken today</span>;
  if (early(d.dueAt, now)) return <span className="med-muted">Next {timeOf(d.dueAt, lang)}</span>;
  if (confirming === d.key || pendingKey === d.key)
    return <span className="med-due" role="group" aria-label={`Mark ${d.name} as taken?`}>
      <span className="med-ask">Mark {d.name} as taken?</span>
      <Button variant="primary" pending={pendingKey === d.key} disabled={busy} onClick={() => take(d.key)}>Yes, I took it</Button>
      <Button disabled={busy} onClick={() => ask(undefined)}>Not yet</Button>
    </span>;
  const late = d.dueAt.getTime() < now.getTime();
  return <span className="med-due">
    {late || dueSoon(d.dueAt, now) ? <Chip tone="soon">{late ? `Was due ${timeOf(d.dueAt, lang)}` : "Due now"}</Chip> : <span className="med-muted">Due {timeOf(d.dueAt, lang)}</span>}
    <Button variant={primaryKey === d.key ? "primary" : "secondary"} disabled={busy} onClick={() => ask(d.key)} aria-label={`I took ${d.name}, ${timeOf(d.dueAt, lang)}`}>I took it</Button>
  </span>;
}

function Page() {
  const queryClient = useQueryClient();
  // Three independent reads, started together.
  const plan = useQuery(orpc.care.discharge.queryOptions({ input: { lang } }));
  const takenQuery = useQuery(orpc.care.doses.list.queryOptions());
  const clock = useQuery(orpc.care.clock.queryOptions());
  const [confirming, setConfirming] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const take = useMutation(orpc.care.doses.take.mutationOptions({
    onSuccess: () => { setConfirming(undefined); return queryClient.invalidateQueries({ queryKey: orpc.care.doses.key() }); },
  }));
  // "Now" follows the hospital's clock and moves on each minute.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setTick(Date.now()), 60_000); return () => clearInterval(id); }, []);

  const alone = (body: React.ReactNode) => <><PageHeader title="Medicines" lead="What to take and when, once you are home." /><Card className="meds-alone">{body}</Card></>;
  if (plan.isPending || takenQuery.isPending || clock.isPending) return alone(<EmptyState icon="pill" title="Getting your medicines…" />);
  if (plan.isError || takenQuery.isError || clock.isError)
    return alone(
      <EmptyState icon="info" title="We couldn't open your medicines" action={<Button onClick={() => { void plan.refetch(); void takenQuery.refetch(); void clock.refetch(); }}>Try again</Button>}>
        Check your connection and try again.
      </EmptyState>,
    );
  if (plan.data.status !== "discharged")
    return alone(
      <EmptyState icon="pill" title="Your medicines show here once you go home" action={<Button to="/care/ask">Ask Sona about your medicines</Button>}>
        Your care team gives them to you on the ward for now.
      </EmptyState>,
    );

  const now = new Date(tick + clock.data.offsetMs);
  const { medicines, dischargedAt } = plan.data;
  const meds = [...medicines.new, ...medicines.changed, ...medicines.continue];
  const taken = takenQuery.data;
  const today = dosesToday(meds, dischargedAt, taken, now);
  const next = nextDose(meds, dischargedAt, taken, now);
  const week = weekDots(meds, dischargedAt, taken, now, lang);
  const left = today.filter(d => !d.taken).length;
  const pendingKey = take.isPending ? take.variables.key : undefined;

  const done = today.length - left;
  const dots = week.flatMap(d => d.dots), weekDone = dots.filter(d => d.state === "done").length, weekMissed = dots.filter(d => d.state === "missed").length;
  const late = today.filter(d => !d.taken && d.dueAt.getTime() < now.getTime());
  const duePast = dots.filter(d => d.state !== "upcoming").length;
  // The one filled button: the confirm step when open, else the earliest dose that can be marked.
  const primaryKey = confirming ?? today.find(d => !d.taken && !early(d.dueAt, now))?.key;
  const markTaken = (key: string) => { const d = today.find(x => x.key === key); setSaved(undefined); take.mutate({ key }, { onSuccess: () => setSaved(d ? `Saved: ${d.name} marked as taken. Your care team can see it.` : "Saved.") }); };
  const lateNames = [...new Set(late.map(d => d.name))];
  const nextTime = late.length ? ` ${late.length} late.` : next ? ` Next: ${whenWords(next.dueAt, now, lang).replace(/^today at /, "")}.` : "";
  const insight = late.length
    ? { title: late.length === 1 ? "One dose is late" : `${late.length} doses are late`, lead: `${lateNames.length <= 2 ? `${lateNames.join(" and ")}: take` : "Take"} ${late.length === 1 ? "it" : "them"} now if you still can, or tell your care team.`, next: { label: "Message your care team", step: "Tell them if a dose is hard to take.", to: "/care/messages" as const } }
    : { title: "You are on track", lead: left ? `${left} ${left === 1 ? "dose" : "doses"} still to take today. Nothing is late.` : next ? `Nothing more to take for now. Next: ${next.name}, ${whenWords(next.dueAt, now, lang)}.` : "Nothing to take for now.", next: { label: "Ask Sona about a medicine", step: "Not sure what one is for or how to take it?", to: "/care/ask" as const } };

  return (
    <>
      <PageHeader title="Medicines" lead={today.length ? (left ? `${left} ${left === 1 ? "dose" : "doses"} left today.${nextTime}` : "All of today's doses are taken.") : `Nothing due today.${nextTime}`} />
      <WithRail rail={
        <RightRail label="Medicine help">
          {meds.length > 0 ? <InsightCard label="Sona" title={insight.title} lead={insight.lead} next={insight.next}
            evidence={duePast ? [{ icon: "pill", text: `Last 7 days: ${weekDone} of ${duePast} doses marked taken${weekMissed ? `, ${weekMissed} not marked` : ""}` }] : undefined} /> : null}
          <MedicinePhoto />
        </RightRail>
      }>
        <div className="med-page">
          {today.length > 0 || next ? <StatRow>
            {today.length > 0 ? <StatCard feature title="Taken today" value={done} unit={`of ${today.length}`} progress={done / today.length} caption={left ? `${left} still to take` : "All done for today"} /> : null}
            {next ? <StatCard title="Next dose" value={timeOf(next.dueAt, lang)} caption={`${next.name}, ${whenWords(next.dueAt, now, lang)}`} /> : null}
          </StatRow> : null}
          <p className="med-status" aria-live="polite">{take.isError ? <span role="alert" className="med-note">Not saved. Check your connection and try again.</span> : saved ? <span className="med-saved"><Icon name="check" size={18} />{saved}</span> : null}</p>
          {meds.length + medicines.stopped.length === 0 ? <Card title="Your medicines"><p>Your plan lists no medicines to take at home.</p></Card> : (
            <ListCard title="Your medicines">
              {GROUPS.flatMap(group => medicines[group].map(m => (
                <ListRow key={`${group}-${m.name}`} icon="pill"
                  title={<><span className="med-name">{m.name}</span> <span className="med-dose">{m.line}</span></>}
                  caption={group === "stopped" ? "Stopped. Do not take this one." : m.finished ? "Finished. No more doses." : m.take ? `${m.take}${m.at?.length ? `, at ${m.at.join(" and ")}` : ""}` : group === "new" ? "New for you" : group === "changed" ? "The dose changed" : undefined}
                  trailing={group === "stopped" ? <Chip>Stopped</Chip> : m.finished ? <Chip>Finished</Chip> : (today.some(d => d.name === m.name) ? <DoseStatus doses={today.filter(d => d.name === m.name)} now={now} confirming={confirming} primaryKey={primaryKey} pendingKey={pendingKey} busy={take.isPending} ask={setConfirming} take={markTaken} /> : null) ?? (group === "new" ? <Chip tone="info">New</Chip> : group === "changed" ? <Chip tone="soon">Changed</Chip> : undefined)} />
              )))}
            </ListCard>
          )}
          {dots.length > 0 ? <Card title="This week">
            <ol className="med-week">
              {week.map(d => (
                <li key={d.x} data-today={d.today || undefined} aria-label={`${d.x}: ${d.dots.length ? d.dots.map(x => DOT_WORDS[x.state]).join(", ") : "no doses"}`}>
                  <span className="med-day">{d.x}</span>
                  <span className="med-dots">{d.dots.length ? d.dots.map(x => <i key={x.key} data-state={x.state}>{x.state === "done" ? <Icon name="check" size={14} /> : null}</i>) : <span className="med-muted">–</span>}</span>
                </li>
              ))}
            </ol>
            <p className="med-legend"><span><i data-state="done"><Icon name="check" size={14} /></i>Taken</span><span><i data-state="missed" />Not marked</span><span><i data-state="upcoming" />To come</span></p>
          </Card> : null}
        </div>
      </WithRail>
    </>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Icon } from "@/components/icon";
import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Chip, ListCard, ListRow, StatCard, StatRow } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { dosesToday, dueSoon, early, langOf, nextDose, timeOf, weekDots, whenWords } from "@/features/care-medicines/model";
import { MedicinePhoto } from "@/features/care-medicines/photo";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-medicines.css";

export const Route = createFileRoute("/care/_app/medicines")({ component: Page });

const GROUPS = ["new", "changed", "continue", "stopped"] as const;
const DOT_WORDS = { done: "taken", missed: "not marked", upcoming: "to come" };
const lang = langOf(typeof navigator === "undefined" ? undefined : navigator.language);

function Page() {
  const queryClient = useQueryClient();
  // Three independent reads, started together.
  const plan = useQuery(orpc.care.discharge.queryOptions({ input: { lang } }));
  const takenQuery = useQuery(orpc.care.doses.list.queryOptions());
  const clock = useQuery(orpc.care.clock.queryOptions());
  const take = useMutation(orpc.care.doses.take.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.care.doses.key() }),
  }));
  // "Now" follows the hospital's clock and moves on each minute.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setTick(Date.now()), 60_000); return () => clearInterval(id); }, []);

  if (plan.isPending || takenQuery.isPending || clock.isPending)
    return <><PageHeader title="Medicines" /><EmptyState>Getting your medicines…</EmptyState></>;
  if (plan.isError || takenQuery.isError || clock.isError)
    return (
      <><PageHeader title="Medicines" />
        <EmptyState>We couldn't open your medicines. Check your connection and try again.
          <Button onClick={() => { void plan.refetch(); void takenQuery.refetch(); void clock.refetch(); }}>Try again</Button>
        </EmptyState></>
    );
  if (plan.data.status !== "discharged")
    return <><PageHeader title="Medicines" /><EmptyState>Your medicines show here once you go home. Your care team gives them to you on the ward for now.</EmptyState></>;

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
  // One status per medicine: its first dose of today that is not marked yet.
  const status = (name: string) => {
    const mine = today.filter(d => d.name === name), d = mine.find(x => !x.taken);
    if (!mine.length) return null;
    if (!d) return <span className="med-taken"><Icon name="check" size={18} />Taken</span>;
    if (early(d.dueAt, now)) return <span className="med-muted">Next {timeOf(d.dueAt, lang)}</span>;
    return <span className="med-due">
      <Chip tone="soon">{dueSoon(d.dueAt, now) ? "Due now" : `Due ${timeOf(d.dueAt, lang)}`}</Chip>
      <Button pending={pendingKey === d.key} disabled={take.isPending} onClick={() => take.mutate({ key: d.key })} aria-label={`Mark ${d.name} taken, ${timeOf(d.dueAt, lang)}`}>Mark taken</Button>
    </span>;
  };

  return (
    <>
      <PageHeader title="Medicines" lead={today.length ? (left ? `${left} ${left === 1 ? "dose" : "doses"} left today.` : "All of today's doses are taken.") : "Nothing due today."} />
      <StatRow>
        <StatCard feature title="Taken today" value={done} unit={`of ${today.length}`} progress={today.length ? done / today.length : 0} caption={left ? `${left} still to take` : today.length ? "All done for today" : "No doses due today"} />
        <StatCard title="On your list" value={meds.length} unit={meds.length === 1 ? "medicine" : "medicines"} caption={medicines.stopped.length ? `${medicines.stopped.length} stopped` : "From your discharge plan"} />
        <StatCard title="Next dose" value={next ? timeOf(next.dueAt, lang) : "None"} caption={next ? `${next.name}, ${whenWords(next.dueAt, now, lang)}` : "Nothing to take for now"} />
      </StatRow>
      <WithRail rail={
        <RightRail label="Medicine help">
          {dots.length > 0 && <InsightCard label="Your week" title={`${weekDone} of ${dots.length} doses marked taken`}
            lead={weekMissed ? `${weekMissed} ${weekMissed === 1 ? "dose was" : "doses were"} not marked taken in the last 7 days.` : "No dose was left unmarked in the last 7 days."}
            evidence={[{ icon: "pill", text: `Today: ${done} of ${today.length} taken` }, ...(next ? [{ text: `Next: ${next.name}, ${whenWords(next.dueAt, now, lang)}` }] : [])]}
            next={weekMissed ? { label: "Message care team", step: "Tell your care team if a dose is hard to take.", to: "/care/messages" } : undefined} />}
          <MedicinePhoto />
        </RightRail>
      }>
        <div className="med-page" aria-live="polite">
          {take.isError && <p role="alert" className="med-note">Not saved. Check your connection and try again.</p>}
          {meds.length + medicines.stopped.length === 0 ? <Card title="Your medicines"><p>Your plan lists no medicines to take at home.</p></Card> : (
            <ListCard title="Your medicines">
              {GROUPS.flatMap(group => medicines[group].map(m => (
                <ListRow key={`${group}-${m.name}`} icon="pill"
                  title={<><span className="med-name">{m.name}</span> <span className="med-dose">{m.line}</span></>}
                  caption={group === "stopped" ? "Stopped. Do not take this one." : m.finished ? "Finished. No more doses." : m.take ? `${m.take}${m.at?.length ? `, at ${m.at.join(" and ")}` : ""}` : group === "new" ? "New for you" : group === "changed" ? "The dose changed" : undefined}
                  trailing={group === "stopped" ? <Chip>Stopped</Chip> : m.finished ? <Chip>Finished</Chip> : status(m.name) ?? (group === "new" ? <Chip tone="info">New</Chip> : group === "changed" ? <Chip tone="soon">Changed</Chip> : undefined)} />
              )))}
            </ListCard>
          )}
          {dots.length > 0 && <Card title="This week">
            <ol className="med-week">
              {week.map(d => (
                <li key={d.x} data-today={d.today || undefined} aria-label={`${d.x}: ${d.dots.length ? d.dots.map(x => DOT_WORDS[x.state]).join(", ") : "no doses"}`}>
                  <span className="med-day">{d.x}</span>
                  <span className="med-dots">{d.dots.length ? d.dots.map(x => <i key={x.key} data-state={x.state}>{x.state === "done" && <Icon name="check" size={14} />}</i>) : <span className="med-muted">–</span>}</span>
                </li>
              ))}
            </ol>
            <p className="med-legend"><span><i data-state="done"><Icon name="check" size={14} /></i>Taken</span><span><i data-state="missed" />Not marked</span><span><i data-state="upcoming" />To come</span></p>
          </Card>}
        </div>
      </WithRail>
    </>
  );
}

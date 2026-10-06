import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { BarChart } from "@/components/charts";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Chip } from "@/components/primitives";
import { dosesToday, dueSoon, early, langOf, nextDose, partOf, timeOf, weekTaken, whenWords, type Dose, type Part } from "@/features/care-medicines/model";
import { MedicinePhoto } from "@/features/care-medicines/photo";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-medicines.css";

export const Route = createFileRoute("/care/_app/medicines")({ component: Page });

const PARTS: Part[] = ["Morning", "Afternoon", "Evening", "Night"];
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
  const week = weekTaken(meds, dischargedAt, taken, now, lang);
  const left = today.filter(d => !d.taken).length;
  const pendingKey = take.isPending ? take.variables.key : undefined;

  const takeButton = (d: Dose, variant: "primary" | "quiet" = "quiet") =>
    <Button variant={variant} pending={pendingKey === d.key} disabled={take.isPending} onClick={() => take.mutate({ key: d.key })} aria-label={`I took ${d.name}, ${timeOf(d.dueAt, lang)}`}>I took it</Button>;

  return (
    <>
      <PageHeader title="Medicines" lead={today.length ? (left ? `${left} of ${today.length} doses left today.` : "All of today's doses are taken.") : undefined} />

      <section className="med-lead glass" data-tone={next && dueSoon(next.dueAt, now) ? "soon" : "info"} aria-live="polite">
        {next ? <>
          <p className="med-eyebrow">Take next</p>
          <h2>{next.name}</h2>
          <p>{next.line}</p>
          <p><strong>{whenWords(next.dueAt, now, lang)}</strong>{now > next.dueAt ? " · it is past time, take it now" : ""}</p>
          {early(next.dueAt, now) ? <p className="med-muted">It is not time yet. You can mark it from {timeOf(new Date(next.dueAt.getTime() - 2 * 3600_000), lang)}.</p> : takeButton(next, "primary")}
        </> : <p>{meds.some(m => m.at?.length) ? "Nothing to take for now. Well done." : "Your plan has no timed doses. Take your medicines as the list below says."}</p>}
        {take.isError && <p role="alert" className="med-note">Not saved. Check your connection and try again.</p>}
      </section>

      {today.length > 0 && <Card title="Today">
        {PARTS.map(part => {
          const doses = today.filter(d => partOf(d.dueAt) === part);
          return doses.length === 0 ? null : (
            <div key={part} className="med-part">
              <h3>{part}</h3>
              <ul className="med-doses">
                {doses.map(d => (
                  <li key={d.key}>
                    <span className="med-time">{timeOf(d.dueAt, lang)}</span>
                    <span className="med-what"><strong>{d.name}</strong><span>{d.line}</span></span>
                    {d.taken ? <Chip tone="done">Taken</Chip>
                      : early(d.dueAt, now) ? <Chip>Later</Chip>
                      : <>{dueSoon(d.dueAt, now) && <Chip tone="soon">{now > d.dueAt ? "Due" : "Due soon"}</Chip>}{takeButton(d)}</>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </Card>}

      <Card title="Your medicines">
        {meds.length + medicines.stopped.length === 0 ? <p>Your plan lists no medicines to take at home.</p> : (
          <ul className="med-list">
            {(["new", "changed", "continue", "stopped"] as const).flatMap(group => medicines[group].map(m => (
              <li key={`${group}-${m.name}`}>
                <p><strong>{m.name}</strong> {group === "new" ? <Chip tone="info">New</Chip> : group === "changed" ? <Chip tone="soon">Changed</Chip> : group === "stopped" ? <Chip>Stopped</Chip> : m.finished ? <Chip tone="done">Finished</Chip> : null}</p>
                <p>{m.line}</p>
                {m.take && group !== "stopped" && !m.finished && <p className="med-muted">How to take it: {m.take}{m.at?.length ? `, at ${m.at.join(" and ")}` : ""}</p>}
              </li>
            )))}
          </ul>
        )}
      </Card>

      {week.some(d => d.due > 0) && <Card title="Doses taken this week">
        <BarChart points={week.map(({ x, y }) => ({ x, y }))} label="Doses you marked taken each day" unit="doses" height={160} />
        <p className="med-muted">{week.reduce((n, d) => n + d.y, 0)} of {week.reduce((n, d) => n + d.due, 0)} doses due this week marked taken.</p>
      </Card>}

      <MedicinePhoto />
    </>
  );
}

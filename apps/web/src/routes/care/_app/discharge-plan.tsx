import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";
import { Button, Chip } from "@/components/primitives";
import { browserLang, currentCheckIn, dayWords, leadOf } from "@/features/care-plan/model";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-plan.css";

export const Route = createFileRoute("/care/_app/discharge-plan")({ component: Page });

const GROUPS = [["new", "New medicines"], ["changed", "Changed medicines"], ["continue", "Keep taking"], ["stopped", "Stopped: do not take"]] as const;
const VISIT = { "due-soon": ["soon", "Due soon"], upcoming: ["neutral", "Coming up"], attended: ["done", "Done"], missed: ["soon", "Missed"] } as const;

function Page() {
  const lang = browserLang();
  // All four start together: no waterfall.
  const plan = useQuery(orpc.care.discharge.queryOptions({ input: { lang } }));
  const visits = useQuery(orpc.care.followUps.queryOptions({ input: { lang } }));
  const checkIns = useQuery(orpc.care.checkIns.list.queryOptions());
  const clock = useQuery(orpc.care.clock.queryOptions());

  const header = <PageHeader title="Discharge plan" lead={clock.data ? `Today is ${dayWords(new Date(Date.now() + clock.data.offsetMs))}.` : undefined}>
    {plan.data?.status === "discharged" && <Button className="no-print" onClick={() => window.print()}>Download PDF</Button>}
  </PageHeader>;

  if (plan.isPending) return <>{header}<EmptyState>Getting your plan…</EmptyState></>;
  if (plan.isError) return <>{header}<EmptyState>We could not open your plan. {plan.error.message} <Button onClick={() => { void plan.refetch(); }}>Try again</Button></EmptyState></>;
  if (plan.data.status !== "discharged") return <>{header}<EmptyState>You are still in hospital. Your plan will show here when you go home.</EmptyState></>;

  const p = plan.data;
  const leaflet = p.leaflets.find(l => l.language === lang) ?? p.leaflets[0];
  const lead = leadOf({
    checkInWaiting: Boolean(checkIns.data && currentCheckIn(checkIns.data)),
    visits: visits.data ?? [],
    meds: [...p.medicines.new, ...p.medicines.changed, ...p.medicines.continue],
  });

  return (
    <div className="care-plan">
      {header}
      <section className={`plan-lead plan-lead-${lead.tone}`} aria-label="Most important today">
        <p className="plan-kicker">Most important today</p>
        <h2>{lead.title}</h2>
        <p>{lead.text}</p>
        {lead.to && <Link to={lead.to} className="btn btn-primary no-print">Answer now</Link>}
      </section>

      <section className="plan-section">
        <h2>What happened and what to do at home</h2>
        <p className="plan-muted">You went home on {dayWords(p.dischargedAt)}.</p>
        {leaflet
          ? <>
            {"source" in leaflet && leaflet.source === "fixture" && <Chip>Sample leaflet</Chip>}
            <p className="plan-leaflet">{leaflet.text}</p>
          </>
          : <p>Your care team has not written this part yet.</p>}
      </section>

      <section className="plan-section">
        <h2>Medicines</h2>
        {GROUPS.every(([g]) => !p.medicines[g].length) && <p>No medicines on your plan.</p>}
        {GROUPS.map(([g, title]) => p.medicines[g].length > 0 && <div key={g}>
          <h3>{title}</h3>
          <ul className="plan-list">
            {p.medicines[g].map(m => <li key={m.name}>
              <strong>{m.name}</strong> {m.finished && <Chip tone="done">Finished</Chip>}
              <span>{m.line}</span>
              {!m.finished && m.take && <span>{m.take}</span>}
              {!m.finished && m.endsAt && <span className="plan-muted">Last dose on {dayWords(m.endsAt)}.</span>}
            </li>)}
          </ul>
        </div>)}
      </section>

      <section className="plan-section plan-warning">
        <h2>Warning signs</h2>
        <p><strong>Call the hospital now, or call 999, if you have any of these:</strong></p>
        {p.warningSigns.length
          ? <ul>{p.warningSigns.map(w => <li key={w}>{w}</li>)}</ul>
          : <p>Your care team listed no warning signs. If you feel much worse, call anyway.</p>}
      </section>

      <section className="plan-section">
        <h2>Follow-up visits</h2>
        {visits.isPending && <p>Getting your visits…</p>}
        {visits.isError && <p>We could not get your visits. {visits.error.message}</p>}
        {visits.data?.length === 0 && <p>No visits are booked.</p>}
        <ul className="plan-list">
          {visits.data?.map(v => <li key={v.id}>
            <strong>{v.title}</strong> <Chip tone={VISIT[v.status][0]}>{VISIT[v.status][1]}</Chip>
            <span>{dayWords(v.date)}</span>
            <span className="plan-muted">{v.status === "missed" ? "Call the clinic to book a new time." : v.why}</span>
          </li>)}
        </ul>
        {p.checkIns.length > 0 && <p className="plan-muted">Your care team will check in with you on {p.checkIns.map(c => dayWords(c.date)).join(", ")}.</p>}
      </section>
    </div>
  );
}

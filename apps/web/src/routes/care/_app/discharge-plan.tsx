import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Icon } from "@/components/icon";
import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Chip, ListCard, ListRow, StatCard, StatRow } from "@/components/primitives";
import { browserLang, currentCheckIn, dayWords, daysSince, firstSentence, leadOf, nextOf } from "@/features/care-plan/model";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-discharge-plan.css";

export const Route = createFileRoute("/care/_app/discharge-plan")({ component: Page });

const GROUPS = [["new", "blue", "New"], ["changed", "amber", "Changed"], ["continue", "neutral", "Keep taking"], ["stopped", "neutral", "Stopped: do not take"]] as const;
const VISIT = { "due-soon": ["soon", "Due soon"], upcoming: ["neutral", "Coming up"], attended: ["done", "Done"], missed: ["soon", "Missed"] } as const;
const shortDay = (at: Date | string) => new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function Page() {
  const lang = browserLang();
  // All four start together: no waterfall.
  const plan = useQuery(orpc.care.discharge.queryOptions({ input: { lang } }));
  const visits = useQuery(orpc.care.followUps.queryOptions({ input: { lang } }));
  const checkIns = useQuery(orpc.care.checkIns.list.queryOptions());
  const clock = useQuery(orpc.care.clock.queryOptions());

  const ask = <Button variant="primary" className="no-print" to="/care/ask">Ask Sona about my plan</Button>;
  const empty = (lead: string, body: ReactNode) => <>
    <PageHeader title="Discharge plan" lead={lead} actions={ask} />
    <Card className="dp-alone">{body}</Card>
  </>;

  if (plan.isPending) return empty("Getting your plan…", <EmptyState icon="clipboard" title="Getting your plan…" />);
  if (plan.isError) return empty("We could not open your plan.", <EmptyState icon="alert" title="We could not open your plan" action={<Button onClick={() => { void plan.refetch(); }}>Try again</Button>}>{plan.error.message}</EmptyState>);
  if (plan.data.status !== "discharged") return empty("You do not have a discharge plan yet.", <EmptyState icon="clipboard" title="No discharge plan yet" action={<Button to="/care/follow-ups">See your follow-ups</Button>}>Your plan shows here when you go home from hospital. It will list your medicines, your follow-up visits and the warning signs to watch for.</EmptyState>);

  const p = plan.data;
  const now = new Date(Date.now() + (clock.data?.offsetMs ?? 0));
  const leaflet = p.leaflets.find(l => l.language === lang) ?? p.leaflets[0];
  const sample = Boolean(leaflet && "source" in leaflet && leaflet.source === "fixture");
  const active = [...p.medicines.new, ...p.medicines.changed, ...p.medicines.continue].filter(m => !m.finished);
  const nextVisit = visits.data?.find(v => v.status === "due-soon" || v.status === "upcoming");
  const lead = leadOf({ checkInWaiting: Boolean(checkIns.data && currentCheckIn(checkIns.data)), visits: visits.data ?? [], meds: active });
  const next = nextOf(lead);
  const medWords = `${active.length} ${active.length === 1 ? "medicine" : "medicines"} to take`;

  return (
    <>
      <PageHeader
        title="Discharge plan"
        lead={`You went home on ${dayWords(p.dischargedAt)}. You have ${medWords}${nextVisit ? `, and your next visit is on ${dayWords(nextVisit.date)}` : ""}.`}
        actions={<><Button className="no-print" icon="download" onClick={() => window.print()}>Download PDF</Button>{ask}</>}
      />
      <StatRow>
        <StatCard title="Medicines to take" value={active.length} caption={p.medicines.stopped.length ? `${p.medicines.stopped.length} stopped` : "As your plan says"} action={{ to: "/care/medicines", label: "See medicines" }} />
        {nextVisit && <StatCard title="Next follow-up" value={shortDay(nextVisit.date)} caption={nextVisit.title} action={{ to: "/care/follow-ups", label: "See follow-ups" }} />}
        {clock.data && <StatCard title="Days since you went home" value={daysSince(p.dischargedAt, now)} caption={`Since ${shortDay(p.dischargedAt)}`} />}
      </StatRow>

      <div className="dp-grid">
        <div className="dp-col">
          <InsightCard
            label="In plain words"
            meta={sample ? "Sample leaflet" : undefined}
            title="Your plan in plain words"
            lead={leaflet ? firstSentence(leaflet.text) : "Your care team has not written a summary yet."}
            evidence={[
              { icon: "pill" as const, text: medWords },
              ...(nextVisit ? [{ icon: "calendar" as const, text: `${nextVisit.title} on ${dayWords(nextVisit.date)}` }] : []),
              ...(p.warningSigns.length ? [{ icon: "alert" as const, text: `${p.warningSigns.length} warning ${p.warningSigns.length === 1 ? "sign" : "signs"} to watch for` }] : []),
            ]}
            next={next ? { ...next, step: `${lead.title}. ${lead.text}` } : undefined}
          />
        </div>

        <Card className="dp-doc">
          <section>
            <h2 className="section-label">What happened</h2>
            {leaflet
              ? <>{sample && <div><Chip>Sample leaflet</Chip></div>}<p className="dp-leaflet">{leaflet.text}</p></>
              : <p className="dp-muted">Your care team has not written this part yet.</p>}
          </section>

          <section>
            <h2 className="section-label">Medicines to take</h2>
            {GROUPS.every(([g]) => !p.medicines[g].length) && <p className="dp-muted">No medicines on your plan.</p>}
            <ul className="list">
              {GROUPS.flatMap(([g, tone, label]) => p.medicines[g].map(m => <ListRow
                key={`${g}-${m.name}`}
                icon="pill"
                title={<>{m.name} <span className="dp-dose">{m.line}</span></>}
                caption={m.finished ? undefined : [m.take, m.endsAt && `Last dose on ${dayWords(m.endsAt)}.`].filter(Boolean).join(" ") || undefined}
                trailing={m.finished ? <Chip tone="done">Finished</Chip> : g === "continue" ? undefined : <Chip tone={tone}>{label}</Chip>}
              />))}
            </ul>
          </section>

          <section>
            <h2 className="section-label">Follow-up</h2>
            {visits.isPending && <p className="dp-muted">Getting your visits…</p>}
            {visits.isError && <p className="dp-muted">We could not get your visits. {visits.error.message}</p>}
            {visits.data?.length === 0 && <p className="dp-muted">No visits are booked.</p>}
            <ul className="list">
              {visits.data?.map(v => <ListRow
                key={v.id}
                icon="calendar"
                title={v.title}
                caption={`${dayWords(v.date)}. ${v.status === "missed" ? "Call the clinic to book a new time." : v.why}`}
                trailing={<Chip tone={VISIT[v.status][0]}>{VISIT[v.status][1]}</Chip>}
              />)}
            </ul>
            {Boolean(visits.data?.length) && <div className="dp-foot no-print"><Button to="/care/follow-ups" icon="calendar">See all follow-ups</Button></div>}
          </section>

          {p.checkIns.length > 0 && <section>
            <h2 className="section-label">Things to do</h2>
            <ul className="list">
              {p.checkIns.map(c => <ListRow
                key={String(c.date)}
                leading={<span className="list-tile dp-tile-done"><Icon name="check" size={20} /></span>}
                title="Answer your check-in"
                caption={`${dayWords(c.date)}. Your care team asks how you are.`}
              />)}
            </ul>
          </section>}
        </Card>

        <div className="dp-col">
          <Card className="dp-warn">
            <div className="dp-warn-head"><Icon name="alert" size={28} /><h2>Call the hospital now if…</h2></div>
            {p.warningSigns.length
              ? <ul>{p.warningSigns.map(w => <li key={w}><Icon name="alert" size={18} />{w}</li>)}</ul>
              : <p>Your care team listed no warning signs. If you feel much worse, call anyway.</p>}
            <p>If you cannot reach the hospital, call 999.</p>
            <a className="dp-call no-print" href="tel:999"><Icon name="phone" size={20} />Call 999</a>
          </Card>
          <div className="no-print">
            <ListCard title="Stay in touch">
              <ListRow icon="check" title="Check-ins" caption="Tell your care team how you are" to="/care/check-ins" />
              <ListRow icon="message" title="Messages" caption="Write to your care team" to="/care/messages" />
            </ListCard>
          </div>
        </div>
      </div>
    </>
  );
}

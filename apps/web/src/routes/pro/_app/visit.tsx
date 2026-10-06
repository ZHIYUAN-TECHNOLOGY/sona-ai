import { can } from "@sona-ai/api/roles";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { InsightCard, InsightRow } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Avatar } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { Note } from "@/features/visit/note";
import { Orders } from "@/features/visit/orders";
import { refusal } from "@/features/visit/visit";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/visit.css";

export const Route = createFileRoute("/pro/_app/visit")({
  validateSearch: (search: Record<string, unknown>): { encounterId?: string } =>
    typeof search.encounterId === "string" && search.encounterId ? { encounterId: search.encounterId } : {},
  component: Page,
});

function Page() {
  const { encounterId } = Route.useSearch();
  const { me } = Route.useRouteContext();
  // Every patient with their record and visit: names the visit here and feeds the order's checks.
  const patients = useQuery(orpc.patients.list.queryOptions());
  if (!encounterId) return <Pick patients={patients} />;
  if (!can(me.role, "note.get")) return <><PageHeader title="Visit" /><EmptyState>Your role cannot read clinical notes.</EmptyState></>;
  const patient = patients.data?.find(p => p.encounterId === encounterId);

  return (
    <>
      <PageHeader title={patient ? patient.name : "Visit"} lead={patient ? `${patient.age} · ${patient.sex} · ${patient.complaint}` : undefined}>
        <Link to="/pro/visit" search={{}}>All of today's visits</Link>
      </PageHeader>
      <Briefing encounterId={encounterId} />
      <WithRail rail={
        <RightRail label="Medicine order">
          <div id="visit-orders">
            {patients.isPending ? <EmptyState>Loading the record…</EmptyState>
              : <Orders encounterId={encounterId} patient={patient} userId={me.userId} canPrescribe={can(me.role, "prescribing.simulate")} />}
          </div>
        </RightRail>
      }>
        <Note encounterId={encounterId} canWrite={can(me.role, "note.save")} canDraft={can(me.role, "note.draft")} />
      </WithRail>
    </>
  );
}

function Briefing({ encounterId }: { encounterId: string }) {
  const briefing = useQuery(orpc.encounter.briefing.queryOptions({ input: { encounterId }, staleTime: Infinity }));
  if (briefing.isPending) return <EmptyState>Reading the record for the briefing…</EmptyState>;
  if (briefing.isError) return <EmptyState>{refusal(briefing.error).message}</EmptyState>;
  const [lead, ...rest] = briefing.data.lines;
  if (!lead) return null;
  return (
    <InsightRow>
      <InsightCard lead={briefing.data.source === "fixture" ? `Sample briefing: ${lead}` : lead} sources={briefing.data.lines.length}
        next={{ label: "Review the medicine order", onAct: scrollToOrders }}>
        {rest.length ? <ul>{rest.map(line => <li key={line}>{line}</li>)}</ul> : null}
      </InsightCard>
    </InsightRow>
  );
}

const scrollToOrders = () => document.getElementById("visit-orders")?.scrollIntoView({ behavior: "smooth" });

/** Hospital time is UTC+8: today's date there, whatever the browser's zone. */
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

function Pick({ patients }: { patients: { data?: { id: string; encounterId: string }[] } }) {
  const day = useQuery(orpc.day.list.queryOptions({ input: { date: today() } }));
  const visitOf = new Map(patients.data?.map(p => [p.id, p.encounterId]));
  return (
    <>
      <PageHeader title="Visit" lead={day.data ? `${day.data.length} ${day.data.length === 1 ? "visit" : "visits"} today. Pick one to write its note.` : undefined} />
      {day.isPending ? <EmptyState>Loading today's visits…</EmptyState>
        : day.isError ? <EmptyState>{refusal(day.error).message}</EmptyState>
        : !day.data.length ? <EmptyState>No visits are booked for today.</EmptyState>
        : (
          <ul className="visit-pick">
            {day.data.map(visit => {
              const encounterId = visitOf.get(visit.patientId);
              const row = (
                <>
                  <Avatar name={visit.patientName} />
                  <span><strong>{visit.patientName}</strong><br />
                    {new Date(visit.startsAt).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" })} · {visit.kind}
                  </span>
                </>
              );
              return (
                <li key={visit.id}>
                  {encounterId ? <Link to="/pro/visit" search={{ encounterId }}>{row}</Link>
                    : <div title="No visit record is open for this patient">{row}</div>}
                </li>
              );
            })}
          </ul>
        )}
    </>
  );
}

import { can } from "@sona-ai/api/roles";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { type Column, DataTable, PersonCell, RowAction } from "@/components/data-table";
import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader, PatientStrip } from "@/components/page";
import { Button, Card, Chip } from "@/components/primitives";
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
  // Where the note puts its save button: the page's main action lives in the header.
  const [actions, setActions] = useState<HTMLElement | null>(null);
  if (!encounterId) return <Pick patients={patients} />;
  if (!can(me.role, "note.get")) return <><PageHeader title="Visit" /><EmptyState>Your role cannot read clinical notes.</EmptyState></>;
  const patient = patients.data?.find(p => p.encounterId === encounterId);

  return (
    <>
      <PageHeader title="Visit note" breadcrumb={[{ label: "Patients", to: "/pro/patients" }, { label: patient?.name ?? "Visit" }]}
        subtitle={patient?.complaint}
        actions={<><Button to="/pro/visit" search={{}}>Today's visits</Button><span className="visit-header-slot" ref={setActions} /></>} />
      {patient ? (
        <PatientStrip name={patient.name} meta={`${patient.sex.charAt(0).toUpperCase()}, ${patient.age} · ${patient.id}`}
          chips={patient.allergies ? <span className="visit-allergy" title={`Allergy: ${patient.allergies}`}><Chip tone="red" icon="alert">Allergy: {shortAllergy(patient.allergies)}</Chip></span> : <span className="visit-muted">No allergies recorded</span>} />
      ) : null}
      <WithRail rail={
        <RightRail label="Sona AI and the medicine order">
          <Briefing encounterId={encounterId} />
          <div id="visit-orders">
            {patients.isPending ? <Card><p className="visit-muted">Loading the record…</p></Card>
              : <Orders encounterId={encounterId} patient={patient} userId={me.userId} canPrescribe={can(me.role, "prescribing.simulate")} />}
          </div>
        </RightRail>
      }>
        <Note encounterId={encounterId} canWrite={can(me.role, "note.save")} canDraft={can(me.role, "note.draft")} actions={actions} />
      </WithRail>
    </>
  );
}

/** The page's one Sona AI panel: what the record says before the doctor starts, and the step it suggests. */
function Briefing({ encounterId }: { encounterId: string }) {
  const briefing = useQuery(orpc.encounter.briefing.queryOptions({ input: { encounterId }, staleTime: Infinity }));
  if (briefing.isPending) return <Card title="Sona AI"><p className="visit-muted">Reading the record for the briefing…</p></Card>;
  if (briefing.isError) return <Card title="Sona AI"><p className="visit-muted">{refusal(briefing.error).message}</p></Card>;
  const [lead, ...rest] = briefing.data.lines;
  if (!lead) return null;
  return (
    <InsightCard label={briefing.data.source === "fixture" ? "Sona AI · sample" : "Sona AI"} title="Before you start" lead={lead}
      evidence={rest.map(text => ({ icon: "file" as const, text }))} sources={briefing.data.lines.length}
      next={{ label: "Review the order", step: "Check the medicine order against this record.", onAct: scrollToOrders }} />
  );
}

/** The allergen alone: the text before the first dash, semicolon or bracket. The full text stays in `title`. */
const shortAllergy = (text: string) => text.split(/[—;(]/)[0]!.trim();

const scrollToOrders = () => document.getElementById("visit-orders")?.scrollIntoView({ behavior: "smooth" });

/** Hospital time is UTC+8: today's date there, whatever the browser's zone. */
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const clock = (at: string | Date) => new Date(at).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Kuala_Lumpur" });

function Pick({ patients }: { patients: { data?: { id: string; encounterId: string }[] } }) {
  const navigate = Route.useNavigate();
  const day = useQuery(orpc.day.list.queryOptions({ input: { date: today() } }));
  const visitOf = new Map(patients.data?.map(p => [p.id, p.encounterId]));
  type Visit = NonNullable<typeof day.data>[number];
  const open = (visit: Visit) => {
    const encounterId = visitOf.get(visit.patientId);
    if (encounterId) void navigate({ search: { encounterId } });
  };
  const columns: Column<Visit>[] = [
    { key: "patient", header: "Patient", cell: v => <PersonCell name={v.patientName} />, sort: (a, b) => a.patientName.localeCompare(b.patientName) },
    { key: "time", header: "Time", cell: v => <span className="visit-num">{clock(v.startsAt)}</span>, sort: (a, b) => +new Date(a.startsAt) - +new Date(b.startsAt) },
    { key: "kind", header: "Visit", cell: v => <>{v.kind}{v.incomplete ? <span className="visit-flag"> · Record incomplete</span> : null}</> },
  ];
  return (
    <>
      <PageHeader title="Visit" subtitle={day.data ? `${day.data.length} ${day.data.length === 1 ? "visit" : "visits"} today · open one to write its note` : undefined} />
      {day.isError ? <EmptyState icon="alert">{refusal(day.error).message}</EmptyState> : (
        <DataTable columns={columns} rows={day.data ?? []} rowKey={v => v.id} loading={day.isPending} onRowOpen={open}
          toolbar={<h2 className="visit-table-title">Today's visits</h2>}
          empty={<EmptyState icon="calendar">No visits are booked for today.</EmptyState>}
          rowAction={v => visitOf.get(v.patientId) ? <RowAction onClick={() => open(v)}>Open visit</RowAction>
            : <span className="visit-muted">No visit record open</span>} />
      )}
    </>
  );
}

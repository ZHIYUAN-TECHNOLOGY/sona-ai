import { can } from "@sona-ai/api/roles";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { type Column, DataTable, PersonCell, RowAction } from "@/components/data-table";
import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader, PatientStrip } from "@/components/page";
import { Button, Card, Chip, Signal, Skeleton } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { Note } from "@/features/visit/note";
import { Orders } from "@/features/visit/orders";
import { nextVisit, orderChecks, refusal, type VisitPatient } from "@/features/visit/visit";
import { orpc } from "@/lib/orpc";
import { Reasoning } from "@/features/visit-tools/reasoning";
import { Scan } from "@/features/visit-tools/scan";
import "@/styles/pages/visit.css";
import "@/styles/pages/visit-tools.css";

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
        lead={<Standing encounterId={encounterId} patient={patient} />}
        actions={<><Button to="/pro/visit" search={{}}>Today's visits</Button><span className="visit-header-slot" ref={setActions} /></>} />
      {patient ? (
        <PatientStrip name={patient.name} meta={`${patient.sex.charAt(0).toUpperCase()}, ${patient.age} · ${patient.id}${patient.complaint ? ` · ${patient.complaint}` : ""}`}
          chips={patient.allergies ? <span className="visit-allergy" title={`Allergy: ${patient.allergies}`}><Chip tone="red" icon="alert">Allergy: {shortAllergy(patient.allergies)}</Chip></span> : <span className="visit-muted">No allergies recorded</span>} />
      ) : null}
      <WithRail follow rail={
        <RightRail label="The medicine order and Sona AI">
          {/* The decision first, so its checks and buttons are in view; what the record says sits under it. */}
          <div id="visit-orders">
            {patients.isPending ? <Card title="Medicine order"><Skeleton height={48} /></Card>
              : <Orders encounterId={encounterId} patient={patient} userId={me.userId} canPrescribe={can(me.role, "prescribing.simulate")} />}
          </div>
          <Briefing encounterId={encounterId} />
          <Reasoning encounterId={encounterId} allowed={can(me.role, "encounter.reasoning")} />
        </RightRail>
      }>
        <Note encounterId={encounterId} canWrite={can(me.role, "note.save")} canDraft={can(me.role, "note.draft")} actions={actions} />
        <div className="vt-scan"><Scan encounterId={encounterId} allowed={can(me.role, "scan.apply")} /></div>
      </WithRail>
    </>
  );
}

/** Where the visit stands in one line: the note, then the order's checks. Reads the same queries as the cards below. */
function Standing({ encounterId, patient }: { encounterId: string; patient?: VisitPatient }) {
  const note = useQuery(orpc.note.get.queryOptions({ input: { encounterId } }));
  const encounter = useQuery(orpc.encounter.get.queryOptions({ input: { encounterId } }));
  if (!note.data || !encounter.data || !patient) return null;
  const checks = orderChecks(encounter.data, patient);
  const blocked = checks.filter(c => c.status === "blocked").length;
  return (
    <>
      {note.data.sentences.some(s => s.text.trim()) ? `Note saved at revision ${note.data.revision}` : <Signal tone="soon">Note not written yet</Signal>}
      {" · "}
      {!(encounter.data.state as { proposedMedicine?: string }).proposedMedicine ? "No medicine entered"
        : blocked ? <Signal tone="soon">{blocked} of {checks.length} order checks blocked</Signal>
        : `${checks.length} order checks pass`}
    </>
  );
}

/** The page's one Sona AI panel: what the record says before the doctor starts. The step it leads to is the order card above it. */
function Briefing({ encounterId }: { encounterId: string }) {
  const briefing = useQuery(orpc.encounter.briefing.queryOptions({ input: { encounterId }, staleTime: Infinity }));
  if (briefing.isPending) return <Card title="Sona AI"><p className="visit-muted">Reading the record for the briefing…</p></Card>;
  if (briefing.isError) return <Card title="Sona AI"><p className="visit-muted">{refusal(briefing.error).message}</p></Card>;
  const [lead, ...rest] = briefing.data.lines;
  if (!lead) return null;
  return (
    <InsightCard label={briefing.data.source === "fixture" ? "Sona AI · sample" : "Sona AI"} title="Before you start" lead={lead}
      evidence={rest.map(text => ({ icon: "file" as const, text }))} sources={briefing.data.lines.length} />
  );
}

/** The allergen alone: the text before the first dash, semicolon or bracket. The full text stays in `title`. */
const shortAllergy = (text: string) => text.split(/[—;(]/)[0]!.trim();

/** Hospital time is UTC+8: today's date there, whatever the browser's zone. */
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const clock = (at: string | Date) => new Date(at).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Kuala_Lumpur" });

const toPatients = <Button to="/pro/patients" icon="users">Open patients</Button>;

function Pick({ patients }: { patients: { data?: { id: string; encounterId: string }[] } }) {
  const navigate = Route.useNavigate();
  const day = useQuery(orpc.day.list.queryOptions({ input: { date: today() } }));
  const visitOf = new Map(patients.data?.map(p => [p.id, p.encounterId]));
  type Visit = NonNullable<typeof day.data>[number];
  const open = (visit: Visit) => {
    const encounterId = visitOf.get(visit.patientId);
    if (encounterId) void navigate({ search: { encounterId } });
  };
  const visits = day.data ?? [];
  const next = nextVisit(visits, id => Boolean(visitOf.get(id)));
  const incomplete = visits.filter(v => v.incomplete).length;
  const columns: Column<Visit>[] = [
    { key: "patient", header: "Patient", cell: v => <PersonCell name={v.patientName} />, sort: (a, b) => a.patientName.localeCompare(b.patientName) },
    { key: "time", header: "Time", cell: v => <span className="visit-num">{clock(v.startsAt)}</span>, sort: (a, b) => +new Date(a.startsAt) - +new Date(b.startsAt) },
    { key: "kind", header: "Visit", cell: v => <span className="visit-kind">{v.kind.charAt(0).toUpperCase() + v.kind.slice(1)}{v.incomplete ? <Chip tone="amber">Record incomplete</Chip> : null}</span> },
  ];
  return (
    <>
      <PageHeader title="Visit"
        lead={!day.data ? undefined : !visits.length ? "No visits booked today" : (
          <>
            {visits.length} {visits.length === 1 ? "visit" : "visits"} today
            {incomplete ? <> · <Signal tone="soon">{incomplete} {incomplete === 1 ? "record" : "records"} incomplete</Signal></> : null}
          </>
        )}
        actions={next ? <Button variant="primary" icon="arrow-right" onClick={() => open(next)}>Open next visit · {next.patientName}</Button> : undefined} />
      {day.isError ? <EmptyState icon="alert" action={toPatients}>{refusal(day.error).message}</EmptyState> : (
        <DataTable columns={columns} rows={visits} rowKey={v => v.id} loading={day.isPending} onRowOpen={open}
          toolbar={<h2 className="visit-table-title">Today's visits</h2>}
          empty={<EmptyState icon="calendar" title="No visits booked today" action={toPatients}>Open a patient to write the note for a visit on another day.</EmptyState>}
          rowAction={v => visitOf.get(v.patientId) ? <RowAction onClick={() => open(v)}>Open visit</RowAction>
            : <span className="visit-muted">No visit record open</span>} />
      )}
    </>
  );
}

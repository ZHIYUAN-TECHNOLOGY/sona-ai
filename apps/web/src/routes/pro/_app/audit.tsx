import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { type Column, DataTable, PersonCell, RowAction, TableToolbar, TextCell, ValueCell } from "@/components/data-table";
import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, ListCard, ListRow, SearchField, Signal, Tabs } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { matching, ringgit } from "@/features/audit/filter";
import { say } from "@/features/discharge/shared";
import { client, orpc } from "@/lib/orpc";
import "@/styles/pages/audit.css";

export const Route = createFileRoute("/pro/_app/audit")({ component: Page });

type Tab = "coding" | "access";
type Item = Awaited<ReturnType<typeof client.audit.list>>[number];
type Line = Awaited<ReturnType<typeof client.accessLog.list>>["lines"][number];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const codes = (r: Item) => `${r.fromCode ?? "No code"} → ${r.toCode}`;

function Page() {
  const { me } = Route.useRouteContext();
  const [tab, setTab] = useState<Tab>("coding");
  const mayAudit = can(me.role, "audit.list");
  // Both tabs read the same list, so the count on the tab is live whichever tab is open.
  const items = useQuery(orpc.audit.list.queryOptions({ enabled: mayAudit }));
  const tabs = (
    <Tabs label="Audit" value={tab} onChange={setTab}
      tabs={[{ id: "coding", label: "Coding audit", count: items.data?.length }, { id: "access", label: "Access trail" }]} />
  );
  if (tab === "coding") return mayAudit ? <Coding tabs={tabs} items={items} mayRun={can(me.role, "audit.run")} maySend={can(me.role, "audit.query")} /> : <Refused tabs={tabs}>Your role cannot see the coding audit.</Refused>;
  return can(me.role, "accessLog.list") ? <Access tabs={tabs} /> : <Refused tabs={tabs}>Your role cannot see who opened a record.</Refused>;
}

function Refused({ tabs, children }: { tabs: ReactNode; children: ReactNode }) {
  return (
    <>
      <PageHeader title="Audit" />
      <Card><TableToolbar>{tabs}</TableToolbar><EmptyState icon="shield-check" title="Not available to your role">{children}</EmptyState></Card>
    </>
  );
}

function Coding({ tabs, items, mayRun, maySend }: { tabs: ReactNode; items: { data?: Item[]; error: unknown; isPending: boolean }; mayRun: boolean; maySend: boolean }) {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string>();
  const [q, setQ] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.audit.list.key() });
  const run = useMutation(orpc.audit.run.mutationOptions({ onSuccess: refresh }));
  // `audit.query` writes (a task for the doctor, the item marked queried), so it is a button, never a row open.
  const ask = useMutation(orpc.audit.query.mutationOptions({ onSuccess: refresh }));
  const patients = useQuery(orpc.patients.list.queryOptions());
  const names = new Map(patients.data?.map(p => [p.id, p.name]));
  const nameOf = (id: string) => names.get(id) ?? id;

  // The most money at risk first, and that finding is open until another is chosen: the evidence and the decision are in view on arrival.
  const rows = [...(items.data ?? [])].sort((a, b) => b.riskCents - a.riskCents);
  const shown = matching(rows, q, r => [nameOf(r.patientId), r.patientId, r.doctor, r.gap, r.fromCode ?? "", r.toCode]);
  const open = rows.find(r => r.id === openId) ?? rows[0];
  const total = rows.reduce((sum, r) => sum + r.riskCents, 0);
  const doctors = new Set(rows.map(r => r.doctor)).size;
  const sent = ask.isSuccess ? ask.variables?.itemId : undefined;

  const columns: Column<Item>[] = [
    { key: "patient", header: "Patient", cell: r => <span className="au-patient"><PersonCell name={nameOf(r.patientId)} detail={r.patientId} /></span>, sort: (a, b) => nameOf(a.patientId).localeCompare(nameOf(b.patientId)) },
    { key: "gap", header: "Gap in the note", cell: r => <span className="au-gap"><TextCell>{r.gap}</TextCell><span className="au-muted au-code">{codes(r)}</span></span> },
    { key: "doctor", header: "Doctor", cell: r => <span className="au-doctor">{r.doctor}</span>, sort: (a, b) => a.doctor.localeCompare(b.doctor) },
    { key: "risk", header: "At risk", align: "right", cell: r => <ValueCell value={ringgit(r.riskCents)} unit="RM" />, sort: (a, b) => a.riskCents - b.riskCents },
  ];

  return (
    <>
      <PageHeader title="Audit"
        lead={items.isPending ? "Reading the audit…" : items.error ? "The audit could not be read." : rows.length ? <><Signal tone="soon">RM {ringgit(total)} at risk</Signal> in {plural(rows.length, "open item")} across {plural(doctors, "doctor")}.</> : "No open coding items."}
        status={run.isSuccess ? "Audit finished" : undefined}
        actions={mayRun ? <Button variant="primary" icon="activity" pending={run.isPending} onClick={() => run.mutate({})}>Run audit now</Button> : undefined} />
      {run.error ? <p className="au-note" role="alert">{say(run.error)}</p> : null}
      <WithRail rail={
        <RightRail label="Selected finding">
          {open ? (
            <>
              <Card title={nameOf(open.patientId)}>
                <dl className="au-facts">
                  <dt>Code</dt><dd className="au-code">{codes(open)}</dd>
                  <dt>At risk</dt><dd>RM {ringgit(open.riskCents)}</dd>
                  <dt>Doctor</dt><dd>{open.doctor}</dd>
                </dl>
              </Card>
              <InsightCard label="Sona's query" meta={`For ${open.doctor}`} lead={open.query} sources={2}
                evidence={[{ icon: "file", text: open.gap }, { icon: "clipboard", text: `Coded as ${open.fromCode ?? "nothing"}; the labs support ${open.toCode}` }]}
                next={maySend && sent !== open.id ? { label: ask.isPending ? "Sending…" : "Send query", step: `Adds a task for ${open.doctor}`, onAct: () => { if (!ask.isPending) ask.mutate({ itemId: open.id }); } } : undefined} />
              {sent === open.id ? <p className="au-note" role="status">Query sent to {open.doctor}.</p>
                : sent ? <p className="au-note" role="status">Query sent. This is the next largest finding.</p> : null}
              {ask.error ? <p className="au-note" role="alert">{say(ask.error)}</p> : null}
            </>
          ) : (
            <Card><EmptyState icon="shield-check" title="Nothing to review">{items.isPending ? "Reading the audit…" : "A finding opens here with Sona’s query, to read before you send it."}</EmptyState></Card>
          )}
        </RightRail>
      }>
        <Card>
          <DataTable columns={columns} rows={shown} rowKey={r => r.id} loading={items.isPending}
            selectedKey={open?.id} onRowOpen={r => setOpenId(r.id)}
            rowAction={r => <RowAction onClick={() => setOpenId(r.id)}>Review</RowAction>}
            toolbar={<TableToolbar end={<SearchField label="Search findings" placeholder="Patient, doctor or code" value={q} onChange={e => setQ(e.target.value)} />}>{tabs}</TableToolbar>}
            empty={items.error ? <EmptyState title="The audit could not be read">{say(items.error)}</EmptyState>
              : rows.length ? <EmptyState icon="search" title="No findings match">Try a patient, a doctor or a code.</EmptyState>
              : <EmptyState icon="shield-check" title="No open items">Run the audit to check today’s notes.</EmptyState>}
            count={rows.length ? `Showing ${shown.length} of ${plural(rows.length, "finding")}` : undefined} />
        </Card>
      </WithRail>
    </>
  );
}

const TRAIL: Column<Line>[] = [
  { key: "who", header: "Who", cell: l => <PersonCell name={l.who} size="sm" /> },
  { key: "did", header: "What", cell: l => <>{l.did}{l.times > 1 ? <span className="au-muted"> · {l.times} times</span> : null}</> },
  { key: "at", header: "When", align: "right", cell: l => <time className="au-muted" dateTime={new Date(l.at).toISOString()}>{new Date(l.at).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}</time>, sort: (a, b) => +new Date(a.at) - +new Date(b.at) },
];

function Access({ tabs }: { tabs: ReactNode }) {
  const patients = useQuery(orpc.patients.list.queryOptions());
  const [patientId, setPatientId] = useState<string>();
  const [q, setQ] = useState("");
  const patient = patients.data?.find(p => p.id === patientId);
  const trail = useQuery(orpc.accessLog.list.queryOptions({ input: { patientId: patientId ?? "", limit: 50 }, enabled: !!patientId }));
  const lines = patientId ? trail.data?.lines ?? [] : [];
  const people = new Set(lines.map(l => l.who)).size;
  const entries = plural(lines.length, "entry", "entries");
  const listed = matching(patients.data ?? [], q, p => [p.name, p.subtitle ?? "", p.id]);

  return (
    <>
      <PageHeader title="Audit" lead={!patient ? "Choose a patient to see who opened their record." : trail.isPending ? `Reading the trail for ${patient.name}…` : `${plural(people, "person", "people")} opened ${patient.name}’s record, in ${entries}.`} />
      <WithRail rail={
        <RightRail label="Patients">
          <Card title="Patient">
            <SearchField label="Search patients" placeholder="Search patients" value={q} onChange={e => setQ(e.target.value)} />
          </Card>
          {patients.isPending ? <Card><EmptyState>Loading…</EmptyState></Card>
            : patients.error ? <Card><EmptyState title="Patients could not be read">{say(patients.error)}</EmptyState></Card>
            : listed.length ? (
              <ListCard>
                {listed.map(p => <ListRow key={p.id} avatar={p.name} title={p.name} caption={p.subtitle} selected={p.id === patientId} onClick={() => setPatientId(p.id)} />)}
              </ListCard>
            ) : <Card><EmptyState icon="search" title="No patients match" /></Card>}
        </RightRail>
      }>
        <Card>
          <DataTable columns={TRAIL} rows={lines} rowKey={l => `${l.who}|${l.did}|${l.at}`} loading={!!patientId && trail.isPending}
            toolbar={<TableToolbar>{tabs}</TableToolbar>}
            empty={!patientId ? <EmptyState icon="users" title="No patient chosen">Pick a patient on the right to see who opened their record.</EmptyState>
              : trail.error ? <EmptyState title="The trail could not be read">{say(trail.error)}</EmptyState>
              : <EmptyState icon="shield-check" title="Nobody has opened this record yet" />}
            count={lines.length ? `${entries} for ${patient?.name ?? patientId}` : undefined} />
        </Card>
      </WithRail>
    </>
  );
}

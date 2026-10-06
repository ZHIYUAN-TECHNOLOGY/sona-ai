import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { type Column, DataTable } from "@/components/data-table";
import { InsightCard, InsightRow } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { Loaded, PatientPicker, say } from "@/features/discharge/shared";
import { client, orpc } from "@/lib/orpc";
import "@/styles/pages/discharge.css";

export const Route = createFileRoute("/pro/_app/audit")({ component: Page });

type Item = Awaited<ReturnType<typeof client.audit.list>>[number];
const rm = (cents: number) => `RM ${(cents / 100).toLocaleString("en-MY")}`;

const COLUMNS: Column<Item>[] = [
  { key: "patient", header: "Patient", cell: r => r.patientId },
  { key: "gap", header: "Gap in the note", cell: r => r.gap },
  { key: "code", header: "Code", cell: r => `${r.fromCode ?? "none"} → ${r.toCode}` },
  { key: "doctor", header: "Doctor", cell: r => r.doctor },
  { key: "risk", header: "At risk", align: "right", cell: r => rm(r.riskCents), sort: (a, b) => b.riskCents - a.riskCents },
];

function Page() {
  const { me } = Route.useRouteContext();
  const [tab, setTab] = useState<"coding" | "access">("coding");
  return (
    <>
      <PageHeader title="Audit" />
      <div className="dc-tabs" role="tablist">
        <Button role="tab" aria-selected={tab === "coding"} variant={tab === "coding" ? "primary" : "quiet"} onClick={() => setTab("coding")}>Coding audit</Button>
        <Button role="tab" aria-selected={tab === "access"} variant={tab === "access" ? "primary" : "quiet"} onClick={() => setTab("access")}>Access trail</Button>
      </div>
      {tab === "coding"
        ? can(me.role, "audit.list") ? <Coding /> : <EmptyState>Your role cannot see the coding audit.</EmptyState>
        : can(me.role, "accessLog.list") ? <Access /> : <EmptyState>Your role cannot see who opened a record.</EmptyState>}
    </>
  );
}

function Coding() {
  const queryClient = useQueryClient();
  const items = useQuery(orpc.audit.list.queryOptions());
  const [openId, setOpenId] = useState<string>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.audit.list.key() });
  const run = useMutation(orpc.audit.run.mutationOptions({ onSuccess: refresh }));
  // `audit.query` writes (a task for the doctor, the item marked queried), so it is a button, never a row open.
  const ask = useMutation(orpc.audit.query.mutationOptions({ onSuccess: refresh }));
  const patients = useQuery(orpc.patients.list.queryOptions()); const nameOf = (id: string) => patients.data?.find(p => p.id === id)?.name ?? id; const columns = COLUMNS.map(c => (c.key === "patient" ? { ...c, cell: (r: Item) => nameOf(r.patientId) } : c)); const rows = items.data ?? [];
  const open = rows.find(r => r.id === openId);
  const total = rows.reduce((sum, r) => sum + r.riskCents, 0);

  return (
    <>
      <InsightRow>
        <InsightCard tone={rows.length ? "soon" : "done"} sources={rows.length || 1}
          lead={items.isPending ? "Reading the audit…" : rows.length ? `${rows.length} open item${rows.length > 1 ? "s" : ""} put ${rm(total)} at risk` : "No open coding items"} />
      </InsightRow>
      <div className="dc-row dc-tabs">
        <Button variant="primary" pending={run.isPending} onClick={() => run.mutate({})}>Run audit now</Button>
        {run.isSuccess ? <span className="dc-muted">Audit finished.</span> : null}
        {run.error ? <span className="dc-refused" role="alert">{say(run.error)}</span> : null}
      </div>
      <WithRail rail={
        <RightRail label="Item">
          {open ? (
            <Card title={nameOf(open.patientId)}>
              <p><strong>{open.gap}</strong></p>
              <p>{open.fromCode ?? "none"} → {open.toCode} · {rm(open.riskCents)} at risk</p>
              <p className="dc-muted">Sona’s query for {open.doctor}. You decide whether to send it.</p>
              <blockquote className="dc-quote">{open.query}</blockquote>
              <Button variant="primary" pending={ask.isPending} disabled={ask.isSuccess && ask.variables?.itemId === open.id} onClick={() => ask.mutate({ itemId: open.id })}>
                {ask.isSuccess && ask.variables?.itemId === open.id ? "Query sent" : `Send query to ${open.doctor}`}
              </Button>
              {ask.error ? <p className="dc-refused" role="alert">{say(ask.error)}</p> : null}
            </Card>
          ) : <p className="dc-muted">Open a row to review its query.</p>}
        </RightRail>
      }>
        <Loaded query={items} empty="No open items. Run the audit to check today's notes.">
          {list => <DataTable columns={columns} rows={list} rowKey={r => r.id} onRowOpen={r => setOpenId(r.id)} />}
        </Loaded>
      </WithRail>
    </>
  );
}

function Access() {
  const [patient, setPatient] = useState<{ id: string }>();
  return (
    <>
      <PatientPicker lead="Choose a patient to see who opened their record." link={p => <Button onClick={() => setPatient(p)}>{patient?.id === p.id ? "Showing" : "Show trail"}</Button>} />
      {patient ? <Trail key={patient.id} patientId={patient.id} /> : null}
    </>
  );
}

function Trail({ patientId }: { patientId: string }) {
  const trail = useQuery(orpc.accessLog.list.queryOptions({ input: { patientId, limit: 50 } }));
  return (
    <Card title="Who opened this record">
      <Loaded query={trail}>
        {t => t.lines.length ? (
          <ul className="dc-list">
            {t.lines.map((l, i) => (
              <li key={i}><span><strong>{l.who}</strong> {l.did}{l.times > 1 ? ` (${l.times} times)` : ""}</span><time className="dc-muted">{new Date(l.at).toLocaleString("en-MY")}</time></li>
            ))}
          </ul>
        ) : <p className="dc-muted">Nobody has opened this record yet.</p>}
      </Loaded>
    </Card>
  );
}

import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { Avatar } from "@/components/avatar";
import { LineChart } from "@/components/charts";
import { DataTable, RowAction, ValueCell, type Column } from "@/components/data-table";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { PriorityCell, ResultInsight, valueOf, when } from "@/features/results/result-rail";
import { byTriage, seriesFor } from "@/features/results/triage";
import type { ResultRow } from "@/features/results/types";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/results.css";

export const Route = createFileRoute("/pro/_app/results_/$resultId")({ component: Page });

/** One result, read to a decision: why it is flagged and Acknowledge first, then its trend and the patient's other results. */
function Page() {
  const { resultId } = Route.useParams();
  const { me } = Route.useRouteContext();
  const navigate = useNavigate();
  const allowed = can(me.role, "results.acknowledge");
  const queryClient = useQueryClient();
  // The list is the results read the API has; it is already cached when the result was opened from it.
  const list = useQuery(orpc.results.list.queryOptions({ input: {} }));
  const acknowledge = useMutation(orpc.results.acknowledge.mutationOptions({ onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.results.list.key() }) }));

  if (list.isPending) return <><PageHeader title="Result" breadcrumb={[{ label: "Results", to: "/pro/results" }]} /><EmptyState>Loading the result…</EmptyState></>;
  if (list.error) return <><PageHeader title="Result" breadcrumb={[{ label: "Results", to: "/pro/results" }]} /><EmptyState>The result could not be loaded: {list.error.message}</EmptyState></>;
  const rows = list.data;
  const row = rows.find(r => r.id === resultId);
  if (!row) return <><PageHeader title="Result" breadcrumb={[{ label: "Results", to: "/pro/results" }]} /><EmptyState title="No such result" action={<Button to="/pro/results">Back to results</Button>}>It may have been removed, or it belongs to another hospital.</EmptyState></>;

  const series = seriesFor(rows, row);
  const theirs = rows.filter(r => r.patientId === row.patientId && r.id !== row.id).sort(byTriage);
  // The next result still waiting for a doctor, in triage order, so the clinician can work through the list from here.
  const next = [...rows].sort(byTriage).find(r => !r.acknowledgedAt && r.id !== row.id);
  const open = (r: ResultRow) => navigate({ to: "/pro/results/$resultId", params: { resultId: r.id } });
  const columns: Column<ResultRow>[] = [
    { key: "test", header: "Test", cell: r => r.test },
    { key: "result", header: "Result", cell: r => <span className="results-value" data-critical={r.critical || undefined}><ValueCell value={r.value} unit={r.unit ?? undefined} /></span> },
    { key: "priority", header: "Priority", cell: r => <PriorityCell row={r} /> },
    { key: "received", header: "Received", cell: r => <span className="results-received">{when(r.receivedAt)}</span> },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Results", to: "/pro/results" }, { label: `${row.patientName} · ${row.test}` }]}
        title={`${row.test} · ${valueOf(row)}`}
        lead={`${row.patientName} · received ${when(row.receivedAt)} · ${row.acknowledgedAt ? `acknowledged by ${row.acknowledgedByName ?? "a doctor"}` : "waiting for a doctor"}`}
        actions={next ? <Button variant={row.acknowledgedAt ? "primary" : "secondary"} icon="arrow-right" onClick={() => open(next)}>Next result</Button> : undefined}
      />
      <ResultInsight band row={row} rows={rows} allowed={allowed} pending={acknowledge.isPending} onAcknowledge={r => acknowledge.mutate({ resultId: r.id })} />
      {acknowledge.error ? <p className="results-error" role="alert">Not acknowledged: {acknowledge.error.message}</p> : null}
      <WithRail rail={
        <RightRail label="Patient">
          <Card>
            <div className="results-detail-head">
              <Avatar name={row.patientName} />
              <div>
                <h2 className="results-detail-title">{row.patientName}</h2>
                <p className="results-muted">{theirs.length ? `${theirs.length} other result${theirs.length === 1 ? "" : "s"} on record` : "No other result on record"}</p>
              </div>
            </div>
            <div className="results-detail-actions">
              <Button icon="arrow-right" to="/pro/patients/$patientId" params={{ patientId: row.patientId }}>Open patient</Button>
              <Button icon="message" to="/pro/messages" search={{ patient: row.patientId }}>Message</Button>
            </div>
          </Card>
        </RightRail>
      }>
        <Card title={`${row.test}, last 12 months`}>
          {series.length > 1
            ? <LineChart points={series} label={`${row.test} for ${row.patientName}`} unit={row.unit ?? undefined} height={220} />
            : <p className="results-muted">This is the only {row.test} value for {row.patientName}, so there is no trend yet.</p>}
        </Card>
        <Card title={`${row.patientName}'s other results`}>
          <DataTable columns={columns} rows={theirs} rowKey={r => r.id} onRowOpen={open} rowAction={r => <RowAction onClick={() => open(r)}>Open</RowAction>}
            empty={<EmptyState>No other result for this patient.</EmptyState>} />
        </Card>
      </WithRail>
    </>
  );
}

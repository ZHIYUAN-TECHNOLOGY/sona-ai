import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { DataTable, PersonCell, RowAction, TableToolbar, ValueCell, type Column } from "@/components/data-table";
import { Icon } from "@/components/icon";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, SearchField, Signal, Tabs } from "@/components/primitives";
import { revealRail, WithRail } from "@/components/rail";
import { PriorityCell, ResultRail } from "@/features/results/result-rail";
import { inTab, summary, type Tab } from "@/features/results/tabs";
import { byTriage, isNormal } from "@/features/results/triage";
import type { ResultRow } from "@/features/results/types";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/results.css";

export const Route = createFileRoute("/pro/_app/results")({ component: Page });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Page() {
  const { me } = Route.useRouteContext();
  const allowed = can(me.role, "results.acknowledge");
  const queryClient = useQueryClient();
  const list = useQuery(orpc.results.list.queryOptions({ input: {} }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.results.list.key() });
  const acknowledge = useMutation(orpc.results.acknowledge.mutationOptions({ onSuccess: refresh }));
  // "Acknowledge normal": the API acknowledges one result at a time, so this sends one call per normal result.
  const acknowledgeAll = useMutation({
    mutationFn: (rows: ResultRow[]) => Promise.all(rows.map(r => orpc.results.acknowledge.call({ resultId: r.id }))),
    onSettled: () => { setConfirming(false); return refresh(); },
  });
  const [tab, setTab] = useState<Tab>("action");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  const sorted = useMemo(() => [...(list.data ?? [])].sort(byTriage), [list.data]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter(inTab(tab)).filter(r => !q || `${r.patientName} ${r.test}`.toLowerCase().includes(q));
  }, [sorted, tab, query]);
  // The selection follows the click; until one, it is the row that most needs a doctor.
  const selected = shown.find(r => r.id === selectedId) ?? shown[0];
  const normals = sorted.filter(r => !r.acknowledgedAt && !r.critical && isNormal(r.flag));
  const next = sorted.find(r => !r.acknowledgedAt);

  const columns: Column<ResultRow>[] = [
    {
      key: "patient", header: "Patient",
      cell: r => <PersonCell name={r.patientName} detail={r.acknowledgedAt ? `Acknowledged${r.acknowledgedByName ? ` · ${r.acknowledgedByName}` : ""}` : "Waiting"} />,
    },
    { key: "test", header: "Test", cell: r => r.test },
    { key: "result", header: "Result", cell: r => <span className="results-value" data-critical={r.critical || undefined}><ValueCell value={r.value} unit={r.unit ?? undefined} /></span> },
    { key: "priority", header: "Priority", cell: r => <span className="results-priority"><PriorityCell row={r} />{r.flag ? <span className="results-muted">{r.flag}</span> : null}</span> },
    { key: "received", header: "Received", cell: r => <span className="results-received">{new Date(r.receivedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</span> },
  ];

  if (list.isError) {
    return (
      <>
        <PageHeader title="Results" />
        <EmptyState title="Results could not be shown" icon="alert" action={<Button onClick={() => list.refetch()}>Try again</Button>}>
          {list.error.message}
        </EmptyState>
      </>
    );
  }

  const n = summary(sorted);
  const pickTab = (t: Tab) => { setTab(t); setSelectedId(undefined); };
  const review = (id: string) => { setSelectedId(id); revealRail("result-rail"); };
  return (
    <>
      <PageHeader
        title="Results"
        lead={list.isPending ? "Loading results…" : n.fresh ? (
          <>
            {plural(n.fresh, "new result")} across {plural(n.patients, "patient")} ·{" "}
            {n.critical ? <Signal tone="urgent">{n.critical} critical</Signal> : "0 critical"} ·{" "}
            {n.review ? <Signal tone="soon">{n.review} to review</Signal> : "0 to review"}
          </>
        ) : "No result is waiting for a doctor"}
        actions={(
          <>
            {allowed && normals.length ? (confirming ? (
              <span className="results-confirm">
                <Button variant="primary" icon="check" pending={acknowledgeAll.isPending} onClick={() => acknowledgeAll.mutate(normals)}>
                  Acknowledge {plural(normals.length, "normal result")}
                </Button>
                <Button onClick={() => setConfirming(false)}>Cancel</Button>
              </span>
            ) : <Button onClick={() => { pickTab("new"); setConfirming(true); }}>Acknowledge normal</Button>) : null}
            <Button
              variant="primary" icon="arrow-right" disabled={!next}
              onClick={() => { if (next) { setQuery(""); setTab(inTab("action")(next) ? "action" : "new"); setSelectedId(next.id); } }}
            >
              Open next
            </Button>
          </>
        )}
      />
      {acknowledgeAll.isError ? <p className="results-error" role="alert">Some results were not acknowledged: {acknowledgeAll.error.message}</p> : null}
      <WithRail
        rail={selected ? (
          <ResultRail
            row={selected} rows={sorted} allowed={allowed}
            pending={acknowledge.isPending && acknowledge.variables?.resultId === selected.id}
            error={acknowledge.isError && acknowledge.variables?.resultId === selected.id ? acknowledge.error.message : undefined}
            onAcknowledge={r => acknowledge.mutate({ resultId: r.id })}
          />
        ) : null}
      >
        <DataTable
          columns={columns} rows={shown} rowKey={r => r.id} selectedKey={selected?.id} loading={list.isPending}
          onRowOpen={r => setSelectedId(r.id)}
          rowAction={r => <RowAction onClick={() => review(r.id)}>Review</RowAction>}
          toolbar={(
            <TableToolbar end={<SearchField label="Search results" placeholder="Search patient or test" value={query} onChange={e => setQuery(e.target.value)} />}>
              <Tabs
                label="Results by state" value={tab} onChange={pickTab}
                tabs={[
                  { id: "action", label: "Needs action", count: sorted.filter(inTab("action")).length },
                  { id: "new", label: "New", count: n.fresh },
                  { id: "acknowledged", label: "Acknowledged", count: sorted.length - n.fresh },
                ]}
              />
            </TableToolbar>
          )}
          empty={query ? "No result matches this search." : tab === "acknowledged" ? "No result has been acknowledged yet." : sorted.length ? "Nothing here is waiting for a doctor." : "No lab results have arrived yet."}
          footer={(
            <p className="results-footnote">
              <Icon name="info" size={16} /> Priority is suggested from lab flags and call-now rules.
            </p>
          )}
        />
      </WithRail>
    </>
  );
}

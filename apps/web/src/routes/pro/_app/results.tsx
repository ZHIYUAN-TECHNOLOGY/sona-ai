import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { DataTable, type Column } from "@/components/data-table";
import { InsightCard, InsightRow } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Avatar, Button, Chip } from "@/components/primitives";
import { WithRail } from "@/components/rail";
import { FlagChip, ResultRail, valueOf, when } from "@/features/results/result-rail";
import { byTriage, counts, matches, type Filter } from "@/features/results/triage";
import type { ResultRow } from "@/features/results/types";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/results.css";

export const Route = createFileRoute("/pro/_app/results")({ component: Page });

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "abnormal", label: "Flagged" },
  { key: "unacknowledged", label: "Unacknowledged" },
];

function Page() {
  const { me } = Route.useRouteContext();
  const allowed = can(me.role, "results.acknowledge");
  const queryClient = useQueryClient();
  const list = useQuery(orpc.results.list.queryOptions({ input: {} }));
  const acknowledge = useMutation(orpc.results.acknowledge.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.results.list.key() }),
  }));
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string>();

  const sorted = useMemo(() => [...(list.data ?? [])].sort(byTriage), [list.data]);
  const shown = useMemo(() => sorted.filter(matches(filter)), [sorted, filter]);
  // The selection follows the click; until one, it is the row that most needs a doctor.
  const selected = shown.find(r => r.id === selectedId) ?? shown[0];

  const columns = useMemo<Column<ResultRow>[]>(() => [
    {
      key: "patient", header: "Patient",
      cell: r => (
        <span className="results-patient" aria-current={r.id === selected?.id ? "true" : undefined}>
          <Avatar name={r.patientName} /> {r.patientName}
        </span>
      ),
    },
    { key: "test", header: "Test", cell: r => r.test },
    { key: "value", header: "Value", cell: r => <span className="results-value" data-critical={r.critical || undefined}>{valueOf(r)}</span> },
    { key: "flag", header: "Flag", cell: r => <FlagChip row={r} /> },
    { key: "received", header: "Received", cell: r => when(r.receivedAt) },
    {
      key: "state", header: "State",
      cell: r => (r.acknowledgedAt
        ? <Chip tone="done">Acknowledged{r.acknowledgedByName ? ` · ${r.acknowledgedByName}` : ""}</Chip>
        : <Chip tone={r.critical ? "urgent" : "soon"}>Waiting</Chip>),
    },
  ], [selected?.id]);

  if (list.isPending) return <><PageHeader title="Results" /><EmptyState>Loading results…</EmptyState></>;
  if (list.isError) {
    return (
      <>
        <PageHeader title="Results" />
        <EmptyState>Results could not be shown: {list.error.message}</EmptyState>
      </>
    );
  }

  const n = counts(sorted, new Date());
  const plural = (count: number) => (count === 1 ? "result" : "results");
  const show = (next: Filter) => () => { setFilter(next); setSelectedId(undefined); };

  return (
    <>
      <PageHeader title="Results" lead="Lab results by what needs a doctor first." />
      <InsightRow>
        <InsightCard
          tone="urgent" sources={n.mustNotMiss}
          lead={n.mustNotMiss ? `${n.mustNotMiss} critical ${plural(n.mustNotMiss)} must not be missed.` : "No critical result is waiting."}
          next={n.mustNotMiss ? { label: "Review the newest critical result", onAct: show("unacknowledged") } : undefined}
        />
        <InsightCard
          tone="soon" sources={n.waiting}
          lead={n.waiting ? `${n.waiting} other ${plural(n.waiting)} waiting for a doctor.` : "Nothing else is waiting."}
          next={n.waiting ? { label: "Show unacknowledged", onAct: show("unacknowledged") } : undefined}
        />
        <InsightCard
          tone="done" sources={n.acknowledgedToday}
          lead={`${n.acknowledgedToday} ${plural(n.acknowledgedToday)} acknowledged today.`}
          next={{ label: "Show all results", onAct: show("all") }}
        />
      </InsightRow>
      <div className="results-filters" role="group" aria-label="Filter results">
        {FILTERS.map(f => (
          <Button key={f.key} variant={filter === f.key ? "primary" : "quiet"} aria-pressed={filter === f.key} onClick={show(f.key)}>
            {f.label}
          </Button>
        ))}
      </div>
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
          columns={columns} rows={shown} rowKey={r => r.id} onRowOpen={r => setSelectedId(r.id)}
          empty={sorted.length ? "No results match this filter." : "No lab results have arrived yet."}
        />
      </WithRail>
    </>
  );
}

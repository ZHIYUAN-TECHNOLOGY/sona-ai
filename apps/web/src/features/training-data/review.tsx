import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { type Column, DataTable } from "@/components/data-table";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Chip, SearchField, Skeleton, StatCard, StatRow, type TabItem, Tabs } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { messageOf } from "@/features/library/files";
import { client, orpc } from "@/lib/orpc";
import "@/styles/pages/library.css";
import "@/styles/pages/training-data.css";

type Sample = Awaited<ReturnType<typeof client.training.samples>>[number];
type Status = Sample["status"];
type Tab = Status | "all";
const STATUSES = ["pending", "approved", "blocked", "excluded", "withdrawn"] as const satisfies readonly Status[];
const LABEL: Record<Tab, string> = { all: "All", pending: "To review", approved: "Approved", blocked: "Blocked", excluded: "Excluded", withdrawn: "Withdrawn" };

/** Only the states that need the eye get a chip; the rest are calm text. */
function StatusText({ status }: { status: Status }) {
  if (status === "pending") return <Chip tone="soon">To review</Chip>;
  if (status === "blocked") return <Chip tone="urgent" icon="alert">Blocked</Chip>;
  return <span className="td-muted">{LABEL[status]}</span>;
}

export function Review() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("pending");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string>();
  const status = useQuery(orpc.training.status.queryOptions());
  const samples = useQuery(orpc.training.samples.queryOptions({ input: tab === "all" ? undefined : { status: tab } }));
  const refresh = () => Promise.all([orpc.training.status.key(), orpc.training.samples.key()].map(queryKey => queryClient.invalidateQueries({ queryKey })));
  const contribute = useMutation(orpc.training.setContributes.mutationOptions({ onSuccess: refresh }));
  const decide = useMutation(orpc.training.decide.mutationOptions({ onSuccess: refresh }));
  const s = status.data;
  const c = s?.counts;
  const total = c ? STATUSES.reduce((n, k) => n + c[k], 0) : 0;
  const stat = (n: number | undefined) => n ?? <Skeleton width={48} height={28} />;
  const unit = (text: string) => (s ? text : undefined); // no unit beside a loading number

  const needle = q.trim().toLowerCase();
  const all = samples.data ?? [];
  const rows = needle ? all.filter(r => `${r.input}\n${r.output}\n${r.deidentifier}`.toLowerCase().includes(needle)) : all;
  const open = all.find(r => r.id === openId);

  const tabs: TabItem<Tab>[] = [
    ...STATUSES.map(id => ({ id, label: LABEL[id], count: c?.[id] })),
    { id: "all", label: LABEL.all, count: c ? total : undefined },
  ];

  const actions = (r: Sample) => {
    const busy = decide.isPending && decide.variables?.id === r.id;
    return (
      <span className="td-actions">
        {r.status !== "approved" && r.status !== "blocked" && r.status !== "withdrawn" && <Button variant="primary" size="sm" pending={busy} onClick={() => decide.mutate({ id: r.id, decision: "approve" })}>Approve</Button>}
        {r.status !== "excluded" && r.status !== "withdrawn" && <Button size="sm" pending={busy} onClick={() => decide.mutate({ id: r.id, decision: "exclude" })}>Exclude</Button>}
      </span>
    );
  };

  const columns: Column<Sample>[] = [
    { key: "input", header: "Asked", cell: r => <div className="td-clip">{r.input}</div> },
    { key: "output", header: "Answered", cell: r => <div className="td-clip td-muted">{r.output}</div> },
    { key: "deidentifier", header: "De-identified by", cell: r => <span className="td-muted">{r.deidentifier}</span>, sort: (a, b) => a.deidentifier.localeCompare(b.deidentifier) },
    { key: "status", header: "Status", cell: r => <StatusText status={r.status} /> },
  ];

  const lead = !s ? "De-identified samples the hospital may contribute. Nothing leaves before you approve it."
    : !s.contributes ? "The hospital is not contributing, so no samples are taken."
    : s.counts.pending ? `${s.counts.pending} de-identified ${s.counts.pending === 1 ? "sample waits" : "samples wait"} for your review. Nothing leaves before you approve it.`
    : "No samples wait for review. Nothing leaves before you approve it.";

  const table = (
    <Card>
      {(decide.isError || contribute.isError) && <p className="lib-error" role="alert">{messageOf(decide.error ?? contribute.error)}</p>}
      {samples.isError ? <EmptyState icon="database" title="The samples could not be shown">{messageOf(samples.error)}</EmptyState> : (
        <DataTable columns={columns} rows={rows} rowKey={r => r.id} loading={samples.isPending}
          selectedKey={open?.id} onRowOpen={r => setOpenId(r.id === openId ? undefined : r.id)} rowAction={actions}
          toolbar={(
            <>
              <Tabs label="Samples by status" tabs={tabs} value={tab} onChange={setTab} />
              <SearchField className="td-search" label="Search samples" placeholder="Search samples" value={q} onChange={e => setQ(e.target.value)} />
            </>
          )}
          empty={(
            <EmptyState icon="database" title={needle ? "No samples match" : s && !s.contributes ? "No samples are taken" : tab === "all" ? "No samples yet" : tab === "pending" ? "Nothing to review" : `No ${LABEL[tab].toLowerCase()} samples`}>
              {needle ? "Try a different search." : s && !s.contributes ? "Turn on contributing to start collecting de-identified samples." : "Samples appear here once they are de-identified."}
            </EmptyState>
          )}
          count={all.length ? <span className="lib-num">Showing {rows.length} of {all.length} {all.length === 1 ? "sample" : "samples"}</span> : undefined} />
      )}
    </Card>
  );

  return (
    <>
      <PageHeader title="Training data" lead={lead} actions={s && (
        <label className="td-switch" data-on={s.contributes || undefined}>
          <input type="checkbox" role="switch" checked={s.contributes} disabled={contribute.isPending} onChange={e => contribute.mutate({ contributes: e.target.checked })} />
          {s.contributes ? "Contributing" : "Not contributing"}
        </label>
      )} />
      {status.isError ? <EmptyState icon="database" title="The status could not be shown">{messageOf(status.error)}</EmptyState> : (
        <StatRow>
          <StatCard title="To review" value={stat(c?.pending)} unit={unit("samples")} chip={c?.pending ? "Needs review" : undefined} tone="soon" caption="Waiting for a decision" />
          <StatCard title="Approved" value={stat(c?.approved)} unit={unit(total ? `of ${total}` : "samples")} progress={total ? (c?.approved ?? 0) / total : undefined} caption="Cleared to contribute" />
          <StatCard title="Blocked" value={stat(c?.blocked)} unit={unit("samples")} chip={c?.blocked ? "Patient details" : undefined} tone="urgent" caption={c ? `${c.excluded} excluded, ${c.withdrawn} withdrawn` : undefined} />
          <StatCard title="Ready for next dataset" value={stat(s?.ready)} unit={unit("rows")} caption={!s ? undefined : s.lastDataset ? `Last dataset: version ${s.lastDataset.version}, ${s.lastDataset.rows} rows` : "No dataset exported yet"} />
        </StatRow>
      )}
      {open ? (
        <WithRail rail={(
          <RightRail label="Selected sample">
            <Card title="Selected sample">
              <dl className="td-detail">
                <dt>Asked</dt><dd>{open.input}</dd>
                <dt>Answered</dt><dd>{open.output}</dd>
                <dt>De-identified by</dt><dd>{open.deidentifier}</dd>
                <dt>Status</dt><dd><StatusText status={open.status} /></dd>
              </dl>
              {actions(open)}
            </Card>
          </RightRail>
        )}>{table}</WithRail>
      ) : table}
    </>
  );
}

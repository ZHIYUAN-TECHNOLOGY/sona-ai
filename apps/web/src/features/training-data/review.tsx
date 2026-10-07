import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { type Column, DataTable, TableToolbar } from "@/components/data-table";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Chip, SearchField, Signal, Skeleton, StatCard, StatRow, type TabItem, Tabs } from "@/components/primitives";
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
  // The first sample is open until another is chosen, so after a decision the next one is already in the panel.
  const open = rows.find(r => r.id === openId) ?? rows[0];

  const tabs: TabItem<Tab>[] = [
    ...STATUSES.map(id => ({ id, label: LABEL[id], count: c?.[id] })),
    { id: "all", label: LABEL.all, count: c ? total : undefined },
  ];

  // The decision sits beside the full sample in the panel, not on the clipped row.
  const mayApprove = open && open.status !== "approved" && open.status !== "blocked" && open.status !== "withdrawn";
  const mayExclude = open && open.status !== "excluded" && open.status !== "withdrawn";
  const left = c?.pending ?? 0;

  const columns: Column<Sample>[] = [
    { key: "input", header: "Asked", cell: r => <div className="td-clip">{r.input}</div> },
    { key: "output", header: "Answered", cell: r => <div className="td-clip td-muted">{r.output}</div> },
    { key: "deidentifier", header: "De-identified by", cell: r => <span className="td-muted">{r.deidentifier}</span>, sort: (a, b) => a.deidentifier.localeCompare(b.deidentifier) },
    { key: "status", header: "Status", cell: r => <StatusText status={r.status} /> },
  ];

  const lead = !s ? "De-identified samples the hospital may contribute. Nothing leaves before you approve it."
    : !s.contributes ? "The hospital is not contributing, so no samples are taken."
    : <>
        {left ? <Signal tone="soon">{left} {left === 1 ? "sample" : "samples"} to review</Signal> : <Signal tone="done">Nothing to review</Signal>}
        {s.counts.blocked ? <> · <Signal tone="urgent">{s.counts.blocked} blocked for patient details</Signal></> : null}
        {" · nothing leaves before you approve it"}
      </>;

  const table = (
    <Card>
      {(decide.isError || contribute.isError) && <p className="lib-error" role="alert">{messageOf(decide.error ?? contribute.error)}</p>}
      {samples.isError ? <EmptyState icon="database" title="The samples could not be shown">{messageOf(samples.error)}</EmptyState> : (
        <DataTable columns={columns} rows={rows} rowKey={r => r.id} loading={samples.isPending}
          selectedKey={open?.id} onRowOpen={r => setOpenId(r.id)}
          toolbar={(
            <TableToolbar end={<SearchField label="Search samples" placeholder="Search samples" value={q} onChange={e => setQ(e.target.value)} />}>
              <Tabs label="Samples by status" tabs={tabs} value={tab} onChange={setTab} />
            </TableToolbar>
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
          <StatCard title="To review" value={stat(c?.pending)} unit={unit("samples")} tone="soon" caption="Waiting for a decision" onSelect={() => setTab("pending")} selected={tab === "pending"} />
          <StatCard title="Approved" value={stat(c?.approved)} unit={unit(total ? `of ${total}` : "samples")} progress={total ? (c?.approved ?? 0) / total : undefined} caption="Cleared to contribute" onSelect={() => setTab("approved")} selected={tab === "approved"} />
          <StatCard title="Blocked" value={stat(c?.blocked)} unit={unit("samples")} chip={c?.blocked ? "Patient details" : undefined} tone="urgent" caption={c ? `${c.excluded} excluded, ${c.withdrawn} withdrawn` : undefined} onSelect={() => setTab("blocked")} selected={tab === "blocked"} />
          <StatCard title="Ready for next dataset" value={stat(s?.ready)} unit={unit("rows")} caption={!s ? undefined : s.lastDataset ? `Last dataset: version ${s.lastDataset.version}, ${s.lastDataset.rows} rows` : "No dataset exported yet"} />
        </StatRow>
      )}
      {samples.isPending ? (
        <WithRail rail={<RightRail label="Review this sample"><Card title="Review this sample"><Skeleton height={120} /></Card></RightRail>}>{table}</WithRail>
      ) : open ? (
        <WithRail rail={(
          <RightRail label="Review this sample">
            <Card title="Review this sample">
              <dl className="td-detail">
                <dt>Asked</dt><dd className="td-long" tabIndex={0}>{open.input}</dd>
                <dt>Answered</dt><dd className="td-long" tabIndex={0}>{open.output}</dd>
                <dt>De-identified by</dt><dd>{open.deidentifier}</dd>
                <dt>Status</dt><dd><StatusText status={open.status} /></dd>
              </dl>
              {open.status === "blocked" ? <p className="td-muted">Blocked because patient details were found. It cannot be approved.</p>
                : mayApprove ? <p className="td-muted">Approve adds it to the next dataset. Exclude keeps it out.</p> : null}
              <span className="td-actions">
                {mayApprove ? <Button variant="primary" size="sm" pending={decide.isPending} onClick={() => decide.mutate({ id: open.id, decision: "approve" })}>Approve</Button> : null}
                {mayExclude ? <Button size="sm" pending={decide.isPending} onClick={() => decide.mutate({ id: open.id, decision: "exclude" })}>Exclude</Button> : null}
              </span>
              {decide.isSuccess ? (
                <p role="status"><Signal tone="done">{decide.variables.decision === "approve" ? "Approved" : "Excluded"}</Signal> {left ? `${left} left to review.` : "Nothing is left to review."}</p>
              ) : null}
            </Card>
          </RightRail>
        )}>{table}</WithRail>
      ) : table}
    </>
  );
}

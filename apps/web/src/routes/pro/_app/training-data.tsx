import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { type Column, DataTable } from "@/components/data-table";
import { InsightCard, InsightRow } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Chip, type Tone } from "@/components/primitives";
import { messageOf } from "@/features/library/files";
import { client, orpc } from "@/lib/orpc";
import "@/styles/pages/library.css";

export const Route = createFileRoute("/pro/_app/training-data")({ component: Page });

type Sample = Awaited<ReturnType<typeof client.training.samples>>[number];
type Status = Sample["status"];
const STATUSES = ["pending", "approved", "blocked", "excluded", "withdrawn"] as const satisfies readonly Status[];
const TONE: Record<Status, Tone | "neutral"> = { pending: "soon", approved: "done", blocked: "urgent", excluded: "neutral", withdrawn: "neutral" };

function Page() {
  const { me } = Route.useRouteContext();
  if (!can(me.role, "training.status")) return <><PageHeader title="Training data" /><EmptyState>Only management can see the hospital's training data.</EmptyState></>;
  return <Review />;
}

function Review() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Status | "">("pending");
  const status = useQuery(orpc.training.status.queryOptions());
  const samples = useQuery(orpc.training.samples.queryOptions({ input: filter ? { status: filter } : undefined }));
  const refresh = () => Promise.all([orpc.training.status.key(), orpc.training.samples.key()].map(queryKey => queryClient.invalidateQueries({ queryKey })));
  const contribute = useMutation(orpc.training.setContributes.mutationOptions({ onSuccess: refresh }));
  const decide = useMutation(orpc.training.decide.mutationOptions({ onSuccess: refresh }));
  const s = status.data;

  const columns: Column<Sample>[] = [
    { key: "input", header: "Asked (de-identified)", cell: r => <div className="lib-clip">{r.input}</div> },
    { key: "output", header: "Answered (de-identified)", cell: r => <div className="lib-clip">{r.output}</div> },
    { key: "status", header: "Status", cell: r => <><Chip tone={TONE[r.status]}>{r.status}</Chip><div className="lib-note">De-identified by {r.deidentifier}</div></> },
  ];

  return (
    <>
      <PageHeader title="Training data" lead="De-identified samples the hospital may contribute. Nothing leaves before you approve it.">
        {s && (
          <label className="lib-row">
            <input type="checkbox" role="switch" checked={s.contributes} disabled={contribute.isPending} onChange={e => contribute.mutate({ contributes: e.target.checked })} />
            {s.contributes ? "Contributing" : "Not contributing"}
          </label>
        )}
      </PageHeader>
      {contribute.isError && <p className="lib-error" role="alert">{messageOf(contribute.error)}</p>}
      {status.isError && <EmptyState>The status could not be shown: {messageOf(status.error)}</EmptyState>}
      {s && (
        <InsightRow>
          <InsightCard tone={s.counts.pending ? "soon" : "done"} lead={s.counts.pending ? `${s.counts.pending} samples wait for your review.` : "No samples wait for review."} sources={s.counts.pending} />
          <InsightCard tone={s.counts.blocked ? "urgent" : "info"} lead={`${s.counts.blocked} blocked for patient details, ${s.counts.excluded} excluded, ${s.counts.withdrawn} withdrawn.`} />
          <InsightCard tone="info" lead={`${s.counts.approved} approved, ${s.ready} ready for the next dataset.${s.lastDataset ? ` Last dataset: version ${s.lastDataset.version}, ${s.lastDataset.rows} rows.` : " No dataset exported yet."}`} />
        </InsightRow>
      )}
      <label className="lib-row lib-form">
        Show
        <select style={{ width: "auto" }} value={filter} onChange={e => setFilter(e.target.value as Status | "")}>
          <option value="">All samples</option>
          {STATUSES.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>
      {decide.isError && <p className="lib-error" role="alert">{messageOf(decide.error)}</p>}
      {samples.isPending ? <EmptyState>Loading samples…</EmptyState>
        : samples.isError ? <EmptyState>The samples could not be shown: {messageOf(samples.error)}</EmptyState>
        : (
          <DataTable columns={columns} rows={samples.data} rowKey={r => r.id}
            empty={s && !s.contributes ? "The hospital is not contributing, so no samples are taken." : `No ${filter} samples.`}
            rowAction={r => {
              const busy = decide.isPending && decide.variables?.id === r.id;
              return (
                <span className="lib-row">
                  {r.status !== "approved" && r.status !== "blocked" && r.status !== "withdrawn" && <Button variant="primary" pending={busy} onClick={() => decide.mutate({ id: r.id, decision: "approve" })}>Approve</Button>}
                  {r.status !== "excluded" && r.status !== "withdrawn" && <Button pending={busy} onClick={() => decide.mutate({ id: r.id, decision: "exclude" })}>Exclude</Button>}
                </span>
              );
            }} />
        )}
    </>
  );
}

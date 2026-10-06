import { can } from "@sona-ai/api/roles";
import { OWNERS, type Owner } from "@sona-ai/domain/ward";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { BarChart } from "@/components/charts";
import { DataTable, type Column } from "@/components/data-table";
import { InsightCard, InsightRow } from "@/components/insight-card";
import { PageHeader } from "@/components/page";
import { Chip, type Tone } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { Loaded } from "@/features/ward/state";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/ward.css";

export const Route = createFileRoute("/pro/_app/ward")({ component: Page });

const STATUS: Record<string, Tone | "neutral"> = { fit: "done", watch: "soon", stable: "info", empty: "neutral", free: "done" };
const hour = (at: Date | string) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", timeZone: "Asia/Kuala_Lumpur" }) + ":00";

function Page() {
  const { me } = Route.useRouteContext();
  const mayAssign = can(me.role, "ward.assignOwner");
  const queryClient = useQueryClient();
  // Four independent reads, started together.
  const beds = useQuery(orpc.ward.beds.queryOptions());
  const forecast = useQuery(orpc.ward.forecast.queryOptions());
  const huddle = useQuery(orpc.ward.huddle.queryOptions());
  const ops = useQuery(orpc.ops.get.queryOptions());
  // A blocker's owner lives in its blocker-owner task.
  const tasks = useQuery(orpc.tasks.list.queryOptions());
  const owners = new Map((tasks.data ?? []).filter(t => t.kind === "blocker-owner" && t.sourceId).map(t => [t.sourceId!, t.owner]));
  const assign = useMutation(orpc.ward.assignOwner.mutationOptions({
    onSuccess: () => Promise.all([orpc.tasks.list.key(), orpc.ward.forecast.key(), orpc.ward.huddle.key()].map(queryKey => queryClient.invalidateQueries({ queryKey }))),
  }));

  type BedRow = NonNullable<typeof beds.data>[number];
  const blocked = (beds.data ?? []).filter(b => b.blockers.length > 0);
  const reasons = [...new Set(blocked.flatMap(b => b.blockers.map(x => x.label)))].slice(0, 3).join("; ");
  const unowned = blocked.flatMap(b => b.blockers).filter(x => !owners.has(x.id)).length;
  const brief = huddle.data as { lines?: string[]; source?: string } | undefined;
  const sample = brief?.source === "fixture" || brief?.source === "waking";
  // Beds expected free per hour: the forecast timeline as a numeric series.
  const perHour = new Map<string, number>();
  for (const e of forecast.data?.timeline ?? []) perHour.set(hour(e.at), (perHour.get(hour(e.at)) ?? 0) + 1);
  const points = [...perHour].map(([x, y]) => ({ x, y }));

  const columns: Column<BedRow>[] = [
    { key: "bed", header: "Bed", cell: b => b.bed },
    { key: "patient", header: "Patient", cell: b => b.name ? <>{b.name} <span className="ward-muted">{b.meta}</span></> : <span className="ward-muted">No patient</span> },
    { key: "status", header: "Status", cell: b => <Chip tone={STATUS[b.status]}>{b.status}</Chip> },
    { key: "free", header: "Expected free", cell: b => b.predicted || "–" },
    {
      key: "blockers", header: "Blocker and owner", cell: b => b.blockers.length === 0 ? <span className="ward-muted">Nothing blocking</span> : (
        <div className="ward-stack">
          {b.blockers.map(x => (
            <div key={x.id} className="ward-blocker">
              <Chip tone="soon">{x.label}</Chip>
              <span className="ward-muted">{x.detail}</span>
              {mayAssign ? (
                <select className="ward-control" aria-label={`Owner for ${b.bed}: ${x.label}`} value={owners.get(x.id) ?? ""} disabled={assign.isPending}
                  onChange={e => assign.mutate({ blockerId: x.id, owner: e.target.value as Owner })}>
                  <option value="" disabled>Assign owner</option>
                  {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : <span className="ward-muted">{owners.get(x.id) ?? "No owner yet"}</span>}
            </div>
          ))}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Ward" lead={mayAssign ? undefined : "Your role can see the ward but cannot assign blocker owners."} />
      <InsightRow>
        {beds.data && (
          <InsightCard tone={blocked.length ? "soon" : "done"} sources={blocked.length}
            lead={blocked.length ? `${blocked.length} of ${beds.data.length} beds blocked: ${reasons}` : "No bed is blocked"}>
            {unowned > 0 && `${unowned} blocker${unowned === 1 ? " has" : "s have"} no owner yet. Assign one in the table.`}
          </InsightCard>
        )}
        {forecast.data && (
          <InsightCard tone="info" sources={forecast.data.timeline.length} lead={`${forecast.data.today.count} discharge${forecast.data.today.count === 1 ? "" : "s"} expected today`}>
            {forecast.data.label}{forecast.data.unlock && `. Biggest unlock: ${forecast.data.unlock.line}`}
          </InsightCard>
        )}
        {brief?.lines?.[0] && (
          <InsightCard tone="info" lead={brief.lines[0]}>
            {sample && <Chip>Sample brief</Chip>} {brief.lines.slice(1).join(" ")}
          </InsightCard>
        )}
      </InsightRow>
      {assign.error && <p className="ward-error" role="alert">Could not assign the owner: {assign.error.message}</p>}
      <WithRail rail={(
        <RightRail label="Forecast and operations">
          {points.length > 0 ? <BarChart points={points} label="Beds expected free, by hour" unit="beds" /> : <p className="ward-muted">{forecast.isPending ? "Loading the forecast…" : forecast.error ? `No forecast: ${forecast.error.message}` : "No bed is forecast to free up."}</p>}
          {ops.data ? (
            <dl className="ward-counts">
              <dt>Discharges, last 7 days</dt><dd>{ops.data.discharges}</dd>
              <dt>Bed minutes saved</dt><dd>{ops.data.bedMinutesSaved}</dd>
              <dt>Red flags acted on</dt><dd>{ops.data.redFlagsActedOn} of {ops.data.redFlags}</dd>
              <dt>Check-ins answered</dt><dd>{ops.data.checkInsAnswered} of {ops.data.checkInsSent}</dd>
            </dl>
          ) : <p className="ward-muted">{ops.isPending ? "Loading the ops counter…" : `No ops counter: ${ops.error?.message}`}</p>}
        </RightRail>
      )}>
        <Loaded query={beds} what="the ward" empty="No beds on this ward yet.">
          {rows => <DataTable columns={columns} rows={rows} rowKey={b => b.bed} />}
        </Loaded>
      </WithRail>
    </>
  );
}

import { can } from "@sona-ai/api/roles";
import { OWNERS, type Owner } from "@sona-ai/domain/ward";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { BarChart } from "@/components/charts";
import { DataTable, PersonCell, RowAction, TableToolbar, type Column } from "@/components/data-table";
import { InsightCard } from "@/components/insight-card";
import { PageHeader } from "@/components/page";
import { Card, Chip, ListCard, ListRow, SearchField, StatCard, StatRow, Tabs } from "@/components/primitives";
import { revealRail, RightRail, WithRail } from "@/components/rail";
import { Loaded } from "@/features/ward/state";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/ward.css";

export const Route = createFileRoute("/pro/_app/ward")({ component: Page });

type Tab = "all" | "blocked" | "watch" | "free";
const hour = (at: Date | string) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", timeZone: "Asia/Kuala_Lumpur" }) + ":00";

function Page() {
  const { me } = Route.useRouteContext();
  const mayAssign = can(me.role, "ward.assignOwner");
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string>();
  // Four independent reads, started together.
  const beds = useQuery(orpc.ward.beds.queryOptions());
  const forecast = useQuery(orpc.ward.forecast.queryOptions());
  const huddle = useQuery(orpc.ward.huddle.queryOptions());
  const ops = useQuery(orpc.ops.get.queryOptions());
  // A blocker's owner lives in its blocker-owner task.
  const tasks = useQuery(orpc.tasks.list.queryOptions());
  const owners = new Map((tasks.data ?? []).filter(t => t.kind === "blocker-owner" && t.sourceId).map(t => [t.sourceId!, t.owner]));
  const refreshOwners = () => Promise.all([orpc.tasks.list.key(), orpc.ward.forecast.key(), orpc.ward.huddle.key()].map(queryKey => queryClient.invalidateQueries({ queryKey })));
  const assign = useMutation(orpc.ward.assignOwner.mutationOptions({ onSuccess: refreshOwners }));
  const unassign = useMutation(orpc.ward.unassignOwner.mutationOptions({ onSuccess: refreshOwners }));

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

  const all = beds.data ?? [];
  const occupied = all.filter(b => b.name).length;
  const isFree = (b: BedRow) => !b.name;
  const groups: Record<Tab, BedRow[]> = { all, blocked, watch: all.filter(b => b.status === "watch"), free: all.filter(isFree) };
  const q = search.trim().toLowerCase();
  const rows = groups[tab].filter(b => !q || `${b.bed} ${b.name ?? ""} ${b.blockers.map(x => x.label).join(" ")}`.toLowerCase().includes(q));
  const bed = all.find(b => b.bed === picked) ?? blocked[0];
  const ownerOf = (b: BedRow) => [...new Set(b.blockers.flatMap(x => owners.get(x.id) ?? []))].join(", ");

  const columns: Column<BedRow>[] = [
    { key: "bed", header: "Bed", cell: b => <span className="ward-bed"><strong>{b.bed}</strong>{b.predicted ? <span className="ward-muted">Free {b.predicted}</span> : null}</span>, sort: (x, y) => x.bed.localeCompare(y.bed, undefined, { numeric: true }) },
    { key: "patient", header: "Patient", cell: b => b.name ? <PersonCell name={b.name} detail={b.meta} /> : <span className="ward-muted">No patient</span> },
    {
      key: "waits", header: "Waiting on", cell: b => b.blockers.length === 0 ? <span className="ward-muted">{b.status === "watch" ? "Being watched" : b.name ? "Nothing blocking" : "Free"}</span> : (
        <span className="ward-waits" title={b.blockers.map(x => x.label).join(", ")}><Chip tone="soon">{b.blockers[0]!.label}</Chip>{b.blockers.length > 1 && <span className="ward-muted">+{b.blockers.length - 1} more</span>}</span>
      ),
    },
    { key: "owner", header: "Owner", cell: b => b.blockers.length === 0 ? <span className="ward-muted">–</span> : ownerOf(b) ? <span className="ward-owners" title={ownerOf(b)}>{ownerOf(b)}</span> : <Chip tone="urgent">No owner</Chip> },
  ];

  return (
    <>
      <PageHeader title="Ward"
        subtitle={beds.data ? `${occupied} of ${all.length} beds occupied · ${blocked.length} blocked · ${unowned} blocker${unowned === 1 ? "" : "s"} without an owner` : "Loading the ward…"}
        status={mayAssign ? undefined : "Your role can see the ward but cannot assign blocker owners."} />
      {beds.data && (
        <StatRow>
          <StatCard title="Beds occupied" value={occupied} unit={`of ${all.length}`} progress={all.length ? occupied / all.length : 0} feature />
          <StatCard title="Due for discharge" value={forecast.data?.today.count ?? "–"} unit="today" caption={forecast.data?.label} />
          <StatCard title="Blocked" value={blocked.length} unit="beds" caption={reasons || "No bed is blocked"} chip={blocked.length ? "Needs action" : undefined} tone="soon" />
          <StatCard title="Blockers without an owner" value={unowned} caption={unowned ? "Assign one in the bed's detail" : "Every blocker has an owner"} chip={unowned ? "Unowned" : undefined} tone="urgent" />
        </StatRow>
      )}
      {assign.error && <p className="ward-error" role="alert">Could not assign the owner: {assign.error.message}</p>}
      {unassign.error && <p className="ward-error" role="alert">Could not clear the owner: {unassign.error.message}</p>}
      <WithRail rail={(
        <RightRail label="Huddle brief, bed detail and forecast" id="ward-rail">
          {brief?.lines?.[0] && (
            <InsightCard label={sample ? "Sona AI · sample brief" : "Sona AI"} title="Huddle brief" lead={brief.lines[0]} sources={blocked.length + (forecast.data?.timeline.length ?? 0)}
              evidence={brief.lines.slice(1).map(text => ({ icon: "bed" as const, text }))}
              next={blocked.length ? { label: "Show blocked beds", onAct: () => setTab("blocked") } : undefined} />
          )}
          {bed && (
            <Card title={/^bed/i.test(bed.bed) ? bed.bed : `Bed ${bed.bed}`}>
              {bed.name ? <PersonCell name={bed.name} detail={bed.meta} /> : <p className="ward-muted">No patient in this bed.</p>}
              <dl className="ward-counts ward-gap">
                <dt>Status</dt><dd>{bed.status}</dd>
                <dt>Expected free</dt><dd>{bed.predicted || "–"}</dd>
              </dl>
              {bed.blockers.length === 0 ? <p className="ward-muted">Nothing is blocking this bed.</p> : (
                <ul className="ward-plain ward-stack">
                  {bed.blockers.map(x => (
                    <li key={x.id} className="ward-stack">
                      <span className="ward-blocker"><Chip tone="soon">{x.label}</Chip><span className="ward-muted">{x.detail}</span></span>
                      {mayAssign ? (
                        <select className="ward-control" aria-label={`Owner for ${bed.bed}: ${x.label}`} value={owners.get(x.id) ?? ""} disabled={assign.isPending || unassign.isPending}
                          onChange={e => e.target.value ? assign.mutate({ blockerId: x.id, owner: e.target.value as Owner }) : unassign.mutate({ blockerId: x.id })}>
                          {owners.has(x.id) ? <option value="">No owner</option> : <option value="" disabled>Assign owner</option>}
                          {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : <span className="ward-muted">Owner: {owners.get(x.id) ?? "none yet"}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          <Card title="Beds expected free, by hour">
            {points.length > 0 ? <BarChart points={points} label="Beds expected free, by hour" unit="beds" height={140} /> : <p className="ward-muted">{forecast.isPending ? "Loading the forecast…" : forecast.error ? `No forecast: ${forecast.error.message}` : "No bed is forecast to free up."}</p>}
            {forecast.data?.unlock && <p className="ward-muted">Biggest unlock: {forecast.data.unlock.line}</p>}
          </Card>
          {ops.data ? (
            <ListCard title="Last 7 days">
              <ListRow icon="home" title="Discharges" trailing={<span className="ward-num">{ops.data.discharges}</span>} />
              <ListRow icon="clock" title="Bed minutes saved" trailing={<span className="ward-num">{ops.data.bedMinutesSaved}</span>} />
              <ListRow icon="alert" title="Red flags acted on" trailing={<span className="ward-num">{ops.data.redFlagsActedOn} of {ops.data.redFlags}</span>} />
              <ListRow icon="message" title="Check-ins answered" trailing={<span className="ward-num">{ops.data.checkInsAnswered} of {ops.data.checkInsSent}</span>} />
            </ListCard>
          ) : <p className="ward-muted">{ops.isPending ? "Loading the ops counter…" : `No ops counter: ${ops.error?.message}`}</p>}
        </RightRail>
      )}>
        <Loaded query={beds} what="the ward" empty="No beds on this ward yet.">
          {() => (
            <DataTable columns={columns} rows={rows} rowKey={b => b.bed} selectedKey={bed?.bed} onRowOpen={b => setPicked(b.bed)}
              empty={q ? `No bed matches "${search}".` : "No beds in this state."} count={`Showing ${rows.length} of ${all.length} beds`}
              toolbar={(
                <TableToolbar end={<SearchField label="Search beds" placeholder="Search bed, patient or blocker" value={search} onChange={e => setSearch(e.target.value)} />}>
                  <Tabs label="Beds by state" value={tab} onChange={setTab} tabs={[
                    { id: "all", label: "All beds", count: all.length }, { id: "blocked", label: "Blocked", count: blocked.length },
                    { id: "watch", label: "Watch", count: groups.watch.length }, { id: "free", label: "Free", count: groups.free.length },
                  ]} />
                </TableToolbar>
              )}
              rowAction={b => <RowAction onClick={() => { setPicked(b.bed); revealRail("ward-rail"); }}>{b.blockers.length ? "Review" : "Open"}</RowAction>} />
          )}
        </Loaded>
      </WithRail>
    </>
  );
}

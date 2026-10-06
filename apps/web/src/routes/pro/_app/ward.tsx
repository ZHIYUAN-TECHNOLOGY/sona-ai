import { can } from "@sona-ai/api/roles";
import { OWNERS, type Owner } from "@sona-ai/domain/ward";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { BarChart, BarList, SegmentBar } from "@/components/charts";
import { DataTable, PersonCell, RowAction, TableToolbar, type Column } from "@/components/data-table";
import { InsightCard } from "@/components/insight-card";
import { PageHeader } from "@/components/page";
import { Button, Card, Chip, ListCard, ListRow, SearchField, Select, Signal, StatCard, StatRow, Tabs } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { freeBy, Loaded, rankBeds, unownedOn } from "@/features/ward/state";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/ward.css";

export const Route = createFileRoute("/pro/_app/ward")({ component: Page });

type Tab = "all" | "blocked" | "unowned" | "watch" | "free";
const STATUS = { fit: "Fit for discharge", watch: "Being watched", stable: "Stable", empty: "Empty", free: "Free" };
const hour = (at: Date | string) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", timeZone: "Asia/Kuala_Lumpur" }) + ":00";
const s = (count: number) => count === 1 ? "" : "s";

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
  const assign = useMutation(orpc.ward.assignOwner.mutationOptions({
    onSuccess: () => Promise.all([orpc.tasks.list.key(), orpc.ward.forecast.key(), orpc.ward.huddle.key()].map(queryKey => queryClient.invalidateQueries({ queryKey }))),
  }));

  type BedRow = NonNullable<typeof beds.data>[number];
  // Ranked so the beds that need someone come first; every tab and the detail card follow this order.
  const all = rankBeds(beds.data ?? [], owners);
  const blocked = all.filter(b => b.blockers.length > 0);
  const noOwner = all.filter(b => unownedOn(b, owners) > 0);
  const unowned = noOwner.reduce((sum, b) => sum + unownedOn(b, owners), 0);
  const brief = huddle.data as { lines?: string[]; source?: string } | undefined;
  const sample = brief?.source === "fixture" || brief?.source === "waking";
  // Beds expected free per hour: the forecast timeline as a numeric series.
  const perHour = new Map<string, number>();
  for (const e of forecast.data?.timeline ?? []) perHour.set(hour(e.at), (perHour.get(hour(e.at)) ?? 0) + 1);
  const points = [...perHour].map(([x, y]) => ({ x, y }));

  const occupied = all.filter(b => b.name).length;
  const groups: Record<Tab, BedRow[]> = { all, blocked, unowned: noOwner, watch: all.filter(b => b.status === "watch"), free: all.filter(b => !b.name) };
  // One pass for the charts: each bed in exactly one state, and how many beds wait on each kind of blocker.
  const states = { unowned: 0, blocked: 0, watch: 0, clear: 0, free: 0 };
  const waits = new Map<string, number>();
  for (const b of all) {
    states[!b.name ? "free" : unownedOn(b, owners) > 0 ? "unowned" : b.blockers.length ? "blocked" : b.status === "watch" ? "watch" : "clear"]++;
    for (const x of b.blockers) waits.set(x.label, (waits.get(x.label) ?? 0) + 1);
  }
  const holding = [...waits].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5);
  const q = search.trim().toLowerCase();
  const rows = groups[tab].filter(b => !q || `${b.bed} ${b.name ?? ""} ${b.blockers.map(x => x.label).join(" ")}`.toLowerCase().includes(q));
  const bed = all.find(b => b.bed === picked) ?? all[0];
  // The suggested next step once this bed's blockers all have an owner.
  const nextBed = bed && unownedOn(bed, owners) === 0 ? noOwner[0] : undefined;
  const assigned = assign.isSuccess && bed?.blockers.some(x => x.id === assign.variables.blockerId) ? assign.variables.owner : undefined;
  const ownerLine = (b: BedRow) => {
    const open = unownedOn(b, owners);
    if (open === 0) return <span className="ward-muted">Owner: {[...new Set(b.blockers.map(x => owners.get(x.id)))].join(", ")}</span>;
    return <span className="ward-unowned">{open === b.blockers.length ? "No owner yet" : `${open} of ${b.blockers.length} without an owner`}</span>;
  };

  const columns: Column<BedRow>[] = [
    { key: "bed", header: "Bed", cell: b => <span className="ward-bed"><strong>{b.bed}</strong>{b.predicted ? <span className="ward-muted">{freeBy(b.predicted)}</span> : null}</span>, sort: (x, y) => x.bed.localeCompare(y.bed, undefined, { numeric: true }) },
    { key: "patient", header: "Patient", cell: b => b.name ? <PersonCell name={b.name} detail={b.meta} /> : <span className="ward-muted">No patient</span> },
    {
      key: "waits", header: "Waiting on", cell: b => b.blockers.length === 0 ? <span className="ward-muted">{b.status === "watch" ? "Being watched" : b.name ? "Nothing blocking" : "Free"}</span> : (
        <span className="ward-waits"><span>{b.blockers.map(x => x.label).join(", ")}</span>{ownerLine(b)}</span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Ward"
        lead={beds.data ? (
          <>
            {occupied} of {all.length} beds occupied ·{" "}
            {blocked.length ? <Signal tone="soon">{blocked.length} blocked</Signal> : "none blocked"} ·{" "}
            {unowned ? <Signal tone="urgent">{unowned} blocker{s(unowned)} without an owner</Signal> : "every blocker has an owner"}
          </>
        ) : "Loading the ward…"}
        status={mayAssign ? undefined : "Your role can see the ward but cannot assign blocker owners."} />
      {beds.data ? (
        <>
        <StatRow>
          <StatCard title="Beds occupied" value={occupied} unit={`of ${all.length}`} progress={all.length ? occupied / all.length : 0} feature onSelect={() => setTab("all")} selected={tab === "all"} />
          <StatCard title="Blocked" value={blocked.length} unit="beds" caption={blocked.length ? `Waiting on ${blocked.flatMap(b => b.blockers).length} things` : "No bed is blocked"} chip={blocked.length ? "Needs action" : undefined} tone="soon" onSelect={() => setTab("blocked")} selected={tab === "blocked"} />
          <StatCard title="No owner" value={unowned} caption={unowned ? `Blocker${s(unowned)} on ${noOwner.length} bed${s(noOwner.length)}` : "Every blocker has an owner"} chip={unowned ? "Assign owner" : undefined} tone="urgent" onSelect={() => setTab("unowned")} selected={tab === "unowned"} />
          <StatCard title="Free" value={groups.free.length} unit="now" caption={forecast.data ? `${forecast.data.today.count} due for discharge today` : undefined} onSelect={() => setTab("free")} selected={tab === "free"} />
        </StatRow>
        <div className="chart-row">
          <Card title="Beds by state">
            <SegmentBar label="Beds by state" segments={[
              { label: "Blocked, no owner", value: states.unowned, tone: "red" },
              { label: "Blocked, owned", value: states.blocked, tone: "amber" },
              { label: "On watch only", value: states.watch, tone: "blue" },
              { label: "Nothing blocking", value: states.clear, tone: "green" },
              { label: "Free", value: states.free, tone: "neutral" },
            ]} />
          </Card>
          <Card title="What beds are waiting on">
            {holding.length ? <BarList label="Beds waiting on each blocker" rows={holding} tone="amber" unit="beds" /> : <p className="ward-muted">Nothing is holding a bed.</p>}
          </Card>
        </div>
        </>
      ) : null}
      <WithRail rail={(
        <RightRail label="Bed detail, huddle brief and forecast">
          {bed ? (
            <Card title={bed.bed}>
              {bed.name ? <PersonCell name={bed.name} detail={bed.meta} /> : <p className="ward-muted">No patient in this bed.</p>}
              <dl className="ward-counts ward-gap">
                <dt>Status</dt><dd>{STATUS[bed.status]}</dd>
                <dt>Expected free</dt><dd>{bed.predicted || "Not forecast"}</dd>
              </dl>
              {bed.blockers.length === 0 ? <p className="ward-muted">Nothing is blocking this bed.</p> : (
                <ul className="ward-plain ward-stack">
                  {bed.blockers.map(x => (
                    <li key={x.id} className="ward-blocker">
                      <span className="ward-waits"><strong>{x.label}</strong><span className="ward-muted">{x.detail}</span></span>
                      {mayAssign ? (
                        <Select className="ward-owner" label={`Owner for ${bed.bed}: ${x.label}`} value={owners.get(x.id) ?? ""} disabled={assign.isPending}
                          onChange={e => assign.mutate({ blockerId: x.id, owner: e.target.value as Owner })}>
                          <option value="" disabled>Assign owner</option>
                          {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
                        </Select>
                      ) : <span className="ward-muted">Owner: {owners.get(x.id) ?? "none yet"}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {assign.error ? <p className="ward-error" role="alert">Could not assign the owner: {assign.error.message}</p> : null}
              {assigned ? <p className="ward-done" role="status"><Chip tone="done" icon="check">Owner assigned</Chip> {assigned} now has it as a task.</p> : null}
              {nextBed ? <Button variant="secondary" size="sm" icon="arrow-right" onClick={() => setPicked(nextBed.bed)}>Next: {nextBed.bed}, {unownedOn(nextBed, owners)} without an owner</Button> : null}
            </Card>
          ) : null}
          {brief?.lines?.[0] ? (
            <InsightCard label={sample ? "Sona AI · sample brief" : "Sona AI"} title="Huddle brief" lead={brief.lines[0]} sources={blocked.length + (forecast.data?.timeline.length ?? 0)}
              evidence={brief.lines.slice(1).map(text => ({ icon: "bed" as const, text }))}
              next={blocked.length ? { label: "Show blocked beds", onAct: () => setTab("blocked") } : undefined} />
          ) : null}
          <Card title="Beds expected free, by hour">
            {points.length > 0 ? <BarChart points={points} label="Beds expected free, by hour" unit="beds" height={140} /> : <p className="ward-muted">{forecast.isPending ? "Loading the forecast…" : forecast.error ? `No forecast: ${forecast.error.message}` : "No bed is forecast to free up."}</p>}
            {forecast.data?.unlock ? <p className="ward-muted">Biggest unlock: {forecast.data.unlock.line}</p> : null}
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
                <TableToolbar end={<SearchField className="ward-search" label="Search bed, patient or blocker" placeholder="Search beds" value={search} onChange={e => setSearch(e.target.value)} />}>
                  <Tabs label="Beds by state" value={tab} onChange={setTab} tabs={[
                    { id: "all", label: "All", count: all.length }, { id: "blocked", label: "Blocked", count: blocked.length },
                    { id: "unowned", label: "No owner", count: noOwner.length },
                    { id: "watch", label: "Watch", count: groups.watch.length }, { id: "free", label: "Free", count: groups.free.length },
                  ]} />
                </TableToolbar>
              )}
              rowAction={b => <RowAction onClick={() => setPicked(b.bed)}>{b.blockers.length ? "Review" : "Open"}</RowAction>} />
          )}
        </Loaded>
      </WithRail>
    </>
  );
}

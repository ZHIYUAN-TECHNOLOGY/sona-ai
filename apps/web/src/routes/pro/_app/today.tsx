import { can } from "@sona-ai/api/roles";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { type Column, DataTable, PersonCell, RowAction, TableToolbar } from "@/components/data-table";
import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Chip, ListCard, ListRow, SearchField, Signal, StatCard, StatRow, Status, Tabs } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { BookingRequests } from "@/features/today/booking-requests";
import { dateKey, hourOf, longLabel, timeOf } from "@/features/today/time";
import { countOf, formatNumber } from "@/lib/format";
import { type client, orpc } from "@/lib/orpc";
import "@/styles/pages/today.css";

export const Route = createFileRoute("/pro/_app/today")({ component: Page });

type Visit = Awaited<ReturnType<typeof client.day.list>>[number];

/** The rail names this many incomplete records; the rest are one tap away in the table's Incomplete tab. */
const RAIL_CAP = 5;

type Filter = "all" | "upcoming" | "earlier" | "incomplete";

function Page() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const { me } = Route.useRouteContext();
  const navigate = useNavigate();
  const today = dateKey(new Date());
  const seesRequests = can(me.role, "bookings.list");

  // Independent reads, all started at once.
  const day = useQuery(orpc.day.list.queryOptions({ input: { date: today } }));
  const patients = useQuery(orpc.patients.list.queryOptions());
  const tasks = useQuery(orpc.tasks.list.queryOptions());
  const requests = useQuery(orpc.bookings.list.queryOptions({ enabled: seesRequests }));

  const visits = day.data ?? [];
  const now = Date.now();
  const next = visits.find(v => new Date(v.startsAt).getTime() >= now);
  const incomplete = visits.filter(v => v.incomplete);
  // What the doctor should open first: an incomplete record still to come, then the next visit, then an incomplete record already started.
  const first = incomplete.find(v => new Date(v.startsAt).getTime() >= now) ?? next ?? incomplete[0];
  const others = incomplete.filter(v => v.id !== first?.id);
  const waiting = requests.data ?? [];
  const openTasks = tasks.data?.filter(t => !t.completed).length;

  // `day.list` carries no encounter, so the patient list supplies the one to open.
  const encounters = new Map(patients.data?.map(p => [p.id, p.encounterId]));
  const encounterOf = (v: Visit) => encounters.get(v.patientId) || undefined;
  const open = (v: Visit) => {
    const encounterId = encounterOf(v);
    if (encounterId) void navigate({ to: "/pro/visit", search: { encounterId } as never });
  };

  const at = (v: Visit) => new Date(v.startsAt).getTime();
  const upcoming = visits.filter(v => at(v) >= now);
  const earlier = visits.filter(v => at(v) < now);
  const shown = (filter === "upcoming" ? upcoming : filter === "earlier" ? earlier : filter === "incomplete" ? incomplete : visits)
    .filter(v => `${v.patientName} ${v.kind}`.toLowerCase().includes(query.trim().toLowerCase()));
  const hour = hourOf(new Date());
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const time = (v: Visit) => timeOf(new Date(v.startsAt));
  const pick = (to: Filter) => setFilter(to);
  const toggle = (to: Filter) => pick(filter === to ? "all" : to);
  const alsoIncomplete = others.slice(0, RAIL_CAP).map(v => v.patientName).join(", ") + (others.length > RAIL_CAP ? ` and ${countOf(others.length - RAIL_CAP, "other")}` : "");
  const calm = day.data && !incomplete.length && (!seesRequests || (requests.data && !waiting.length));

  const columns: Column<Visit>[] = [
    { key: "time", header: "Time", cell: v => <span className="today-time">{time(v)}</span> },
    { key: "patient", header: "Patient", minWidth: "13rem", cell: v => <PersonCell name={v.patientName} detail={v.kind} /> },
    {
      key: "status", header: "Status", cell: v =>
        v.incomplete ? <Chip tone="soon">Record incomplete</Chip>
          : v.id === next?.id ? <Chip tone="info">Next</Chip>
            : at(v) < now ? <Status tone="done">Earlier</Status> : <Status tone="info">Later</Status>,
    },
  ];

  return (
    <>
      <PageHeader
        title={`${greeting}, ${me.name}`}
        lead={
          <>
            {longLabel(today)} · {day.data ? countOf(visits.length, "visit") : "loading visits"}{next ? ` · next at ${time(next)}` : ""}
            {incomplete.length ? <> · <Signal tone="soon">{countOf(incomplete.length, "record")} incomplete</Signal></> : null}
            {waiting.length ? <> · <Signal tone="soon">{countOf(waiting.length, "booking request")} waiting</Signal></> : null}
            {calm ? <> · <Signal tone="done">nothing needs you</Signal></> : null}
          </>
        }
        actions={
          <>
            <Button variant="secondary" to="/pro/schedule">Week view</Button>
            {first && encounterOf(next ?? first) ? <Button variant="primary" onClick={() => open(next ?? first)}>{next ? "Open next visit" : "Finish the record"}</Button> : null}
          </>
        }
      />

      <StatRow>
        <StatCard
          feature
          title="Visits started"
          value={day.data ? earlier.length : "–"}
          progress={visits.length ? earlier.length / visits.length : 0}
          caption={!day.data ? "Loading" : !visits.length ? "No visits booked today" : `of ${formatNumber(visits.length)} today · ${upcoming.length ? `${formatNumber(upcoming.length)} still to come` : "none left"}`}
          onSelect={() => toggle("earlier")}
          selected={filter === "earlier"}
        />
        <StatCard
          title="Records incomplete"
          value={day.data ? incomplete.length : "–"}
          chip={incomplete.length ? "Needs you" : undefined}
          tone="soon"
          caption={incomplete.length ? "Among today's patients" : "Every record is complete"}
          onSelect={() => toggle("incomplete")}
          selected={filter === "incomplete"}
        />
        {seesRequests ? (
          <StatCard
            title="Booking requests"
            value={requests.data ? waiting.length : "–"}
            chip={waiting.length ? "Waiting" : undefined}
            tone="soon"
            caption={waiting.length ? "Answer them in the side list" : "None waiting"}
          />
        ) : null}
        <StatCard
          title="Open tasks"
          value={openTasks ?? "–"}
          caption={openTasks ? "Across the hospital" : "None open"}
          action={{ label: "Go to tasks", to: "/pro/tasks" }}
        />
      </StatRow>

      <WithRail first="rail"
        rail={
          <RightRail label="Next steps">
            {day.data ? (
              <InsightCard
                label="Sona AI"
                meta={!first ? "All clear" : first.incomplete ? "Needs you" : "Next patient"}
                title={first ? first.patientName : "Today"}
                tone={first?.incomplete ? "soon" : first ? "info" : "done"}
                lead={!visits.length ? "No visits are booked today."
                  : !first ? "Every visit booked for today has started and every record is complete."
                    : !first.incomplete ? `Next is ${first.patientName} at ${time(first)}, ${first.kind}.`
                      : at(first) < now ? `${first.patientName}'s ${time(first)} visit has started and their record is still incomplete.`
                        : `Start with ${first.patientName} at ${time(first)}: their record is incomplete.`}
                evidence={others.length ? [{ text: `Also incomplete today: ${alsoIncomplete}` }] : undefined}
                next={first && encounterOf(first) ? { label: "Open the visit", onAct: () => open(first) } : undefined}
                sources={visits.length}
              />
            ) : null}
            <ListCard title="Needs you">
              {incomplete.slice(0, RAIL_CAP).map(v => (
                <ListRow key={v.id} avatar={v.patientName} title={v.patientName} caption={`Record incomplete · ${time(v)}`} onClick={encounterOf(v) ? () => open(v) : undefined} />
              ))}
              {incomplete.length > RAIL_CAP ? (
                <li className="today-pad"><Button size="sm" onClick={() => pick("incomplete")}>All {countOf(incomplete.length, "incomplete record")} in the table</Button></li>
              ) : null}
              {/* A ListCard is a <ul>: everything after the record rows sits in one <li>. */}
              <li>{!seesRequests ? <p className="today-quiet today-pad">Your role does not see booking requests. The care team answers them.</p>
                : requests.isPending ? <p className="today-quiet today-pad">Loading requests…</p>
                  : requests.isError ? <p className="today-error today-pad" role="alert">Booking requests could not be loaded. {requests.error.message}</p>
                    : calm ? <EmptyState icon="check" title="Nothing needs you today">Incomplete records and booking requests appear here.</EmptyState>
                      : <BookingRequests requests={waiting} canDecide={can(me.role, "bookings.decide")} />}</li>
            </ListCard>
          </RightRail>
        }
      >
        <Card title="Today's schedule">
          {day.isError ? <EmptyState>Today's visits could not be loaded. {day.error.message}</EmptyState>
            : (
              <DataTable
                loading={day.isPending}
                toolbar={
                  <TableToolbar end={<SearchField label="Search today's visits" placeholder="Search visits" value={query} onChange={e => setQuery(e.target.value)} />}>
                    <Tabs<Filter>
                      label="Filter visits"
                      value={filter}
                      onChange={pick}
                      tabs={[
                        { id: "all", label: "All", count: visits.length },
                        { id: "upcoming", label: "Upcoming", count: upcoming.length },
                        { id: "earlier", label: "Earlier", count: earlier.length },
                        { id: "incomplete", label: "Incomplete", count: incomplete.length },
                      ]}
                    />
                  </TableToolbar>
                }
                columns={columns}
                rows={shown}
                pageSize={50}
                noun={["visit", "visits"]}
                rowKey={v => v.id}
                selectedKey={next?.id}
                onRowOpen={open}
                rowAction={v => encounterOf(v) ? <RowAction onClick={() => open(v)}>{v.id === next?.id ? "Start" : "Open"}</RowAction> : null}
                empty={visits.length ? "No visits match." : "No visits are booked today."}
              />
            )}
        </Card>
      </WithRail>
    </>
  );
}

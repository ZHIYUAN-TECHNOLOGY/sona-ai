import { can } from "@sona-ai/api/roles";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { type Column, DataTable, PersonCell, RowAction } from "@/components/data-table";
import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Chip, ListCard, ListRow, SearchField, StatCard, StatRow, Tabs } from "@/components/primitives";
import { WithRail } from "@/components/rail";
import { BookingRequests } from "@/features/today/booking-requests";
import { dateKey, hourOf, longLabel, timeOf } from "@/features/today/time";
import { type client, orpc } from "@/lib/orpc";
import "@/styles/pages/today.css";

export const Route = createFileRoute("/pro/_app/today")({ component: Page });

type Visit = Awaited<ReturnType<typeof client.day.list>>[number];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
  const first = incomplete.find(v => new Date(v.startsAt).getTime() >= now) ?? next;
  const waiting = requests.data ?? [];
  const openTasks = tasks.data?.filter(t => !t.completed).length;

  // `day.list` carries no encounter, so the patient list supplies the one to open.
  const encounterOf = (v: Visit) => patients.data?.find(p => p.id === v.patientId)?.encounterId || undefined;
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

  const columns: Column<Visit>[] = [
    { key: "time", header: "Time", cell: v => <span className="today-time">{time(v)}</span> },
    { key: "patient", header: "Patient", cell: v => <PersonCell name={v.patientName} detail={v.kind} /> },
    {
      key: "status", header: "Status", cell: v =>
        v.incomplete ? <Chip tone="soon">Record incomplete</Chip>
          : v.id === next?.id ? <Chip tone="info">Next</Chip>
            : <span className="today-quiet">{at(v) < now ? "Earlier" : "Later"}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title={`${greeting}, ${me.name}`}
        lead={`${longLabel(today)} · ${day.data ? plural(visits.length, "visit") : "loading visits"}${next ? ` · next at ${time(next)}` : ""}`}
        actions={
          <>
            <Button variant="secondary" to="/pro/schedule">Week view</Button>
            {next && encounterOf(next) ? <Button variant="primary" onClick={() => open(next)}>Open next visit</Button> : null}
          </>
        }
      />

      <StatRow>
        <StatCard
          feature
          title="Visits started"
          value={day.data ? earlier.length : "–"}
          unit={day.data ? `of ${visits.length}` : undefined}
          progress={visits.length ? earlier.length / visits.length : 0}
          caption={day.data ? (upcoming.length ? `${upcoming.length} still to come` : "None left today") : "Loading"}
        />
        <StatCard
          title="Records incomplete"
          value={day.data ? incomplete.length : "–"}
          chip={incomplete.length ? "Before the visit" : undefined}
          tone="soon"
          caption={incomplete.length ? "Among today's patients" : "Every record is complete"}
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

      <WithRail
        rail={
          <>
            {day.data ? (
              <InsightCard
                label="Sona AI"
                meta="Next patient"
                title={first ? first.patientName : "Today"}
                tone={first?.incomplete ? "soon" : first ? "info" : "done"}
                lead={!visits.length ? "No visits are booked today."
                  : !first ? "Every visit booked for today has started."
                    : first.incomplete ? `Start with ${first.patientName} at ${time(first)}: their record is incomplete.`
                      : `Next is ${first.patientName} at ${time(first)}, ${first.kind}.`}
                evidence={incomplete.length ? [{ text: `${plural(incomplete.length, "record")} incomplete today: ${incomplete.map(v => v.patientName).join(", ")}` }] : undefined}
                next={first && encounterOf(first) ? { label: "Open the visit", onAct: () => open(first) } : undefined}
                sources={visits.length}
              />
            ) : null}
            <ListCard title="Needs you">
              {incomplete.map(v => (
                <ListRow key={v.id} avatar={v.patientName} title={v.patientName} caption={`Record incomplete · ${time(v)}`} onClick={encounterOf(v) ? () => open(v) : undefined} />
              ))}
              {!seesRequests ? <p className="today-quiet today-pad">Your role does not see booking requests. The care team answers them.</p>
                : requests.isPending ? <p className="today-quiet today-pad">Loading requests…</p>
                  : requests.isError ? <p className="today-error today-pad" role="alert">Booking requests could not be loaded. {requests.error.message}</p>
                    : <BookingRequests requests={waiting} canDecide={can(me.role, "bookings.decide")} />}
            </ListCard>
          </>
        }
      >
        <Card title="Today's schedule">
          {day.isError ? <EmptyState>Today's visits could not be loaded. {day.error.message}</EmptyState>
            : (
              <DataTable
                loading={day.isPending}
                toolbar={
                  <>
                    <Tabs<Filter>
                      label="Filter visits"
                      value={filter}
                      onChange={setFilter}
                      tabs={[
                        { id: "all", label: "All", count: visits.length },
                        { id: "upcoming", label: "Upcoming", count: upcoming.length },
                        { id: "earlier", label: "Earlier", count: earlier.length },
                        { id: "incomplete", label: "Incomplete", count: incomplete.length },
                      ]}
                    />
                    <SearchField label="Search today's visits" placeholder="Search patient or reason" value={query} onChange={e => setQuery(e.target.value)} />
                  </>
                }
                columns={columns}
                rows={shown}
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

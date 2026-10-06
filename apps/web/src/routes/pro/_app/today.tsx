import { can } from "@sona-ai/api/roles";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { type Column, DataTable } from "@/components/data-table";
import { InsightCard, InsightRow } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Avatar, Chip } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { BookingRequests } from "@/features/today/booking-requests";
import { dateKey, longLabel, timeOf } from "@/features/today/time";
import { type client, orpc } from "@/lib/orpc";
import "@/styles/pages/today.css";

export const Route = createFileRoute("/pro/_app/today")({ component: Page });

type Visit = Awaited<ReturnType<typeof client.day.list>>[number];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Page() {
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

  const columns: Column<Visit>[] = [
    { key: "time", header: "Time", cell: v => <span className="today-time">{timeOf(new Date(v.startsAt))}</span> },
    { key: "patient", header: "Patient", cell: v => <span className="today-patient"><Avatar name={v.patientName} />{v.patientName}</span> },
    { key: "reason", header: "Reason", cell: v => v.kind },
    {
      key: "status", header: "Status", cell: v =>
        v.incomplete ? <Chip tone="soon">Record incomplete</Chip>
          : v.id === next?.id ? <Chip tone="info">Next</Chip>
            : new Date(v.startsAt).getTime() < now ? <Chip>Earlier</Chip> : <Chip>Later</Chip>,
    },
  ];

  return (
    <>
      <PageHeader title="Today" lead={`${longLabel(today)} · ${day.data ? plural(visits.length, "visit") : "loading visits"}`} />

      <InsightRow>
        {day.data ? (
          <InsightCard
            tone={first?.incomplete ? "soon" : first ? "info" : "done"}
            lead={!visits.length ? "No visits are booked today."
              : !first ? "Every visit booked for today has started."
                : first.incomplete ? `Start with ${first.patientName} at ${timeOf(new Date(first.startsAt))}: their record is incomplete.`
                  : `Next is ${first.patientName} at ${timeOf(new Date(first.startsAt))}, ${first.kind}.`}
            next={first && encounterOf(first) ? { label: "Open the visit", onAct: () => open(first) } : undefined}
            sources={visits.length}
          >
            {incomplete.length ? <p>{plural(incomplete.length, "patient")} today {incomplete.length === 1 ? "has" : "have"} an incomplete record: {incomplete.map(v => v.patientName).join(", ")}.</p> : null}
          </InsightCard>
        ) : null}
        {seesRequests && requests.data ? (
          <InsightCard
            tone={waiting.length ? "soon" : "done"}
            lead={waiting.length
              ? `${plural(waiting.length, "booking request")} ${waiting.length === 1 ? "is" : "are"} waiting, the oldest from ${waiting.reduce((a, b) => (new Date(a.createdAt) <= new Date(b.createdAt) ? a : b)).patientName}.`
              : "No booking requests are waiting."}
            next={waiting.length ? { label: "Answer them here", onAct: () => document.getElementById("today-requests")?.scrollIntoView({ behavior: "smooth" }) } : undefined}
            sources={waiting.length}
          />
        ) : null}
        {openTasks !== undefined ? (
          <InsightCard
            tone={openTasks ? "info" : "done"}
            lead={openTasks ? `${plural(openTasks, "task")} ${openTasks === 1 ? "is" : "are"} open across the hospital.` : "No tasks are open."}
            next={openTasks ? { label: "Go to tasks", to: "/pro/tasks" } : undefined}
            sources={openTasks}
          />
        ) : null}
      </InsightRow>

      <WithRail
        rail={
          <RightRail label="Booking requests">
            <div id="today-requests">
              {!seesRequests ? <p className="today-quiet">Your role does not see booking requests. The care team answers them.</p>
                : requests.isPending ? <p className="today-quiet">Loading requests…</p>
                  : requests.isError ? <p className="today-error" role="alert">Booking requests could not be loaded. {requests.error.message}</p>
                    : <BookingRequests requests={waiting} canDecide={can(me.role, "bookings.decide")} />}
            </div>
          </RightRail>
        }
      >
        {day.isPending ? <EmptyState>Loading today's visits…</EmptyState>
          : day.isError ? <EmptyState>Today's visits could not be loaded. {day.error.message}</EmptyState>
            : (
              <DataTable
                columns={columns}
                rows={visits}
                rowKey={v => v.id}
                onRowOpen={open}
                empty="No visits are booked today."
              />
            )}
      </WithRail>
    </>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { DataTable, type Column, PersonCell, RowAction } from "@/components/data-table";
import type { IconName } from "@/components/icon";
import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Card, Chip, Pager, pageRange, SearchField, Skeleton, StatCard, StatRow, Tabs } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { type client, orpc } from "@/lib/orpc";

import { filterPatients } from "./search";

export type PatientRow = Awaited<ReturnType<typeof client.patients.list>>[number];

/** The ward's own word for the bed when admitted; otherwise whether the record is complete. */
export function StatusChip({ patient }: { patient: PatientRow }) {
  const status = patient.ward?.status;
  if (status === "fit") return <Chip tone="done">Fit to go</Chip>;
  if (status === "watch") return <Chip tone="soon">Watch</Chip>;
  if (status === "stable") return <Chip>Stable</Chip>;
  if (patient.incomplete) return <Chip tone="soon">Record incomplete</Chip>;
  return <Chip>Not on a ward</Chip>;
}

export const PATIENT_TABS = ["all", "ward", "watch", "fit", "incomplete"] as const;
export type PatientTab = (typeof PATIENT_TABS)[number];

const inTab: Record<PatientTab, (p: PatientRow) => boolean> = {
  all: () => true,
  ward: (p) => !!p.ward,
  watch: (p) => p.ward?.status === "watch",
  fit: (p) => p.ward?.status === "fit",
  incomplete: (p) => !!p.incomplete,
};
const TAB_LABEL: Record<PatientTab, string> = { all: "All", ward: "On a ward", watch: "Watch", fit: "Fit to go", incomplete: "Incomplete" };

/** In the list a chip means "look here"; calm states are quiet text. */
function ListStatus({ patient }: { patient: PatientRow }) {
  const status = patient.ward?.status;
  if (status === "watch" || status === "fit" || (!status && patient.incomplete)) return <StatusChip patient={patient} />;
  return <span className="ptl-calm">{status === "stable" ? "Stable" : "Not on a ward"}</span>;
}

const statusRank = (p: PatientRow) => ["watch", "fit", "stable"].indexOf(p.ward?.status ?? "") + (p.ward ? 0 : p.incomplete ? 3 : 5);
const PAGE_SIZE = 10;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

const columns: Column<PatientRow>[] = [
  { key: "name", header: "Patient", cell: (p) => <PersonCell name={p.name} detail={`${p.sex.charAt(0).toUpperCase()}, ${p.age}`} />, sort: (a, b) => a.name.localeCompare(b.name) },
  { key: "reason", header: "Reason", cell: (p) => <span className="ptl-reason" title={p.complaint}>{p.complaint}</span>, sort: (a, b) => (a.complaint ?? "").localeCompare(b.complaint ?? "") },
  { key: "place", header: "Ward or clinic", cell: (p) => p.subtitle || <span className="ptl-calm">None</span>, sort: (a, b) => (a.subtitle ?? "").localeCompare(b.subtitle ?? "") },
  { key: "status", header: "Status", cell: (p) => <ListStatus patient={p} />, sort: (a, b) => statusRank(a) - statusRank(b) },
];

type Fact = { icon: IconName; text: string };

/** The one patient to look at first, from facts already in the list: on watch, else fit and waiting longest, else an incomplete record. */
export function firstToSee(rows: PatientRow[]) {
  const watch = rows.filter(inTab.watch);
  const fit = rows.filter(inTab.fit).sort((a, b) => (b.ward?.waitingHours ?? 0) - (a.ward?.waitingHours ?? 0));
  const incomplete = rows.filter(inTab.incomplete);
  const patient = watch[0] ?? fit[0] ?? incomplete[0];
  if (!patient) return undefined;
  const sbar = patient.ward?.sbar;
  const place: Fact[] = patient.subtitle ? [{ icon: "clipboard", text: patient.subtitle }] : [];
  const others = (n: number, text: string): Fact[] => (n > 1 ? [{ icon: "users", text: `${plural(n - 1, "other patient")} ${text}` }] : []);
  if (watch.length) {
    return {
      patient, tone: "soon" as const, label: "On watch", title: `See ${patient.name} first`,
      lead: sbar?.a ?? patient.complaint ?? "Marked watch by the ward.",
      evidence: [...place, ...(sbar?.s ? [{ icon: "activity", text: sbar.s } as Fact] : []), ...others(watch.length, "on watch")],
      step: sbar?.r ?? "Review the overview",
    };
  }
  if (fit.length) {
    const hours = patient.ward?.waitingHours;
    return {
      patient, tone: "info" as const, label: "Fit to go", title: `${patient.name} is fit to go`,
      lead: sbar?.a ?? patient.complaint ?? "The ward marks this patient fit for discharge.",
      evidence: [...place, ...(hours ? [{ icon: "clock", text: `Waiting ${plural(hours, "hour")}` } as Fact] : []), ...others(fit.length, "fit to go")],
      step: sbar?.r ?? "Review before discharge",
    };
  }
  return {
    patient, tone: "soon" as const, label: "Record", title: `${patient.name}'s record is incomplete`,
    lead: "Details are missing from this record.",
    evidence: [...place, ...others(incomplete.length, "with an incomplete record")],
    step: "Complete the record",
  };
}

export function PatientList({ tab, onTab }: { tab: PatientTab; onTab: (tab: PatientTab) => void }) {
  const { data, isPending, error } = useQuery(orpc.patients.list.queryOptions());
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const open = (p: PatientRow) => navigate({ to: "/pro/patients/$patientId", params: { patientId: p.id } });

  if (error) {
    return (
      <>
        <PageHeader title="Patients" lead="Everyone registered at this hospital." />
        <Card><EmptyState icon="alert" title="The patient list could not be loaded">{error.message}</EmptyState></Card>
      </>
    );
  }

  const all = data ?? [];
  const count = (t: PatientTab) => all.filter(inTab[t]).length;
  const stat = (t: PatientTab) => (isPending ? <Skeleton width={56} height={40} /> : count(t));
  const rows = filterPatients(all.filter(inTab[tab]), query);
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / PAGE_SIZE)));
  const [from, to] = pageRange(current, PAGE_SIZE, rows.length);
  const insight = firstToSee(all);
  const lead = isPending
    ? "Everyone registered at this hospital."
    : `${plural(all.length, "patient")} at this hospital · ${count("ward")} on a ward · ${count("watch")} on watch`;

  const table = (
    <Card className="ptl-card">
      <DataTable
        columns={columns}
        rows={rows.slice(from - 1, to)}
        rowKey={(p) => p.id}
        loading={isPending && PAGE_SIZE}
        onRowOpen={open}
        rowAction={(p) => <RowAction onClick={() => open(p)}>Open</RowAction>}
        empty={
          all.length ? (
            <EmptyState icon="search" title="No patient matches">
              {query ? `Nothing matches "${query}" in ${TAB_LABEL[tab]}.` : `No patient is in ${TAB_LABEL[tab]} right now.`}
            </EmptyState>
          ) : (
            <EmptyState icon="users" title="No patients yet">No patients are registered at this hospital yet.</EmptyState>
          )
        }
        toolbar={
          <>
            <Tabs
              label="Filter patients"
              tabs={PATIENT_TABS.map((id) => ({ id, label: TAB_LABEL[id], count: isPending ? undefined : count(id) }))}
              value={tab}
              onChange={(next) => { setPage(1); onTab(next); }}
            />
            <SearchField className="ptl-search" label="Search patients" placeholder="Name or ID" value={query} onChange={(e) => { setPage(1); setQuery(e.target.value); }} />
          </>
        }
        count={isPending ? <Skeleton width={140} /> : rows.length ? `Showing ${from}-${to} of ${rows.length}` : "None shown"}
        footer={<Pager page={current} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} noun="patients" />}
      />
    </Card>
  );

  return (
    <>
      <PageHeader title="Patients" lead={lead} />
      <StatRow>
        <StatCard title="Patients" value={stat("all")} caption="Registered at this hospital" />
        <StatCard title="On a ward" value={stat("ward")} caption={`${count("fit")} fit to go`} action={{ to: "/pro/patients", search: { tab: "ward" }, label: "Show patients on a ward" }} />
        <StatCard title="On watch" value={stat("watch")} chip={count("watch") ? "Needs a look" : undefined} tone="soon" caption="Marked watch by the ward" action={{ to: "/pro/patients", search: { tab: "watch" }, label: "Show patients on watch" }} />
        <StatCard title="Record incomplete" value={stat("incomplete")} chip={count("incomplete") ? "To complete" : undefined} tone="soon" caption="Details missing" action={{ to: "/pro/patients", search: { tab: "incomplete" }, label: "Show incomplete records" }} />
      </StatRow>
      {insight ? (
        <WithRail
          rail={
            <RightRail label="Who to see first">
              <InsightCard label={insight.label} title={insight.title} lead={insight.lead} tone={insight.tone} evidence={insight.evidence}
                next={{ label: "Open", step: insight.step, onAct: () => open(insight.patient) }} />
            </RightRail>
          }
        >
          {table}
        </WithRail>
      ) : table}
    </>
  );
}

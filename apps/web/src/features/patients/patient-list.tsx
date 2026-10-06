import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/page";
import { Avatar, Chip, Field } from "@/components/primitives";
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

const statusRank = (p: PatientRow) => ["watch", "fit", "stable"].indexOf(p.ward?.status ?? "") + (p.ward ? 0 : 4);

const columns: Column<PatientRow>[] = [
  {
    key: "name",
    header: "Name",
    cell: (p) => (
      <span className="pt-name">
        <Avatar name={p.name} />
        <span>
          {p.name}
          <small>{p.complaint}</small>
        </span>
      </span>
    ),
    sort: (a, b) => a.name.localeCompare(b.name),
  },
  { key: "age", header: "Age / sex", cell: (p) => `${p.age} · ${p.sex}`, sort: (a, b) => a.age - b.age },
  { key: "place", header: "Ward or clinic", cell: (p) => p.subtitle, sort: (a, b) => (a.subtitle ?? "").localeCompare(b.subtitle ?? "") },
  { key: "status", header: "Status", cell: (p) => <StatusChip patient={p} />, sort: (a, b) => statusRank(a) - statusRank(b) },
];

export function PatientList() {
  const { data, isPending, error } = useQuery(orpc.patients.list.queryOptions());
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  if (isPending) return <EmptyState>Loading patients…</EmptyState>;
  if (error) return <EmptyState>The patient list could not be loaded: {error.message}</EmptyState>;
  if (!data.length) return <EmptyState>No patients are registered at this hospital yet.</EmptyState>;

  const rows = filterPatients(data, query);
  return (
    <>
      <div className="pt-search">
        <Field label="Search patients" hint={`${rows.length} of ${data.length} shown`}>
          {(c) => <input {...c} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, ID, ward or complaint" />}
        </Field>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        onRowOpen={(p) => navigate({ to: "/pro/patients/$patientId", params: { patientId: p.id } })}
        empty={`No patient matches "${query}".`}
      />
    </>
  );
}

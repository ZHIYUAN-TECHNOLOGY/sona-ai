import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { EmptyState } from "@/components/page";
import { Card, Chip, ListRow, SearchField, Skeleton } from "@/components/primitives";
import "@/styles/pages/discharge-plan.css";
import { orpc } from "@/lib/orpc";

/** The optional `?encounterId=` (or any one string key) every page here takes. */
export const oneParam = <K extends string>(key: K) => (search: Record<string, unknown>) =>
  ({ [key]: typeof search[key] === "string" && search[key] ? search[key] : undefined }) as { [P in K]?: string };

/** A server refusal in its own plain words. */
export const say = (error: unknown) => (error instanceof Error && error.message ? error.message : "Something went wrong. Try again.");

/** The blocked checks a refusal carries (`discharge.request`, `claim.send`), when it carries any. */
export function blockersOf(error: unknown): { label: string; detail?: string }[] {
  const data = (error as { data?: { blockers?: unknown; open?: unknown } } | null)?.data;
  // A discharge refusal lists blockers; a claim refusal lists the open criteria by name.
  if (Array.isArray(data?.blockers)) return data.blockers.filter((b): b is { label: string; detail?: string } => typeof b?.label === "string");
  return Array.isArray(data?.open) ? data.open.filter((o): o is string => typeof o === "string").map(label => ({ label })) : [];
}

/** Model answers the server labels as a fixture are shown as a sample, as the phone app does. */
export function Origin({ source }: { source?: string }) {
  return source === "model" ? <Chip tone="info">Drafted by Sona</Chip> : <Chip>Sample draft</Chip>;
}

/** Loading, refused and empty in plain words around a query's data. */
export function Loaded<T>({ query, empty, children }: { query: { data?: T; error: unknown; isPending: boolean }; empty?: string; children: (data: T) => ReactNode }) {
  if (query.isPending) return <div className="dp-skel" aria-busy="true" aria-label="Loading"><Skeleton width="40%" height={20} /><Skeleton /><Skeleton width="80%" /></div>;
  if (query.error) return <EmptyState icon="alert" title="This did not load">{say(query.error)}</EmptyState>;
  if (query.data === undefined || (Array.isArray(query.data) && !query.data.length)) return <EmptyState>{empty ?? "Nothing here yet."}</EmptyState>;
  return <>{children(query.data)}</>;
}

/** The patient a visit belongs to, from the patients list the picker already loads. */
export function usePatient(encounterId: string) {
  return useQuery(orpc.patients.list.queryOptions()).data?.find(p => p.encounterId === encounterId);
}

/** No visit chosen yet: the hospital's patients, searchable by name. Each row is the link `link` returns, stretched over the row. */
export function PatientPicker({ link, lead }: { link: (p: { id: string; encounterId: string }) => ReactNode; lead?: string }) {
  const patients = useQuery(orpc.patients.list.queryOptions());
  const [q, setQ] = useState("");
  return (
    <Loaded query={patients} empty="No patients to show.">
      {rows => {
        const shown = rows.filter(p => p.name.toLowerCase().includes(q.trim().toLowerCase()));
        return (
          <Card title="Patients" className="list-card dp-pick">
            <div className="dp-pick-head">
              <SearchField label="Search patients by name" placeholder="Search by name" value={q} onChange={e => setQ(e.target.value)} />
              {lead ? <p>{lead}</p> : null}
            </div>
            <ul className="list">
              {shown.map(p => <ListRow key={p.encounterId} avatar={p.name} title={p.name} caption={p.subtitle} trailing={link(p)} />)}
              {shown.length ? null : <li className="dp-note dp-pick-none">No patient is named “{q.trim()}”.</li>}
            </ul>
          </Card>
        );
      }}
    </Loaded>
  );
}

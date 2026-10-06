import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/page";
import { Chip, ListCard, ListRow, Skeleton } from "@/components/primitives";
import "@/styles/pages/discharge-plan.css";
import { orpc } from "@/lib/orpc";

/** The optional `?encounterId=` (or any one string key) every page here takes. */
export const oneParam = <K extends string>(key: K) => (search: Record<string, unknown>) =>
  ({ [key]: typeof search[key] === "string" && search[key] ? search[key] : undefined }) as { [P in K]?: string };

/** A server refusal in its own plain words. */
export const say = (error: unknown) => (error instanceof Error && error.message ? error.message : "Something went wrong. Try again.");

/** The blocked checks a refusal carries (`discharge.request`, `claim.send`), when it carries any. */
export function blockersOf(error: unknown): { label: string; detail?: string }[] {
  const list = (error as { data?: { blockers?: unknown } } | null)?.data?.blockers;
  return Array.isArray(list) ? list.filter((b): b is { label: string; detail?: string } => typeof b?.label === "string") : [];
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

/** No visit chosen yet: the hospital's patients, each a link back to this page with its visit (or patient) id. */
export function PatientPicker({ link, lead }: { link: (p: { id: string; encounterId: string }) => ReactNode; lead: string }) {
  const patients = useQuery(orpc.patients.list.queryOptions());
  return (
    <Loaded query={patients} empty="No patients to show.">
      {rows => (
        <>
          <p className="dp-note dp-pick-lead">{lead}</p>
          <ListCard title="Patients">
            {rows.map(p => (
              <ListRow key={p.encounterId} avatar={p.name} title={p.name} caption={p.subtitle} trailing={link(p)} />
            ))}
          </ListCard>
        </>
      )}
    </Loaded>
  );
}

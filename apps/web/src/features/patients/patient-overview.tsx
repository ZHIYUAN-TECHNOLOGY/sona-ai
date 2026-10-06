import { can } from "@sona-ai/api/roles";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { InsightCard, InsightRow } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Card, Chip } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { orpc } from "@/lib/orpc";

import { type PatientRow, StatusChip } from "./patient-list";

type Role = Parameters<typeof can>[0];

const day = (at: Date | string) => new Date(at).toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric" });
const dayTime = (at: Date | string) => new Date(at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function PatientOverview({ patientId, role }: { patientId: string; role: Role }) {
  // The list is the only patient read the API has; it is already cached when the row was opened from it.
  const { data, isPending, error } = useQuery(orpc.patients.list.queryOptions());
  const patient = data?.find((p) => p.id === patientId);

  if (isPending) return <EmptyState>Loading the patient…</EmptyState>;
  if (error) return <EmptyState>The patient could not be loaded: {error.message}</EmptyState>;
  if (!patient) {
    return (
      <EmptyState>
        No patient with this ID at your hospital. <Link to="/pro/patients">Back to patients</Link>
      </EmptyState>
    );
  }

  const canRead = can(role, "encounter.get");
  return (
    <>
      <PageHeader title={patient.name} lead={`${patient.age} · ${patient.sex} · ${patient.subtitle}`}>
        <StatusChip patient={patient} />
        {canRead && patient.encounterId ? (
          // The visit page reads encounterId from the URL itself.
          <Link to="/pro/visit" search={{ encounterId: patient.encounterId } as never} className="pt-open">
            Open the visit
          </Link>
        ) : null}
      </PageHeader>
      {canRead ? (
        <Clinical patient={patient} />
      ) : (
        <EmptyState>
          Your role can see who is registered, but not clinical detail. The briefing, history, medicines and doses on this page are for doctors, nurses and
          management. Ask the care team if you need something from this record.
        </EmptyState>
      )}
    </>
  );
}

function Clinical({ patient }: { patient: PatientRow }) {
  const encounterId = patient.encounterId;
  const hasVisit = Boolean(encounterId);
  // Three independent reads, started together. The briefing is a model answer: asked once per page, not on refocus.
  const briefing = useQuery({ ...orpc.encounter.briefing.queryOptions({ input: { encounterId } }), enabled: hasVisit, staleTime: Infinity, retry: false });
  const timeline = useQuery({ ...orpc.encounter.timeline.queryOptions({ input: { encounterId } }), enabled: hasVisit });
  const doses = useQuery(orpc.adherence.get.queryOptions({ input: { patientId: patient.id } }));

  const latest = timeline.data?.reduce<NonNullable<typeof timeline.data>[number] | undefined>((a, e) => (!a || new Date(e.at) > new Date(a.at) ? e : a), undefined);
  const events = timeline.data ? [...timeline.data].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()) : [];
  const a = doses.data;
  const sample = briefing.data?.source === "fixture";

  return (
    <>
      <InsightRow>
        <InsightCard
          lead={!hasVisit ? "No visit on record, so there is no briefing yet." : briefing.isPending ? "Sona is reading the record…" : briefing.error ? `No briefing: ${briefing.error.message}` : (briefing.data.lines[0] ?? "The briefing came back empty.")}
          sources={briefing.data ? patient.sources?.length : undefined}
        >
          {sample ? <Chip tone="soon">Sample answer</Chip> : null}
          {briefing.data && briefing.data.lines.length > 1 ? (
            <ul className="pt-lines">
              {briefing.data.lines.slice(1).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </InsightCard>
        <InsightCard
          lead={!hasVisit ? "Nothing dated on record." : timeline.isPending ? "Loading what changed…" : timeline.error ? `What changed could not be loaded: ${timeline.error.message}` : latest ? `Latest: ${latest.title}` : "Nothing dated on record yet."}
          sources={latest ? 1 : undefined}
        >
          {latest ? (
            <p className="pt-muted">
              {day(latest.at)}
              {latest.detail ? ` · ${latest.detail}` : ""}
            </p>
          ) : null}
        </InsightCard>
        <InsightCard
          tone={a?.missed.length ? "urgent" : a?.late.length ? "soon" : a?.due ? "done" : "info"}
          lead={doses.isPending ? "Loading doses…" : doses.error ? `Doses could not be loaded: ${doses.error.message}` : !a?.due ? "No doses due: no discharge medicines are scheduled." : a.missed.length ? `${a.missed.length} missed, ${a.late.length} due now` : a.late.length ? `${a.late.length} due now` : `All ${a.due} doses taken`}
          sources={a?.due ? 1 : undefined}
        >
          {a?.line ? <p className="pt-muted">{a.line}</p> : null}
        </InsightCard>
      </InsightRow>

      <WithRail
        rail={
          <RightRail label="Medicines and doses">
            <Card title="Medicines">
              {patient.allergies ? <Chip tone="urgent">Allergy: {patient.allergies}</Chip> : null}
              <List items={patient.medicines} empty="No medicines on record." />
            </Card>
            {patient.takeHome?.length ? (
              <Card title="Take-home list">
                <ul className="pt-list">
                  {patient.takeHome.map((m) => (
                    <li key={m.name}>
                      {m.name} {m.change !== "unchanged" ? <Chip tone={m.change === "stopped" ? "soon" : "info"}>{m.change}</Chip> : null}
                      <small>{m.detail}</small>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            <Card title="Doses taken">
              {doses.isPending ? (
                <p className="pt-muted">Loading…</p>
              ) : doses.error ? (
                <p className="pt-muted">Could not be loaded: {doses.error.message}</p>
              ) : !a?.due ? (
                <p className="pt-muted">No doses are due. Doses are counted from discharge.</p>
              ) : (
                <>
                  <p>
                    <strong>
                      {a.taken} of {a.due}
                    </strong>{" "}
                    doses taken since discharge
                  </p>
                  <meter className="pt-meter" min={0} max={a.due} value={a.taken} aria-label="Doses taken" />
                  <ul className="pt-list">
                    {a.missed.map((d) => (
                      <li key={`m${d.name}${String(d.dueAt)}`}>
                        {d.name} <Chip tone="urgent">Missed</Chip>
                        <small>Due {dayTime(d.dueAt)}</small>
                      </li>
                    ))}
                    {a.late.map((d) => (
                      <li key={`l${d.name}${String(d.dueAt)}`}>
                        {d.name} <Chip tone="soon">Due now</Chip>
                        <small>Due {dayTime(d.dueAt)}</small>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
            {patient.vitals?.length ? (
              <Card title="Latest readings">
                <dl className="pt-vitals">
                  {patient.vitals.map((v) => (
                    <div key={v.label}>
                      <dt>{v.label}</dt>
                      <dd>{v.value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            ) : null}
          </RightRail>
        }
      >
        <Card title="Timeline">
          {!hasVisit ? (
            <p className="pt-muted">No visit on record.</p>
          ) : timeline.isPending ? (
            <p className="pt-muted">Loading…</p>
          ) : timeline.error ? (
            <p className="pt-muted">Could not be loaded: {timeline.error.message}</p>
          ) : !events.length ? (
            <p className="pt-muted">Nothing dated on record yet.</p>
          ) : (
            <ol className="pt-timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <time>{day(e.at)}</time>
                  <span>
                    {e.title}
                    {e.detail ? <small>{e.detail}</small> : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card title="Presenting complaint">
          <p>{patient.complaint || "Not recorded."}</p>
        </Card>
        <Card title="Medical history">
          <List items={patient.history} empty="None recorded." />
        </Card>
        <Card title="Family history">
          <p>{patient.family || "None recorded."}</p>
        </Card>
        <Card title="Social history">
          <p>{patient.social || "None recorded."}</p>
        </Card>
      </WithRail>
    </>
  );
}

function List({ items, empty }: { items?: string[]; empty: string }) {
  if (!items?.length) return <p className="pt-muted">{empty}</p>;
  return (
    <ul className="pt-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

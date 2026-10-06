import { can } from "@sona-ai/api/roles";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Fragment, type ReactNode, useState } from "react";

import { LineChart } from "@/components/charts";
import type { IconName } from "@/components/icon";
import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader, PatientStrip } from "@/components/page";
import { Button, Card, Chip, ListCard, ListRow, Signal, StatCard, StatRow, Tabs } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { when } from "@/features/results/result-rail";
import { isFlagged } from "@/features/results/triage";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/patient-overview.css";

import { type PatientRow, StatusChip } from "./patient-list";
import { LabCharts, PatientResults, useTrends } from "./patient-trends";
import { chartPoints, direction, latestOf, topSeries } from "./trends";

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

  return <Loaded patient={patient} canRead={can(role, "encounter.get")} />;
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "Timeline" },
  { id: "results", label: "Results" },
  { id: "medicines", label: "Medicines" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function Loaded({ patient, canRead }: { patient: PatientRow; canRead: boolean }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [picked, setPicked] = useState<string>();
  const encounterId = patient.encounterId;
  const hasVisit = canRead && Boolean(encounterId);
  // Independent reads, started together, only for roles that may read clinical detail. The briefing is a model answer: asked once per page, not on refocus.
  const briefing = useQuery({ ...orpc.encounter.briefing.queryOptions({ input: { encounterId } }), enabled: hasVisit, staleTime: Infinity, retry: false });
  const timeline = useQuery({ ...orpc.encounter.timeline.queryOptions({ input: { encounterId } }), enabled: hasVisit });
  const doses = useQuery({ ...orpc.adherence.get.queryOptions({ input: { patientId: patient.id } }), enabled: canRead });
  const trends = useTrends(patient.id, canRead);

  const events = timeline.data ? [...timeline.data].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()) : [];
  const latest = events[0];
  const a = doses.data;
  const top = trends.data ? topSeries(trends.data) : [];
  const charted = trends.data?.filter((s) => s.points.length > 1) ?? [];
  const main = charted.find((s) => s.name === picked) ?? top.find((s) => s.points.length > 1) ?? charted[0];
  const visit = encounterId ? { to: "/pro/visit" as const, search: { encounterId } } : undefined;
  const behind = (a?.missed.length ?? 0) + (a?.late.length ?? 0);

  const evidence: { icon: IconName; text: string }[] = [
    ...(briefing.data?.lines.slice(1, 3).map((text) => ({ icon: "file" as const, text })) ?? []),
    ...(latest ? [{ icon: "clock" as const, text: `Latest: ${latest.title}, ${day(latest.at)}` }] : []),
    ...(a?.due ? [{ icon: "pill" as const, text: a.missed.length ? `${a.missed.length} missed, ${a.late.length} due now of ${a.due} doses` : a.late.length ? `${a.late.length} of ${a.due} doses due now` : `All ${a.due} doses taken` }] : []),
  ];
  // Where this patient stands, in one line: the ward's own assessment (amber on watch, green when fit to go, plain when stable) and any doses behind.
  const sbar = patient.ward?.sbar;
  const status = patient.ward?.status;
  const lead: ReactNode[] = [
    patient.subtitle,
    sbar?.a ? (status === "watch" || status === "fit" ? <Signal tone={status === "watch" ? "soon" : "done"}>{sbar.a}</Signal> : sbar.a) : null,
    behind ? <Signal tone={a?.missed.length ? "urgent" : "soon"}>{behind === 1 ? "1 dose" : `${behind} doses`} behind</Signal> : null,
  ].filter(Boolean);
  const sources = (briefing.data ? (patient.sources?.length ?? 0) : 0) + (latest ? 1 : 0) + (a?.due ? 1 : 0);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Patients", to: "/pro/patients" }, { label: patient.name }]}
        title="Patient overview"
        lead={lead.length ? lead.map((part, i) => <Fragment key={i}>{i ? " · " : null}{part}</Fragment>) : latest ? `Latest record ${day(latest.at)}` : undefined}
        actions={
          canRead ? (
            <>
              {/* With doses behind, the summary's suggested step is the Message button. */}
              {behind ? null : <Button to="/pro/messages" icon="message" variant="secondary">Message</Button>}
              {/* The visit page reads encounterId from the URL itself. */}
              {visit ? <Button {...visit} variant="primary" icon="arrow-right">Open the visit</Button> : null}
            </>
          ) : undefined
        }
      />
      <PatientStrip
        name={patient.name}
        meta={`${patient.sex.charAt(0).toUpperCase()}, ${patient.age} · ${patient.id}`}
        chips={
          <>
            {canRead && patient.allergies ? <span className="po-allergy" title={`Allergy: ${patient.allergies}`}>Allergy: {patient.allergies.split(/[—;(]/)[0]!.trim()}</span> : null}
            <StatusChip patient={patient} />
          </>
        }
        tabs={canRead ? <Tabs label="Patient record" tabs={[...TABS]} value={tab} onChange={setTab} /> : undefined}
      />
      {!canRead ? (
        <EmptyState>
          Your role can see who is registered, but not clinical detail. The briefing, history, medicines and doses on this page are for doctors, nurses and
          management. Ask the care team if you need something from this record.
        </EmptyState>
      ) : tab === "overview" ? (
        <>
          {top.length || a?.due || patient.vitals?.length ? (
            <StatRow>
              {top.map((s) => {
                const flag = s.lab ? latestOf(s).flag : null;
                return <StatCard key={`${s.lab}${s.name}${s.unit}`} title={s.name} value={latestOf(s).value} unit={s.unit ?? undefined} caption={`${direction(s)} · ${when(latestOf(s).at)}`} chip={isFlagged(flag) ? flag : undefined} tone={flag?.startsWith("critical") ? "urgent" : "soon"} />;
              })}
              {a?.due ? <StatCard title="Doses taken" value={a.taken} unit={`of ${a.due}`} caption="Since discharge" progress={a.taken / a.due} chip={a.missed.length ? `${a.missed.length} missed` : undefined} tone="urgent" /> : null}
              {patient.vitals?.slice(0, Math.max(0, 3 - top.length)).map((v) => <StatCard key={v.label} title={v.label} value={v.value} caption="Latest reading" />)}
            </StatRow>
          ) : null}
          <WithRail
            rail={
              <RightRail label="Summary and medicines">
                <div className={behind ? "po-wrap" : "po-wrap po-step-only"}>
                <InsightCard
                  label="Pre-visit summary"
                  title={behind ? `${behind} ${behind === 1 ? "dose needs" : "doses need"} a word` : "Before the visit"}
                  lead={!hasVisit ? "No visit on record, so there is no briefing yet." : briefing.isPending ? "Sona is reading the record…" : briefing.error ? `No briefing: ${briefing.error.message}` : (briefing.data.lines[0] ?? "The briefing came back empty.")}
                  evidence={evidence}
                  sources={sources || undefined}
                  next={behind ? { label: "Message", step: "Ask about the doses that are behind.", to: "/pro/messages" } : visit ? { label: "Open the visit", step: sbar?.r ?? "Read the record before the visit.", ...visit } : undefined}
                  meta={briefing.data?.source === "fixture" ? <Chip tone="soon">Sample answer</Chip> : undefined}
                />
                </div>
                <Medicines items={patient.medicines?.slice(0, 4)} more={() => setTab("medicines")} total={patient.medicines?.length ?? 0} />
                <TakeHome patient={patient} />
              </RightRail>
            }
          >
            <Card title={main ? main.name : "Trend"}>
              {main ? (
                <>
                  <p className="po-caption">
                    {latestOf(main).value}{main.unit ? ` ${main.unit}` : ""} · {direction(main)} · {when(latestOf(main).at)}
                  </p>
                  <p className="po-legend"><span><i aria-hidden="true" />{main.name}{main.unit ? `, ${main.unit}` : ""}</span><span>{main.points.length} values, last 12 months</span></p>
                  <LineChart points={chartPoints(main)} label={`${main.name} over the last 12 months`} unit={main.unit ?? undefined} height={260} />
                  {charted.length > 1 ? (
                    <div className="po-chart-pick" role="group" aria-label="Measure to chart">
                      {charted.map((s) => <Button key={`${s.lab}${s.name}`} size="sm" variant={s === main ? "secondary" : "quiet"} aria-pressed={s === main} onClick={() => setPicked(s.name)}>{s.name}</Button>)}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="pt-muted">
                  {trends.error ? `Could not be loaded: ${trends.error.message}` : trends.isPending ? "Loading the trend…" : "No trend yet. A chart appears here once a measure has two values in the last 12 months."}
                </p>
              )}
            </Card>
            <PatientResults patientId={patient.id} limit={3} />
            <Card title="History">
              <dl className="po-history">
                <div><dt>Presenting complaint</dt><dd>{patient.complaint || "Not recorded."}</dd></div>
                <div><dt>Medical history</dt><dd>{patient.history?.length ? patient.history.join(", ") : "None recorded."}</dd></div>
                <div><dt>Family history</dt><dd>{patient.family || "None recorded."}</dd></div>
                <div><dt>Social history</dt><dd>{patient.social || "None recorded."}</dd></div>
              </dl>
            </Card>
          </WithRail>
        </>
      ) : tab === "timeline" ? (
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
      ) : tab === "results" ? (
        <>
          <PatientResults patientId={patient.id} />
          <LabCharts patientId={patient.id} />
        </>
      ) : (
        <>
          <Medicines items={patient.medicines} total={patient.medicines?.length ?? 0} />
          <TakeHome patient={patient} />
          <Card title="Doses taken">
            {doses.isPending ? (
              <p className="pt-muted">Loading…</p>
            ) : doses.error ? (
              <p className="pt-muted">Could not be loaded: {doses.error.message}</p>
            ) : !a?.due ? (
              <p className="pt-muted">No doses are due. Doses are counted from discharge.</p>
            ) : (
              <>
                <p className="pt-muted"><strong>{a.taken} of {a.due}</strong> doses taken since discharge{a.line ? ` · ${a.line}` : ""}</p>
                <meter className="po-meter" min={0} max={a.due} value={a.taken} aria-label="Doses taken" />
                <ul className="pt-list">
                  {[...a.missed.map((d) => ({ d, missed: true })), ...a.late.map((d) => ({ d, missed: false }))].map(({ d, missed }) => (
                    <li key={`${missed}${d.name}${String(d.dueAt)}`}>
                      {d.name} <Chip tone={missed ? "urgent" : "soon"}>{missed ? "Missed" : "Due now"}</Chip>
                      <small>Due {dayTime(d.dueAt)}</small>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </>
      )}
    </>
  );
}

/** "Metformin 500 mg twice daily": the name, then the dose muted. */
function Medicines({ items, total, more }: { items?: string[]; total: number; more?: () => void }) {
  return (
    <div className="po-wrap po-meds">
    <ListCard title="Medicines">
      {!items?.length ? <p className="pt-muted po-note">No medicines on record.</p> : null}
      {items?.map((m) => {
        const at = m.search(/\s\d/);
        return <ListRow key={m} icon="pill" title={at < 0 ? m : <>{m.slice(0, at)} <span className="pt-muted">{m.slice(at + 1)}</span></>} />;
      })}
      {more && total > (items?.length ?? 0) ? <Button size="sm" onClick={more}>All {total} medicines</Button> : null}
    </ListCard>
    </div>
  );
}

function TakeHome({ patient }: { patient: PatientRow }) {
  if (!patient.takeHome?.length) return null;
  return (
    <ListCard title="Take-home list">
      {patient.takeHome.map((m) => (
        <ListRow key={m.name} icon="pill" title={m.name} caption={m.detail} trailing={m.change !== "unchanged" ? <Chip tone={m.change === "stopped" ? "soon" : "info"}>{m.change}</Chip> : undefined} />
      ))}
    </ListCard>
  );
}

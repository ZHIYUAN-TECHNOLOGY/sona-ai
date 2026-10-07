import { can } from "@sona-ai/api/roles";
import { FOLLOW_UPS, LANGUAGES, type Language } from "@sona-ai/domain/discharge";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { SegmentBar } from "@/components/charts";
import { InsightCard } from "@/components/insight-card";
import { PageHeader, PatientStrip } from "@/components/page";
import { Button, Card, Chip, ListCard, ListRow, Select, Signal, StatCard, StatRow, Status } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { countOf, dischargeRank, standings } from "@/features/discharge/rank";
import { blockersOf, Loaded, type Mark, oneParam, Origin, PatientPicker, say, usePatient } from "@/features/discharge/shared";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/discharge-plan.css";

export const Route = createFileRoute("/pro/_app/discharge")({ validateSearch: oneParam("encounterId"), component: Page });

function Page() {
  const { encounterId } = Route.useSearch();
  return encounterId ? <Visit key={encounterId} encounterId={encounterId} /> : <Chooser />;
}

type Group = "fit" | "blocked";
const openPlan = (p: { encounterId: string }) => <Link to="/pro/discharge" search={{ encounterId: p.encounterId }}>Open plan</Link>;

/** No visit chosen: who can go home and who is held, from the ward's beds, ranked so the nearest to leaving lead. */
function Chooser() {
  const beds = useQuery(orpc.ward.beds.queryOptions());
  const [group, setGroup] = useState<Group>();
  const by = standings(beds.data ?? []);
  const fit = countOf(by, "fit");
  const blocked = countOf(by, "blocked");
  const watched = countOf(by, "watch");
  const toggle = (g: Group) => () => setGroup(now => (now === g ? undefined : g));
  const mark = (id: string): Mark | undefined => {
    const s = by.get(id);
    if (!s) return undefined;
    const why = s.kind === "blocked" ? `discharge barriers: ${s.blockers.map(b => b.label).join(", ")}` : s.kind === "fit" ? "no discharge barrier" : s.kind === "watch" ? "being watched" : "not medically fit yet";
    return { rank: dischargeRank(s), reason: `${s.bed} · ${why}`, chip: s.kind === "fit" ? <Chip tone="done">Ready for discharge</Chip> : s.kind === "blocked" ? <Chip tone="soon">Blocked</Chip> : s.kind === "watch" ? <Status tone="info">On watch</Status> : <Status>Not fit yet</Status> };
  };

  return (
    <>
      <PageHeader title="Discharge"
        lead={beds.isPending ? "Reading the ward…" : !beds.data ? "The ward could not be read, so this list is not ranked. Open a plan to see what is holding the bed."
          : fit + blocked === 0 ? "Nobody is medically fit for discharge yet."
          : <>{fit ? <Signal tone="done">{fit} ready for discharge</Signal> : "Nobody is ready for discharge"} · {blocked ? <Signal tone="soon">{blocked} medically fit, with barriers</Signal> : "nobody is blocked"}</>}
        actions={beds.data ? <Button to="/pro/ward" icon="bed">Open the ward</Button> : undefined} />
      {beds.data ? (
        <StatRow>
          <StatCard title="Ready for discharge" value={fit} caption="Medically fit, no discharge barrier" chip={fit ? "Approve next" : undefined} tone="done" onSelect={toggle("fit")} selected={group === "fit"} />
          <StatCard title="Blocked" value={blocked} caption="Fit, but something holds the bed" chip={blocked ? "Clear first" : undefined} tone="soon" onSelect={toggle("blocked")} selected={group === "blocked"} />
          <StatCard title="On the ward" value={by.size} caption="Admitted patients with a bed" />
        </StatRow>
      ) : null}
      {beds.data && by.size ? (
        <div className="chart-row">
          <Card title="The ward by readiness to go home">
            <SegmentBar label="Patients by readiness to go home" segments={[
              { label: "Ready for discharge", value: fit, tone: "green" },
              { label: "Fit but blocked", value: blocked, tone: "amber" },
              { label: "On watch", value: watched, tone: "blue" },
              { label: "Not fit yet", value: by.size - fit - blocked - watched, tone: "neutral" },
            ]} />
          </Card>
        </div>
      ) : null}
      <PatientPicker link={openPlan} mark={mark} only={group ? id => by.get(id)?.kind === group : undefined}
        title={group === "fit" ? "Ready for discharge" : group === "blocked" ? "Blocked" : "Patients, nearest to going home first"} />
    </>
  );
}

const things = (n: number) => `${n} thing${n === 1 ? "" : "s"}`;
/** A medicine's words: its name first, the rest (dose, frequency) quieter. */
const words = (med: object) => Object.values(med).filter((v): v is string => typeof v === "string" && !!v);

function Refused({ error }: { error: unknown }) {
  return (
    <div className="dp-refused" role="alert">
      <span>{say(error)}</span>
      <ul>{blockersOf(error).map(b => <li key={b.label}>{b.label}{b.detail ? `: ${b.detail}` : ""}</li>)}</ul>
    </div>
  );
}

function Visit({ encounterId }: { encounterId: string }) {
  const { me } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const plan = useQuery(orpc.discharge.plan.queryOptions({ input: { encounterId } }));
  const saved = plan.data?.state;
  // The draft follows the saved leaflet language.
  const language = saved?.language;
  const draft = useQuery(orpc.discharge.draft.queryOptions({ input: { encounterId, language: language ?? "en" }, enabled: !!language && can(me.role, "discharge.draft"), staleTime: Infinity }));
  const [edited, setEdited] = useState<string>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.discharge.plan.key() });
  const update = useMutation(orpc.discharge.update.mutationOptions({ onSuccess: refresh }));
  const saveSummary = useMutation(orpc.discharge.update.mutationOptions({ onSuccess: () => { setEdited(undefined); return refresh(); } }));
  const approve = useMutation(orpc.discharge.request.mutationOptions({ onSuccess: refresh }));
  const mayApprove = can(me.role, "discharge.request");
  const mayEdit = can(me.role, "discharge.update");
  const patient = usePatient(encounterId);

  // The server's own readiness checks (the ones discharge.request enforces), never a guess from the waits alone.
  const checks = plan.data?.checks ?? [];
  const blocked = checks.filter(c => c.status === "blocked");
  const bed = plan.data?.plan.bed || "the bed";
  const done = approve.isSuccess || !!saved?.dischargedAt;
  const clear = !!plan.data && blocked.length === 0;
  const canAct = clear && mayApprove && !done;
  const act = () => approve.mutate({ encounterId, requestId: crypto.randomUUID(), approvedBy: me.userId });
  const lead = !plan.data ? undefined
    : done ? `Discharge approved for ${bed}.`
    : blocked.length ? <><Signal tone="soon">{things(blocked.length)} still hold{blocked.length === 1 ? "s" : ""} {bed}</Signal>. Clear {blocked.length === 1 ? "it" : "them"} before you approve.</>
    : mayApprove ? `Nothing is holding ${bed}. Review the summary, then approve.`
    : `Nothing is holding ${bed}. Only a doctor can approve a discharge.`;

  return (
    <>
      <PageHeader title="Discharge plan" breadcrumb={[{ label: "Discharge", to: "/pro/discharge" }, { label: patient?.name ?? "Plan" }]} lead={lead}
        actions={
          <Button variant="primary" icon="check" pending={approve.isPending} disabled={!canAct} onClick={act}>
            {done ? "Discharge approved" : "Approve discharge"}
          </Button>
        } />
      <Loaded query={plan}>
        {({ plan: p }) => (
          <>
            {patient ? <PatientStrip name={patient.name} meta={patient.subtitle} chips={p.bed ? <Chip>{p.bed}</Chip> : undefined} /> : null}
            <WithRail rail={
              <RightRail label="Sona insight">
                <InsightCard label="Sona insight" title={done ? "Discharge approved" : clear ? "Ready to approve" : "Not ready yet"} sources={checks.length || 1}
                  lead={clear ? `Every discharge check has passed for ${bed}.` : `${things(blocked.length)} to clear before ${bed} can be released.`}
                  evidence={blocked.map(c => ({ icon: "clock" as const, text: c.detail ? `${c.label}: ${c.detail}` : c.label }))}
                  next={canAct ? { label: "Review the summary draft", step: "Read the draft first, then approve at the top. Sona checks the conditions again when you do.", onAct: () => document.getElementById("dp-summary")?.scrollIntoView({ behavior: "smooth" }) } : undefined} />
              </RightRail>
            }>
              <div className="dp-stack">
                {approve.error ? <Card title="Not approved"><Refused error={approve.error} /></Card> : null}
                <ListCard title={`Readiness: ${blocked.length} blocker${blocked.length === 1 ? "" : "s"} · ${p.meds.length} take-home medicine${p.meds.length === 1 ? "" : "s"}`}>
                  {checks.map(c => c.status === "blocked"
                    ? <ListRow key={c.id} icon="clock" title={c.label} caption={c.detail} trailing={<Chip tone="soon">Blocking</Chip>} />
                    : <ListRow key={c.id} icon="check" title={c.label} caption={c.detail} />)}
                </ListCard>
                <Card>
                  <div className="dp-doc">
                    <section><h2 className="dp-over">Diagnosis</h2><p className="dp-diagnosis">{p.summary.diagnosis}</p></section>
                    <section><h2 className="dp-over">Hospital course</h2><p>{p.summary.course}</p></section>
                    <section><h2 className="dp-over">Plan</h2><p>{p.summary.plan}</p></section>
                    <section>
                      <h2 className="dp-over">Take-home medicines</h2>
                      {p.meds.length
                        ? <div>{p.meds.map((m, i) => { const [name, ...rest] = words(m); return <ListRow key={i} icon="pill" title={name ?? "Medicine"} caption={rest.join(" · ")} />; })}</div>
                        : <p className="dp-note">None recorded.</p>}
                      {mayEdit ? (
                        <div className="dp-foot">
                          <Button variant="secondary" size="sm" icon="check" pending={update.isPending && update.variables?.medsConfirmed !== undefined} disabled={saved?.medsConfirmed || done}
                            onClick={() => update.mutate({ encounterId, medsConfirmed: true })}>
                            {saved?.medsConfirmed ? "Medicines confirmed" : "Confirm medicines"}
                          </Button>
                        </div>
                      ) : null}
                    </section>
                    <section>
                      <h2 className="dp-over">Follow-up</h2>
                      <div className="dp-foot" role="group" aria-label="Clinic review in">
                        {FOLLOW_UPS.map(f => (
                          <Button key={f.id} variant="secondary" size="sm" aria-pressed={saved?.followUp === f.id} disabled={!mayEdit || done || update.isPending}
                            onClick={() => update.mutate({ encounterId, followUp: f.id })}>{f.label}</Button>
                        ))}
                        {saved?.followUp ? null : <span className="dp-note">Choose when the clinic sees them.</span>}
                      </div>
                    </section>
                    {update.error ? <Refused error={update.error} /> : null}
                    <section id="dp-summary">
                      <h2 className="dp-over">Discharge summary <Chip variant="outline">Draft</Chip></h2>
                      {can(me.role, "discharge.draft") ? (
                        <Loaded query={draft}>
                          {d => {
                            const kept = saved?.summary ?? d.summary, text = edited ?? kept, dirty = text.trim() !== kept;
                            return (
                              <div className="dp-draft">
                                <div className="dp-foot">
                                  <Origin source={d.source} /><span className="dp-note">A proposal. Review and edit before you approve.</span>
                                  <Select label="Leaflet language" value={language} disabled={!mayEdit || done || update.isPending}
                                    onChange={e => update.mutate({ encounterId, language: e.target.value as Language })}>
                                    {LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                                  </Select>
                                </div>
                                <textarea className="dp-text" aria-label="Discharge summary draft" value={text} readOnly={!mayEdit || done} onChange={e => setEdited(e.target.value)} />
                                <div className="dp-foot">
                                  {dirty && mayEdit ? <Button variant="secondary" size="sm" icon="check" pending={saveSummary.isPending} onClick={() => saveSummary.mutate({ encounterId, summary: text })}>Save summary</Button>
                                    : saved?.summary ? <span className="dp-note">Saved</span> : null}
                                  {text !== d.summary && mayEdit && !done ? <Button size="sm" onClick={() => setEdited(d.summary)}>Back to Sona’s draft</Button> : null}
                                </div>
                                {saveSummary.error ? <Refused error={saveSummary.error} /> : null}
                              </div>
                            );
                          }}
                        </Loaded>
                      ) : <p className="dp-note">Your role cannot draft the discharge summary.</p>}
                    </section>
                  </div>
                </Card>
              </div>
            </WithRail>
          </>
        )}
      </Loaded>
    </>
  );
}

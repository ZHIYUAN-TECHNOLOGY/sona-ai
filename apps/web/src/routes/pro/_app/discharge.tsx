import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { InsightCard } from "@/components/insight-card";
import { PageHeader, PatientStrip } from "@/components/page";
import { Button, Card, Chip, ListCard, ListRow, Signal, StatCard, StatRow } from "@/components/primitives";
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
  const toggle = (g: Group) => () => setGroup(now => (now === g ? undefined : g));
  const mark = (id: string): Mark | undefined => {
    const s = by.get(id);
    if (!s) return undefined;
    const why = s.kind === "blocked" ? `waiting on ${s.blockers.map(b => b.label).join(", ")}` : s.kind === "fit" ? "nothing is holding it" : s.kind === "watch" ? "being watched" : "not fit to go yet";
    return { rank: dischargeRank(s), reason: `${s.bed} · ${why}`, chip: s.kind === "fit" ? <Chip tone="done">Ready to go</Chip> : s.kind === "blocked" ? <Chip tone="soon">Blocked</Chip> : undefined };
  };

  return (
    <>
      <PageHeader title="Discharge"
        lead={beds.isPending ? "Reading the ward…" : !beds.data ? "The ward could not be read, so this list is not ranked. Open a plan to see what is holding the bed."
          : fit + blocked === 0 ? "Nobody is fit to go home yet."
          : <>{fit ? <Signal tone="done">{fit} ready to go</Signal> : "Nobody is ready to go"} · {blocked ? <Signal tone="soon">{blocked} fit but blocked</Signal> : "nobody is blocked"}</>}
        actions={beds.data ? <Button to="/pro/ward" icon="bed">Open the ward</Button> : undefined} />
      {beds.data ? (
        <StatRow>
          <StatCard title="Ready to go" value={fit} caption="Fit, with nothing holding the bed" chip={fit ? "Approve next" : undefined} tone="done" onSelect={toggle("fit")} selected={group === "fit"} />
          <StatCard title="Blocked" value={blocked} caption="Fit, but something holds the bed" chip={blocked ? "Clear first" : undefined} tone="soon" onSelect={toggle("blocked")} selected={group === "blocked"} />
          <StatCard title="On the ward" value={by.size} caption="Admitted patients with a bed" />
        </StatRow>
      ) : null}
      <PatientPicker link={openPlan} mark={mark} only={group ? id => by.get(id)?.kind === group : undefined}
        title={group === "fit" ? "Ready to go" : group === "blocked" ? "Blocked" : "Patients, nearest to going home first"} />
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
  const draft = useQuery(orpc.discharge.draft.queryOptions({ input: { encounterId, language: "en" }, enabled: can(me.role, "discharge.draft"), staleTime: Infinity }));
  const [edited, setEdited] = useState<string>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.discharge.plan.key() });
  const confirmMeds = useMutation(orpc.discharge.update.mutationOptions({ onSuccess: refresh }));
  const approve = useMutation(orpc.discharge.request.mutationOptions({ onSuccess: refresh }));
  const mayApprove = can(me.role, "discharge.request");
  const patient = usePatient(encounterId);

  const waits = plan.data?.waits ?? [];
  const bed = plan.data?.plan.bed || "the bed";
  const clear = !!plan.data && waits.length === 0;
  const canAct = clear && mayApprove && !approve.isSuccess;
  const act = () => approve.mutate({ encounterId, requestId: crypto.randomUUID(), approvedBy: me.name });
  const lead = !plan.data ? undefined
    : approve.isSuccess ? `Discharge approved for ${bed}.`
    : waits.length ? <><Signal tone="soon">{things(waits.length)} still hold{waits.length === 1 ? "s" : ""} {bed}</Signal>. Clear {waits.length === 1 ? "it" : "them"} before you approve.</>
    : mayApprove ? `Nothing is holding ${bed}. Review the summary, then approve.`
    : `Nothing is holding ${bed}. Only a doctor can approve a discharge.`;

  return (
    <>
      <PageHeader title="Discharge plan" breadcrumb={[{ label: "Discharge", to: "/pro/discharge" }, { label: patient?.name ?? "Plan" }]} lead={lead}
        actions={
          <Button variant="primary" icon="check" pending={approve.isPending} disabled={!canAct} onClick={act}>
            {approve.isSuccess ? "Discharge approved" : "Approve discharge"}
          </Button>
        } />
      <Loaded query={plan}>
        {({ plan: p }) => (
          <>
            {patient ? <PatientStrip name={patient.name} meta={patient.subtitle} chips={p.bed ? <Chip>{p.bed}</Chip> : undefined} /> : null}
            <WithRail rail={
              <RightRail label="Sona insight">
                <InsightCard label="Sona insight" title={clear ? "Ready to approve" : "Not ready yet"} sources={waits.length || 1}
                  lead={clear ? `No pending results, referrals or letters are holding ${bed}.` : `${things(waits.length)} to clear before ${bed} can be released.`}
                  evidence={waits.map(w => ({ icon: "clock" as const, text: w.label }))}
                  next={canAct ? { label: "Review the summary draft", step: "Read the draft first, then approve at the top. Sona checks the conditions again when you do.", onAct: () => document.getElementById("dp-summary")?.scrollIntoView({ behavior: "smooth" }) } : undefined} />
              </RightRail>
            }>
              <div className="dp-stack">
                {approve.error ? <Card title="Not approved"><Refused error={approve.error} /></Card> : null}
                <ListCard title={`Readiness: ${waits.length} blocker${waits.length === 1 ? "" : "s"} · ${p.meds.length} take-home medicine${p.meds.length === 1 ? "" : "s"}`}>
                  {waits.length
                    ? waits.map(w => <ListRow key={w.id} icon="clock" title={w.label} caption={w.detail} trailing={<Chip tone="soon">Blocking</Chip>} />)
                    : <ListRow icon="check" title={<span className="dp-note">No pending results, referrals or letters are holding this bed.</span>} />}
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
                      {can(me.role, "discharge.update") ? (
                        <div className="dp-foot">
                          <Button variant="secondary" size="sm" icon="check" pending={confirmMeds.isPending} disabled={confirmMeds.isSuccess}
                            onClick={() => confirmMeds.mutate({ encounterId, medsConfirmed: true })}>
                            {confirmMeds.isSuccess ? "Medicines confirmed" : "Confirm medicines"}
                          </Button>
                        </div>
                      ) : null}
                      {confirmMeds.error ? <Refused error={confirmMeds.error} /> : null}
                    </section>
                    <section id="dp-summary">
                      <h2 className="dp-over">Discharge summary <Chip variant="outline">Draft</Chip></h2>
                      {can(me.role, "discharge.draft") ? (
                        <Loaded query={draft}>
                          {d => (
                            <div className="dp-draft">
                              <div className="dp-foot"><Origin source={d.source} /><span className="dp-note">A proposal. Review and edit before you approve.</span></div>
                              <textarea className="dp-text" aria-label="Discharge summary draft" value={edited ?? d.summary} onChange={e => setEdited(e.target.value)} />
                              {edited !== undefined && edited !== d.summary ? <div className="dp-foot"><Button size="sm" onClick={() => setEdited(undefined)}>Back to Sona’s draft</Button></div> : null}
                            </div>
                          )}
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

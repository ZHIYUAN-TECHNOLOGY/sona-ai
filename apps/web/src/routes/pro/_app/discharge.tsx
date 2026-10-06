import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { InsightCard, InsightRow } from "@/components/insight-card";
import { PageHeader } from "@/components/page";
import { Button, Card, Chip } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { blockersOf, Loaded, oneParam, Origin, PatientPicker, say } from "@/features/discharge/shared";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/discharge.css";

export const Route = createFileRoute("/pro/_app/discharge")({ validateSearch: oneParam("encounterId"), component: Page });

function Page() {
  const { encounterId } = Route.useSearch();
  return (
    <>
      <PageHeader title="Discharge" lead={encounterId ? <Link to="/pro/discharge">All patients</Link> : undefined} />
      {encounterId ? <Visit key={encounterId} encounterId={encounterId} /> : (
        <PatientPicker lead="Choose a patient to see what is blocking their discharge."
          link={p => <Link to="/pro/discharge" search={{ encounterId: p.encounterId }}>Open plan</Link>} />
      )}
    </>
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

  return (
    <Loaded query={plan}>
      {({ plan: p, waits }) => (
        <>
          <InsightRow>
            <InsightCard tone={waits.length ? "soon" : "done"} sources={waits.length || 1}
              lead={waits.length ? `${waits.length} thing${waits.length > 1 ? "s" : ""} still hold${waits.length > 1 ? "" : "s"} ${p.bed || "the bed"}` : "Nothing else is holding the bed"} />
            <InsightCard lead={p.summary.diagnosis} sources={1} />
          </InsightRow>
          <WithRail rail={
            <RightRail label="Plan">
              <Card title="Course">{p.summary.course}</Card>
              <Card title="Plan">{p.summary.plan}</Card>
              <Card title="Take-home medicines">
                {p.meds.length ? <ul>{p.meds.map((m, i) => <li key={i}>{Object.values(m).filter(v => typeof v === "string").join(" · ")}</li>)}</ul> : "None recorded."}
                {can(me.role, "discharge.update") ? (
                  <Button pending={confirmMeds.isPending} onClick={() => confirmMeds.mutate({ encounterId, medsConfirmed: true })}>
                    {confirmMeds.isSuccess ? "Medicines confirmed" : "Confirm medicines"}
                  </Button>
                ) : null}
                {confirmMeds.error ? <p className="dc-refused">{say(confirmMeds.error)}</p> : null}
              </Card>
            </RightRail>
          }>
            <div className="dc-stack">
              <Card title="What is blocking">
                {waits.length ? (
                  <ul className="dc-list">
                    {waits.map(w => <li key={w.id}><span><strong>{w.label}</strong> <span className="dc-muted">{w.detail}</span></span><Chip tone="soon">Blocking</Chip></li>)}
                  </ul>
                ) : <p className="dc-muted">No pending results, referrals or letters are holding this bed.</p>}
              </Card>
              <Card title="Discharge summary">
                {can(me.role, "discharge.draft") ? (
                  <Loaded query={draft}>
                    {d => (
                      <>
                        <div className="dc-row"><Origin source={d.source} /><span className="dc-muted">A proposal. Review and edit before you approve.</span></div>
                        <textarea className="dc-text" aria-label="Discharge summary" value={edited ?? d.summary} onChange={e => setEdited(e.target.value)} />
                        {edited !== undefined && edited !== d.summary ? <Button onClick={() => setEdited(undefined)}>Back to Sona’s draft</Button> : null}
                      </>
                    )}
                  </Loaded>
                ) : <p className="dc-muted">Your role cannot draft the discharge summary.</p>}
              </Card>
              <div className="dc-row">
                <Button variant="primary" pending={approve.isPending} disabled={!mayApprove || waits.length > 0 || approve.isSuccess}
                  onClick={() => approve.mutate({ encounterId, requestId: crypto.randomUUID(), approvedBy: me.name })}>
                  {approve.isSuccess ? "Discharge approved" : "Approve discharge"}
                </Button>
                <span className="dc-muted">
                  {!mayApprove ? "Only a doctor can approve a discharge." : waits.length ? "Clear what is blocking first." : "You decide. Sona checks the conditions again when you approve."}
                </span>
              </div>
              {approve.error ? (
                <div className="dc-refused" role="alert">
                  {say(approve.error)}
                  <ul>{blockersOf(approve.error).map(b => <li key={b.label}>{b.label}{b.detail ? `: ${b.detail}` : ""}</li>)}</ul>
                </div>
              ) : null}
            </div>
          </WithRail>
        </>
      )}
    </Loaded>
  );
}

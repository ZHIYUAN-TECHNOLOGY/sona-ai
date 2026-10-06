import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { PageHeader } from "@/components/page";
import { Button, Card, Chip, Field } from "@/components/primitives";
import { blockersOf, Loaded, oneParam, Origin, PatientPicker, say } from "@/features/discharge/shared";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/discharge.css";

export const Route = createFileRoute("/pro/_app/guarantee-letter")({ validateSearch: oneParam("encounterId"), component: Page });

function Page() {
  const { encounterId } = Route.useSearch();
  return (
    <>
      <PageHeader title="Guarantee letter" lead={encounterId ? <Link to="/pro/guarantee-letter">All patients</Link> : undefined} />
      {encounterId ? <Letter key={encounterId} encounterId={encounterId} /> : (
        <PatientPicker lead="Choose a patient to see their guarantee letter."
          link={p => <Link to="/pro/guarantee-letter" search={{ encounterId: p.encounterId }}>Open letter</Link>} />
      )}
    </>
  );
}

const STEPS = ["Drafted", "Sent", "Decided"] as const;
/** How far the letter is along the steps, and what the last step says. */
const progress = (status: string) =>
  status === "draft" ? { at: 0, end: "Approved or denied" } : status === "sent" || status === "queried" ? { at: 1, end: status === "queried" ? "Insurer has a question" : "Approved or denied" }
    : { at: 2, end: status === "approved" ? "Approved" : status === "denied" ? "Denied" : status === "appealed" ? "Denied, appeal sent" : status };

function Letter({ encounterId }: { encounterId: string }) {
  const { me } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const input = { encounterId };
  const status = useQuery(orpc.claim.status.queryOptions({ input }));
  const codes = useQuery(orpc.claim.suggestCodes.queryOptions({ input, staleTime: Infinity }));
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: orpc.claim.status.key() }), queryClient.invalidateQueries({ queryKey: orpc.claim.suggestCodes.key() })]);
  const fix = useMutation(orpc.claim.update.mutationOptions({ onSuccess: refresh }));
  const send = useMutation(orpc.claim.send.mutationOptions({ onSuccess: refresh }));
  const mayChange = can(me.role, "claim.update");
  const maySend = can(me.role, "claim.send");

  return (
    <Loaded query={status}>
      {s => {
        const { at, end } = progress(s.status);
        return (
          <div className="dc-stack">
            <ol className="dc-steps" aria-label="Claim status">
              {STEPS.map((step, i) => (
                <li key={step}><Chip tone={i < at || s.status === "approved" ? "done" : i === at ? (s.status === "denied" ? "urgent" : "info") : "neutral"}>{i === 2 ? end : step}</Chip></li>
              ))}
            </ol>
            {s.query ? <p className="dc-refused">The insurer asks: {s.query}</p> : null}
            {s.denial ? <p className="dc-refused">Denied ({s.denial.code}): {s.denial.reason}{s.denial.note ? ` ${s.denial.note}` : ""}</p> : null}
            <Card title="Suggested codes">
              <Loaded query={codes} empty="No codes suggested.">
                {c => (
                  <>
                    <div className="dc-row"><Origin source={c.source} /><span className="dc-muted">Each code cites the note. You decide.</span></div>
                    {c.codes.length ? (
                      <ul className="dc-list">
                        {c.codes.map(code => (
                          <li key={code.code}>
                            <span>
                              <strong>{code.code}</strong> {code.label} <Chip>{code.kind}</Chip>
                              <blockquote className="dc-quote">{c.sentences.find(x => x.id === code.evidence)?.text ?? code.evidence}</blockquote>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="dc-muted">The note has nothing to code yet.</p>}
                  </>
                )}
              </Loaded>
              {s.status === "draft" && mayChange ? (
                <div className="dc-row">
                  <span className="dc-muted">Change the codes by adding to the note:</span>
                  <Button pending={fix.isPending} onClick={() => fix.mutate({ encounterId, organismConfirmed: true })}>Confirm the organism</Button>
                  <Button pending={fix.isPending} onClick={() => fix.mutate({ encounterId, ivReasonAdded: true })}>Add the reason for IV treatment</Button>
                </div>
              ) : null}
              {fix.error ? <p className="dc-refused">{say(fix.error)}</p> : null}
            </Card>
            {s.status === "draft" ? (
              <div className="dc-row">
                <Button variant="primary" pending={send.isPending} disabled={!maySend} onClick={() => send.mutate({ encounterId, requestId: crypto.randomUUID(), approvedBy: me.name })}>
                  Accept codes and send
                </Button>
                {maySend ? null : <span className="dc-muted">Only a doctor can send a claim.</span>}
              </div>
            ) : null}
            {send.error ? (
              <div className="dc-refused" role="alert">{say(send.error)}<ul>{blockersOf(send.error).map(b => <li key={b.label}>{b.label}{b.detail ? `: ${b.detail}` : ""}</li>)}</ul></div>
            ) : null}
            {s.status === "denied" ? can(me.role, "claim.appeal") ? <Appeal encounterId={encounterId} approvedBy={me.name} onSent={refresh} />
              : <p className="dc-muted">Your role cannot appeal a denied guarantee letter.</p> : null}
          </div>
        );
      }}
    </Loaded>
  );
}

function Appeal({ encounterId, approvedBy, onSent }: { encounterId: string; approvedBy: string; onSent: () => unknown }) {
  const draft = useQuery(orpc.claim.appealDraft.queryOptions({ input: { encounterId }, staleTime: Infinity }));
  const [edited, setEdited] = useState<NonNullable<typeof draft.data>["letter"]>();
  const appeal = useMutation(orpc.claim.appeal.mutationOptions({ onSuccess: onSent }));
  return (
    <Card title="Appeal">
      <Loaded query={draft}>
        {d => {
          const letter = edited ?? d.letter;
          return (
            <div className="dc-stack">
              <div className="dc-row"><Origin source={d.source} /><span className="dc-muted">A proposal. Review and edit, then send.</span></div>
              <Field label="Opening">{control => <textarea {...control} className="dc-text" value={letter.opening} onChange={e => setEdited({ ...letter, opening: e.target.value })} />}</Field>
              {letter.points.map((p, i) => (
                <Field key={p.evidenceSentenceId + i} label={`Point ${i + 1}`} hint={`From the note: ${d.sentences.find(x => x.id === p.evidenceSentenceId)?.text ?? ""}`}>
                  {control => <textarea {...control} className="dc-text" value={p.claim}
                    onChange={e => setEdited({ ...letter, points: letter.points.map((q, j) => (j === i ? { ...q, claim: e.target.value } : q)) })} />}
                </Field>
              ))}
              <Field label="Closing">{control => <textarea {...control} className="dc-text" value={letter.closing} onChange={e => setEdited({ ...letter, closing: e.target.value })} />}</Field>
              <div className="dc-row">
                <Button variant="primary" pending={appeal.isPending} disabled={!letter.points.length}
                  onClick={() => appeal.mutate({ encounterId, requestId: crypto.randomUUID(), approvedBy, letter })}>Send appeal</Button>
                {letter.points.length ? null : <span className="dc-muted">No point is grounded in the note, so there is nothing to send.</span>}
              </div>
              {appeal.error ? <p className="dc-refused" role="alert">{say(appeal.error)}</p> : null}
            </div>
          );
        }}
      </Loaded>
    </Card>
  );
}

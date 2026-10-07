import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { DataTable, type Column } from "@/components/data-table";
import { Icon } from "@/components/icon";
import { InsightCard } from "@/components/insight-card";
import { PageHeader, PatientStrip } from "@/components/page";
import { RightRail, WithRail } from "@/components/rail";
import { Button, Card, Chip, Field, Signal, type Tone } from "@/components/primitives";
import { letterHold, standings } from "@/features/discharge/rank";
import { blockersOf, Loaded, type Mark, oneParam, Origin, PatientPicker, say, usePatient } from "@/features/discharge/shared";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/discharge.css";
import "@/styles/pages/guarantee-letter.css";

export const Route = createFileRoute("/pro/_app/guarantee-letter")({ validateSearch: oneParam("encounterId"), component: Page });

function Page() {
  const { encounterId } = Route.useSearch();
  return encounterId ? <Letter key={encounterId} encounterId={encounterId} /> : <Chooser />;
}

const openLetter = (p: { encounterId: string }) => <Link to="/pro/guarantee-letter" search={{ encounterId: p.encounterId }}>Open letter</Link>;

/**
 * No letter chosen. The ward knows which letters hold a bed, so those lead with the reason.
 * ponytail: no procedure lists every claim's status, so a letter that holds no bed says nothing until opened.
 */
function Chooser() {
  const beds = useQuery(orpc.ward.beds.queryOptions());
  const by = standings(beds.data ?? []);
  const holding = [...by.values()].filter(letterHold).length;
  const mark = (id: string): Mark | undefined => {
    const hold = letterHold(by.get(id));
    return hold ? { rank: 0, reason: [hold.label, hold.detail].filter(Boolean).join(": "), chip: <Chip tone="soon">Holding a bed</Chip> } : undefined;
  };
  return (
    <>
      <PageHeader title="Guarantee letter"
        lead={!beds.data ? "Choose a patient to see where their insurer claim stands."
          : holding ? <><Signal tone="soon">{holding} guarantee letter{holding === 1 ? " is" : "s are"} holding a bed</Signal>. Open {holding === 1 ? "it" : "those"} first.</>
          : "No guarantee letter is holding a bed. Open a patient to see where their claim stands."} />
      <PatientPicker link={openLetter} mark={mark} title={holding ? "Patients, letters holding a bed first" : "Patients"} />
    </>
  );
}

const STEPS = ["Drafted", "Sent", "Decided"] as const;
/** How far the letter is along the steps, and what the last step says. */
const progress = (status: string) =>
  status === "draft" ? { at: 0, end: "Approved or denied" } : status === "sent" || status === "queried" ? { at: 1, end: status === "queried" ? "Insurer has a question" : "Approved or denied" }
    : { at: 2, end: status === "approved" ? "Approved" : status === "denied" ? "Denied" : status === "appealed" ? "Denied, appeal sent" : status };

const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : undefined);
const crumbs = (name = "This letter") => [{ label: "Guarantee letters", to: "/pro/guarantee-letter" as const }, { label: name }];

type Claim = { status: string; approvedAt?: string; appealedAt?: string; denial?: { code: string } };
type Step = { label: string; state: "done" | "current" | "denied" | "blocked" | "todo"; detail?: string };

/** The stepper's rows, from `progress()`. A denied letter grows a fourth step, the appeal. */
function stepsOf(s: Claim): Step[] {
  const { at, end } = progress(s.status);
  const lost = s.status === "denied" || s.status === "appealed";
  const steps: Step[] = STEPS.map((step, i) => ({
    label: i === 2 ? (s.status === "appealed" ? "Denied" : end) : step,
    state: i === 2 && lost ? "denied" : i === 2 && s.status === "queried" ? "blocked" : i < at || s.status === "approved" ? "done" : i === at ? "current" : "todo",
    detail: i === 0 && at === 0 ? "Not sent yet" : i === 1 && at === 1 ? "Waiting for the insurer" : i === 2 && s.status === "approved" ? day(s.approvedAt) : undefined,
  }));
  if (lost) steps.push(s.status === "appealed" ? { label: "Appeal sent", state: "done", detail: day(s.appealedAt) } : { label: "Appeal", state: "current", detail: "Draft to review" });
  return steps;
}

const leadOf = (s: Claim) =>
  s.status === "draft" ? "Not sent yet. Check the codes, then send the letter to the insurer."
    : s.status === "sent" ? "Sent. The insurer has not decided yet."
    : s.status === "queried" ? "The insurer has a question before it decides."
    : s.status === "approved" ? `Approved${s.approvedAt ? ` on ${day(s.approvedAt)}` : ""}. Nothing left to do.`
    : s.status === "denied" ? `Denied${s.denial ? ` (${s.denial.code})` : ""}. An appeal draft is ready to review.`
    : s.status === "appealed" ? `Denied, and the appeal went${s.appealedAt ? ` on ${day(s.appealedAt)}` : ""}. The insurer has not answered yet.` : s.status;

/** The statuses whose lead needs the eye: a denial, an insurer's question, an approval. The rest stay plain. */
const NEEDS_EYE: Record<string, Tone | undefined> = { denied: "urgent", queried: "soon", approved: "done" };

function Letter({ encounterId }: { encounterId: string }) {
  const { me } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const input = { encounterId };
  const status = useQuery(orpc.claim.status.queryOptions({ input }));
  const codes = useQuery(orpc.claim.suggestCodes.queryOptions({ input, staleTime: Infinity }));
  // A fix saves a sentence to the note, so the note, its checks and the codes suggested over it are all read again.
  const refresh = () => Promise.all([orpc.claim.status, orpc.claim.suggestCodes, orpc.note.get].map(q => queryClient.invalidateQueries({ queryKey: q.key() })));
  const fix = useMutation(orpc.claim.update.mutationOptions({ onSuccess: refresh }));
  const [why, setWhy] = useState("");
  const send = useMutation(orpc.claim.send.mutationOptions({ onSuccess: refresh }));
  const mayChange = can(me.role, "claim.update");
  const maySend = can(me.role, "claim.send");
  const mayAppeal = can(me.role, "claim.appeal");
  const sendNow = () => send.mutate({ encounterId, requestId: crypto.randomUUID(), approvedBy: me.userId });
  const cited = codes.data?.codes ?? [];
  const count = (n: number) => `${n} code${n === 1 ? "" : "s"}`;
  const offTable = cited.filter(c => c.inTable === false).length;
  /** Two facts about the codes; the table below lists them. */
  const evidence = cited.length ? [
    { icon: "file" as const, text: `${count(cited.filter(c => c.evidence).length)} cite the note` },
    { icon: offTable ? "alert" as const : "check" as const, text: `${offTable} not in the ICD-10 table` },
  ] : [];
  const patient = usePatient(encounterId);
  const CRUMBS = crumbs(patient?.name);
  const sources = cited.length || undefined;

  const s = status.data;
  if (!s) return <><PageHeader title="Guarantee letter" breadcrumb={CRUMBS} /><Loaded query={status}>{() => null}</Loaded></>;
  const draft = s.status === "draft";
  const open = s.checks?.filter(c => c.status === "blocked") ?? [];
  const blockers = send.error ? blockersOf(send.error) : [];
  const reviewUrl = s.reviewUrl;

  const insight = send.error ? <InsightCard tone="urgent" label="Not sent" lead={say(send.error)} sources={blockers.length || undefined}
      evidence={blockers.map(b => ({ icon: "alert" as const, text: b.detail ? `${b.label}: ${b.detail}` : b.label }))} />
    : s.query ? <InsightCard tone="soon" label="Insurer's question" lead={s.query} evidence={evidence} sources={sources}
      next={reviewUrl ? { label: "Open the insurer's page", step: "Answer there", onAct: () => window.open(reviewUrl, "_blank", "noopener") } : undefined} />
    : s.denial ? <InsightCard tone={s.status === "denied" ? "urgent" : "info"} label={`Denial reason · ${s.denial.code}`} lead={`${s.denial.reason}${s.denial.note ? ` ${s.denial.note}` : ""}`}
      evidence={evidence} sources={sources}
      next={s.status === "denied" && mayAppeal ? { label: "Review the appeal draft", step: "Edit, then send", onAct: () => document.getElementById("gl-appeal")?.scrollIntoView({ behavior: "smooth" }) } : undefined} />
    : <InsightCard tone={s.status === "approved" ? "done" : "info"} label="Next step" evidence={evidence} sources={sources}
      lead={draft ? (maySend ? `${cited.length} ${cited.length === 1 ? "code is" : "codes are"} ready. Check each against the note before you send.` : "Only a doctor can send this letter.") : leadOf(s)}
      next={draft && maySend ? { label: "Review the codes", step: "Check each code first, then accept and send at the top", onAct: () => document.getElementById("gl-codes")?.scrollIntoView({ behavior: "smooth" }) } : undefined} />;

  const columns: Column<(typeof cited)[number]>[] = [
    { key: "code", header: "Code", cell: c => <span className="gl-code">{c.code}</span> },
    { key: "title", header: "Title", cell: c => <span className="gl-title">{c.label}{c.inTable === false ? <Chip tone="soon" icon="alert">Not in the ICD-10 table</Chip> : null}</span> },
    { key: "cite", header: "Cited from the note", cell: c => { const text = codes.data?.sentences.find(x => x.id === c.evidence)?.text ?? c.evidence; return <span className="gl-cite" title={text}>{text}</span>; } },
    { key: "kind", header: "Kind", cell: c => <span className="gl-muted">{c.kind}</span> },
  ];

  return (
    <>
      <PageHeader title="Guarantee letter" breadcrumb={CRUMBS} lead={NEEDS_EYE[s.status] ? <Signal tone={NEEDS_EYE[s.status]}>{leadOf(s)}</Signal> : leadOf(s)}
        actions={draft && maySend ? <Button variant="primary" icon="arrow-right" pending={send.isPending} disabled={open.length > 0} onClick={sendNow}>
          {open.length ? `Resolve ${open.length} to send` : "Accept codes and send"}</Button> : undefined} />
      {patient ? <PatientStrip name={patient.name} meta={patient.subtitle} /> : null}
      <WithRail rail={<RightRail label="What to decide">{insight}</RightRail>}>
        <Card title="Claim status">
          <ol className="gl-steps">
            {stepsOf(s).map((step, i) => (
              <li key={step.label} className="gl-step" data-state={step.state} aria-current={step.state === "current" ? "step" : undefined}>
                <span className="gl-mark">{step.state === "done" ? <Icon name="check" size={16} label="Done" /> : i + 1}</span>
                <span className="gl-step-label">{step.label}</span>
                {step.detail ? <span className="gl-step-detail">{step.detail}</span> : null}
              </li>
            ))}
          </ol>
        </Card>
        {draft && s.checks?.length ? (
          <Card title="Insurer's checklist">
            <ul className="gl-checks">
              {s.checks.map(c => (
                <li key={c.id} className="gl-check" data-state={c.status}>
                  <span className="gl-mark">{c.status === "passed" ? <Icon name="check" size={16} label="Met" /> : <Icon name="alert" size={16} label="Open" />}</span>
                  <div className="gl-check-body">
                    <span className="gl-step-label">{c.label}</span>
                    <span className="gl-muted">{c.detail}</span>
                    {c.status === "blocked" && mayChange && c.id === "organism" ? (
                      <div className="gl-row"><Button size="sm" variant="secondary" pending={fix.isPending} onClick={() => fix.mutate({ encounterId, organismConfirmed: true })}>Add “Organism not identified.”</Button></div>
                    ) : null}
                    {c.status === "blocked" && mayChange && c.id === "iv" ? (
                      <div className="gl-doc-body">
                        <Field label="Why oral was not used first">{control => <textarea {...control} className="gl-text" value={why} onChange={e => setWhy(e.target.value)} />}</Field>
                        <div className="gl-row"><Button size="sm" variant="secondary" pending={fix.isPending} disabled={!why.trim()}
                          onClick={() => fix.mutate({ encounterId, ivReasonAdded: true, ivReason: why }, { onSuccess: () => setWhy("") })}>Add to note</Button></div>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {fix.error ? <p className="gl-error" role="alert">{say(fix.error)}</p> : null}
          </Card>
        ) : null}
        <div id="gl-codes"><Card title="Suggested codes">
          <Loaded query={codes} empty="No codes suggested.">
            {c => (
              <>
                <div className="gl-row"><Origin source={c.source} /><p className="gl-muted">Each code cites the note. You decide.</p></div>
                <DataTable columns={columns} rows={c.codes} rowKey={code => code.code} empty={<p className="gl-muted">The note has nothing to code yet.</p>} />
              </>
            )}
          </Loaded>
        </Card></div>
        {s.status === "denied" ? mayAppeal ? <Appeal encounterId={encounterId} approvedBy={me.userId} onSent={refresh} />
          : <Card title="Appeal"><p className="gl-muted">Your role cannot appeal a denied guarantee letter.</p></Card> : null}
      </WithRail>
    </>
  );
}

function Appeal({ encounterId, approvedBy, onSent }: { encounterId: string; approvedBy: string; onSent: () => unknown }) {
  const draft = useQuery(orpc.claim.appealDraft.queryOptions({ input: { encounterId }, staleTime: Infinity }));
  const [edited, setEdited] = useState<NonNullable<typeof draft.data>["letter"]>();
  const appeal = useMutation(orpc.claim.appeal.mutationOptions({ onSuccess: onSent }));
  return (
    <div id="gl-appeal"><Card title="Appeal letter">
      <Loaded query={draft}>
        {d => {
          const letter = edited ?? d.letter;
          return (
            <div className="gl-doc-body">
              <div className="gl-row"><Chip tone="soon" variant="outline">Draft</Chip><Origin source={d.source} /><p className="gl-muted">Not sent. Review and edit each part, then send.</p></div>
              <Field label="Opening">{control => <textarea {...control} className="gl-text" value={letter.opening} onChange={e => setEdited({ ...letter, opening: e.target.value })} />}</Field>
              {letter.points.map((p, i) => (
                <Field key={p.evidenceSentenceId + i} label={`Point ${i + 1}`} hint={`From the note: ${d.sentences.find(x => x.id === p.evidenceSentenceId)?.text ?? ""}`}>
                  {control => <textarea {...control} className="gl-text" value={p.claim}
                    onChange={e => setEdited({ ...letter, points: letter.points.map((q, j) => (j === i ? { ...q, claim: e.target.value } : q)) })} />}
                </Field>
              ))}
              <Field label="Closing">{control => <textarea {...control} className="gl-text" value={letter.closing} onChange={e => setEdited({ ...letter, closing: e.target.value })} />}</Field>
              <div className="gl-doc-foot">
                <Button variant="primary" icon="arrow-right" pending={appeal.isPending} disabled={!letter.points.length}
                  onClick={() => appeal.mutate({ encounterId, requestId: crypto.randomUUID(), approvedBy, letter })}>Send appeal</Button>
                {letter.points.length ? null : <span className="gl-muted">No point is grounded in the note, so there is nothing to send.</span>}
              </div>
              {appeal.error ? <p className="gl-error" role="alert">{say(appeal.error)}</p> : null}
            </div>
          );
        }}
      </Loaded>
    </Card></div>
  );
}

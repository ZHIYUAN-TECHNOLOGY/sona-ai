import type { Regimen }from "@sona-ai/domain/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { EmptyState } from "@/components/page";
import { Button, Card, Chip, Field, ListRow, Skeleton } from "@/components/primitives";
import { orpc } from "@/lib/orpc";

import { Medicines, type MedicineState } from "./medicines";
import { orderChecks, refusal, type VisitPatient } from "./visit";

type Payload = Partial<Regimen> & { checks?: string[]; warnings?: string[]; checkedBy?: string; transmitted?: boolean; amendment?: { reason?: string; supersedes?: string } };

/** The medicine order beside the note: the check first, then the order, then the server's receipt. */
export function Orders({ encounterId, patient, userId, canPrescribe }: { encounterId: string; patient?: VisitPatient; userId: string; canPrescribe: boolean }) {
  const queryClient = useQueryClient();
  const encounter = useQuery(orpc.encounter.get.queryOptions({ input: { encounterId } }));
  // The revision whose review this doctor has seen on this page; an order is offered only at that revision.
  const [shown, setShown] = useState<number>();
  const [reason, setReason] = useState("");
  const review = useMutation(orpc.prescribing.review.mutationOptions({
    onSuccess: snapshot => {
      queryClient.setQueryData(orpc.encounter.get.key({ input: { encounterId } }), snapshot);
      setShown(snapshot.revision);
    },
    // Refused as stale: someone edited the visit, so read it again.
    onError: () => queryClient.invalidateQueries({ queryKey: orpc.encounter.get.key({ input: { encounterId } }) }),
  }));
  const place = useMutation(orpc.prescribing.simulate.mutationOptions());
  const amend = useMutation(orpc.prescribing.amend.mutationOptions());

  if (encounter.isPending) return <Card title="Medicine order"><Skeleton height={48} /></Card>;
  if (encounter.isError) return <EmptyState>{refusal(encounter.error).message}</EmptyState>;
  if (!patient) return <EmptyState>This visit's patient record is not available, so the order cannot be checked here.</EmptyState>;

  const { revision } = encounter.data;
  const state = encounter.data.state as MedicineState;
  const proposed = state.proposedMedicine;
  const checks = orderChecks(encounter.data, patient);
  const blocked = checks.filter(c => c.status === "blocked"), warnings = checks.filter(c => c.status === "warning");
  const reviewed = shown === revision;
  // One request per revision, so a second tap or a reload returns the same receipt.
  const command = { encounterId, approvedBy: userId, requestId: `web-rx-${encounterId}-r${revision}` };
  const last = amend.data ?? place.data;
  const failed = [review, place, amend].find(m => m.isError);
  const refused = failed ? refusal(failed.error) : undefined;
  const receipt = last?.payload as Payload | undefined;

  return (
    <div className="visit-orders">
      <Medicines encounterId={encounterId} revision={revision} state={state} patient={patient} canEdit={canPrescribe} />
      <Card title="Medicine order">
        {proposed ? (
          <ul className="list"><ListRow icon="pill" title={proposed}
            caption={reviewed ? `Reviewed at revision ${revision}` : "Not reviewed yet"}
            trailing={blocked.length ? <Chip tone="amber" icon="alert">{blocked.length} of {checks.length} blocked</Chip>
              : warnings.length ? <Chip tone="amber">{warnings.length} to weigh</Chip>
              : <span className="visit-muted">{checks.length} checks pass</span>} /></ul>
        ) : <p className="visit-muted">No medicine is proposed for this visit yet.{canPrescribe ? " Propose one above, then review it." : ""}</p>}
        {canPrescribe ? (
          <div className="visit-actions">
            <Button size="sm" variant={reviewed ? "quiet" : "primary"} disabled={!proposed} pending={review.isPending}
              onClick={() => review.mutate({ encounterId, expectedRevision: revision })}>
              {reviewed ? "Review again" : "Review the order"}
            </Button>
            {reviewed ? (
              <Button size="sm" variant="primary" icon="check" disabled={blocked.length > 0} pending={place.isPending} onClick={() => { amend.reset(); place.mutate(command); }}>
                {warnings.length && !blocked.length ? "Place the order anyway" : "Place the order"}
              </Button>
            ) : null}
          </div>
        ) : <p className="visit-muted">Only a doctor can review and place a medicine order.</p>}
        {/* What the decision rests on and what is still open, under the buttons so they stay in view. */}
        {proposed || reviewed || !canPrescribe ? (
          <ul className="visit-checks">
            {checks.map(c => (
              <li key={c.id}>
                {c.status === "blocked" ? <Chip tone="red">Blocked</Chip> : c.status === "warning" ? <Chip tone="amber">Warning</Chip> : <span className="visit-muted">Passed</span>}
                <span><strong>{c.label}</strong>{c.by === "sona" ? <span className="visit-muted"> · checked by Sona</span> : null}<br />{c.detail}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {refused ? (
          <div role="alert" className="visit-refused">
            {refused.message}
            {refused.open.length ? <ul>{refused.open.map(o => <li key={o}>{o}</li>)}</ul> : null}
          </div>
        ) : null}
      </Card>

      {last && receipt ? (
        <Card title="Receipt">
          <p><Chip tone="done">Recorded</Chip> {[receipt.medication, receipt.dose, receipt.unit, receipt.route, receipt.frequency, receipt.duration].filter(Boolean).join(" ")}</p>
          <p className="visit-muted">
            {receipt.indication}{receipt.sourceVersion ? ` · ${receipt.sourceVersion}` : ""}<br />
            Approved by {last.approvedByName ?? "the approver"} at revision {last.revision} · {receipt.checks?.length ?? 0} checks passed<br />
            {receipt.warnings?.length ? <>Placed over {receipt.warnings.length === 1 ? "a warning" : `${receipt.warnings.length} warnings`}: {receipt.warnings.join(", ")}<br /></> : null}
            {receipt.checkedBy ? <>Checked by Sona ({receipt.checkedBy})<br /></> : null}
            {receipt.amendment ? `Amends ${receipt.amendment.supersedes}: ${receipt.amendment.reason}. ` : ""}
            A record only: not sent to a pharmacy, not dispensed.<br />
            Request {last.requestId}
          </p>
          <div className="visit-actions"><Button size="sm" icon="arrow-right" to="/pro/visit" search={{}}>Next visit</Button></div>
        </Card>
      ) : null}

      {canPrescribe && reviewed ? (
        <Card>
          {/* Rarely needed, so it waits behind one tap and the order card keeps the eye. */}
          <details className="visit-amend">
            <summary>Amend an order already placed</summary>
            <Field label="Reason for the change" hint="After the visit was edited and reviewed again.">
              {control => <input {...control} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} />}
            </Field>
            <Button disabled={!reason.trim() || blocked.length > 0} pending={amend.isPending} onClick={() => { place.reset(); amend.mutate({ ...command, reason }); }}>
              Amend the order
            </Button>
          </details>
        </Card>
      ) : null}
    </div>
  );
}

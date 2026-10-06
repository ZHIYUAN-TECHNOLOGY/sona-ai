import type { Regimen }from "@sona-ai/domain/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { EmptyState } from "@/components/page";
import { Button, Card, Chip, Field } from "@/components/primitives";
import { orpc } from "@/lib/orpc";

import { orderChecks, refusal, type VisitPatient } from "./visit";

type Payload = Partial<Regimen> & { checks?: string[]; transmitted?: boolean; amendment?: { reason?: string; supersedes?: string } };

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

  if (encounter.isPending) return <EmptyState>Loading the medicine order…</EmptyState>;
  if (encounter.isError) return <EmptyState>{refusal(encounter.error).message}</EmptyState>;
  if (!patient) return <EmptyState>This visit's patient record is not available, so the order cannot be checked here.</EmptyState>;

  const { revision } = encounter.data;
  const proposed = (encounter.data.state as { proposedMedicine?: string }).proposedMedicine;
  const checks = orderChecks(encounter.data, patient);
  const blocked = checks.filter(c => c.status === "blocked");
  const reviewed = shown === revision;
  // One request per revision, so a second tap or a reload returns the same receipt.
  const command = { encounterId, approvedBy: userId, requestId: `web-rx-${encounterId}-r${revision}` };
  const last = amend.data ?? place.data;
  const failed = [review, place, amend].find(m => m.isError);
  const refused = failed ? refusal(failed.error) : undefined;
  const receipt = last?.payload as Payload | undefined;

  return (
    <div className="visit-orders">
      <Card title="Medicine order">
        <p>{proposed || "No medicine has been entered for this visit yet. It is entered on the phone app."}</p>
        <p className="visit-muted">
          {reviewed ? `Reviewed at revision ${revision}.` : "Review the check before placing the order."}{" "}
          {blocked.length ? `${blocked.length} of ${checks.length} checks block it.` : `All ${checks.length} checks pass.`}
        </p>
        {reviewed || !canPrescribe ? (
          <ul className="visit-checks">
            {checks.map(c => (
              <li key={c.id}>
                <Chip tone={c.status === "blocked" ? "soon" : "done"}>{c.status === "blocked" ? "Blocked" : "Passed"}</Chip>
                <span><strong>{c.label}</strong><br />{c.detail}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {canPrescribe ? (
          <div className="visit-actions">
            <Button variant={reviewed ? "quiet" : "primary"} pending={review.isPending}
              onClick={() => review.mutate({ encounterId, expectedRevision: revision })}>
              {reviewed ? "Review again" : "Review the order"}
            </Button>
            {reviewed ? (
              <Button variant="primary" disabled={blocked.length > 0} pending={place.isPending} onClick={() => { amend.reset(); place.mutate(command); }}>
                Place the order
              </Button>
            ) : null}
          </div>
        ) : <p className="visit-muted">Only a doctor can review and place a medicine order.</p>}
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
            {receipt.amendment ? `Amends ${receipt.amendment.supersedes}: ${receipt.amendment.reason}. ` : ""}
            A record only: not sent to a pharmacy, not dispensed.<br />
            Request {last.requestId}
          </p>
        </Card>
      ) : null}

      {canPrescribe && reviewed ? (
        <Card title="Amend an order">
          <Field label="Reason for the change" hint="For an order already placed, after the visit was edited and reviewed again.">
            {control => <input {...control} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} />}
          </Field>
          <Button disabled={!reason.trim() || blocked.length > 0} pending={amend.isPending} onClick={() => { place.reset(); amend.mutate({ ...command, reason }); }}>
            Amend the order
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

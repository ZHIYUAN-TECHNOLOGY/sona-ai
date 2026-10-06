import { useMutation } from "@tanstack/react-query";

import { Button, Card, Chip } from "@/components/primitives";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/patients.css";

const until = (at: Date | string) => new Date(at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** The code a patient types into Sona Care's "Join by code". Issued only on a press, never on load. */
export function JoinCode({ encounterId, patientName }: { encounterId?: string; patientName: string }) {
  const issue = useMutation(orpc.care.code.mutationOptions());
  const first = patientName.split(" ")[0];
  const data = issue.data;

  return (
    <Card title="Sona Care">
      {!encounterId ? (
        <p className="pt-muted">A join code belongs to a visit, and {first} has no visit on record yet.</p>
      ) : !data ? (
        <>
          <p className="pt-muted">A join code links {first}'s Sona Care account to this record.</p>
          <Button variant="primary" pending={issue.isPending} onClick={() => issue.mutate({ encounterId })}>Give this patient a join code</Button>
          {issue.error ? <p role="alert" className="pt-muted">The code could not be issued: {issue.error.message}</p> : null}
        </>
      ) : data.joined ? (
        <p><Chip tone="done">Linked</Chip> {first} has already joined Sona Care with this visit's code. No new code is needed.</p>
      ) : (
        <div className="join-code-print">
          <p className="join-code-for">Sona Care join code for {patientName}</p>
          <output className="join-code" aria-label={`Join code ${data.code.split("").join(" ")}`}>{data.code}</output>
          <p>Open Sona Care, sign in, then enter this code.</p>
          <p className="pt-muted">Valid until {until(data.expiresAt)}. It works once.</p>
          <Button className="join-code-action" onClick={() => window.print()}>Print this code</Button>
        </div>
      )}
    </Card>
  );
}

import { can, type Role } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Card, Chip, Field } from "@/components/primitives";
import { RightRail } from "@/components/rail";
import { orpc } from "@/lib/orpc";
import { LABEL, type Row } from "./rows";

const when = (d: Date | string) => new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The selected check-in: the exchange, what Sona decided, and the actions the caller's role allows. Keyed by check-in, so drafts reset per row. */
export function CheckInRail({ row, role }: { row: Row; role: Role }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.checkIns.key() });
  const followUp = useQuery(orpc.checkIns.followUp.queryOptions({ input: { encounterId: row.encounterId }, enabled: can(role, "checkIns.followUp") }));
  const bookIn = useMutation(orpc.checkIns.bookIn.mutationOptions({ onSuccess: refresh }));
  const record = useMutation(orpc.checkIns.reply.mutationOptions({ onSuccess: () => { setText(""); setReviewing(false); return refresh(); } }));
  const [slot, setSlot] = useState("");
  const [text, setText] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const task = row.reply?.task;

  return (
    <RightRail label="Selected check-in" id="check-in-rail">
      <Card title={`${row.patientName} · day ${row.day}`}>
        <div className="check-ins-exchange">
          <p className="check-ins-muted">Sona asked{row.sentAt ? ` · ${when(row.sentAt)}` : ""}</p>
          <p>{row.message}</p>
          {row.replies.length ? row.replies.map(r => (
            <div key={r.id} className="check-ins-reply">
              <p className="check-ins-muted">{row.patientName} replied · {when(r.receivedAt)}</p>
              <p>{r.text}</p>
              <p className="check-ins-line">
                <Chip tone={LABEL[r.label].tone}>{LABEL[r.label].text}</Chip>
                <span className="check-ins-muted">Read by {r.decidedBy === "rules" ? `the urgent-words rule${r.source === "fixture" ? "" : ` (over ${r.source})`}` : r.source}</span>
              </p>
              {r.task ? <p className="check-ins-muted">{r.task.completed ? "Closed" : "Flagged for the care team"}: {r.task.title}</p> : null}
            </div>
          )) : <p className="check-ins-muted">No reply yet.</p>}
        </div>
      </Card>

      <Card title="What Sona did and why">
        {followUp.isPending && followUp.fetchStatus !== "idle" ? <p className="check-ins-muted">Loading…</p>
          : followUp.isError ? <p className="check-ins-error" role="alert">{followUp.error.message} <Button size="sm" onClick={() => followUp.refetch()}>Try again</Button></p>
          : followUp.data ? (
            <ul className="check-ins-timeline">
              {/* The timeline only grows, and the agent can log the same line twice: the position keys it. */}
              {followUp.data.timeline.map((e, i) => <li key={i} data-tone={e.tone}><span className="check-ins-muted">{when(e.at)}</span> {e.text}</li>)}
              {followUp.data.next ? <li><span className="check-ins-muted">Next · {when(followUp.data.next.at)}</span> {followUp.data.next.text}</li> : null}
            </ul>
          ) : <p className="check-ins-muted">Sona's follow-up has not started for this visit yet.</p>}
      </Card>

      {task && can(role, "checkIns.bookIn") ? (
        <Card title="Book in to clinic">
          <Field label="Clinic time" hint="Leave empty for tomorrow, 09:00 Kuala Lumpur. Within the next 30 days.">
            {control => <input {...control} type="datetime-local" value={slot} onChange={e => setSlot(e.target.value)} />}
          </Field>
          <Button variant="primary" icon="calendar" pending={bookIn.isPending} onClick={() => bookIn.mutate({ taskId: task.id, startsAt: slot ? new Date(slot) : undefined })}>
            {task.completed ? "Move booking" : "Book in"}
          </Button>
          {bookIn.isError ? <p className="check-ins-error" role="alert">{bookIn.error.message}</p> : null}
          {bookIn.data ? (
            <p role="status">
              Booked: {bookIn.data.kind}, {when(bookIn.data.startsAt)}. The flag is closed and {row.patientName} sees it in Sona Care.
              {bookIn.data.toAdd.length ? ` ${bookIn.data.toAdd.length} X-ray follow-up${bookIn.data.toAdd.length === 1 ? "" : "s"} could go on the same trip.` : ""}
            </p>
          ) : null}
        </Card>
      ) : null}

      {can(role, "checkIns.reply") ? (
        <Card title="Record a reply on the patient's behalf">
          {reviewing ? (
            <>
              <p className="check-ins-muted">Review before recording. Sona reads it like any reply: a worse or urgent one is flagged for the care team.</p>
              <blockquote className="check-ins-quote">{text.trim()}</blockquote>
              <p className="check-ins-line">
                <Button variant="primary" icon="check" pending={record.isPending} onClick={() => record.mutate({ checkInId: row.id, text: text.trim() })}>Record reply</Button>
                <Button onClick={() => setReviewing(false)}>Edit</Button>
              </p>
            </>
          ) : (
            <>
              <Field label="What the patient said" hint="For example, from a phone call. Recorded as the patient's reply to this check-in.">
                {control => <textarea {...control} rows={3} maxLength={1000} value={text} onChange={e => setText(e.target.value)} />}
              </Field>
              <Button disabled={!text.trim()} onClick={() => setReviewing(true)}>Review</Button>
            </>
          )}
          {record.isError ? <p className="check-ins-error" role="alert">{record.error.message}</p> : null}
        </Card>
      ) : null}

      <p className="check-ins-line">
        <Button to="/pro/patients/$patientId" params={{ patientId: row.patientId }} icon="users">Open patient</Button>
        <Button to="/pro/messages" search={{ patient: row.patientId }}>Open messages</Button>
      </p>
    </RightRail>
  );
}

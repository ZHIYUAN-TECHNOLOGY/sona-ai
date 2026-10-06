import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { EmptyState } from "@/components/page";
import { Button, Chip } from "@/components/primitives";
import { type client, orpc } from "@/lib/orpc";

import { clock, labelTone, triageBy } from "./format";

type Message = Awaited<ReturnType<typeof client.messages.thread>>["messages"][number];

/** A patient's medicine photo: the reading they checked, the photo on request, and add or decline in place. */
function MedicinePhoto({ message, canResolve }: { message: Message; canResolve: boolean }) {
  const queryClient = useQueryClient();
  const [show, setShow] = useState(false);
  const photo = useQuery(orpc.messages.photo.queryOptions({ input: { messageId: message.id }, enabled: show, staleTime: Infinity }));
  const resolve = useMutation(orpc.messages.resolveMedicinePhoto.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.messages.key() }),
  }));
  const a = message.attachment;
  if (a?.kind !== "medicine-photo") return null;
  const { reading, decision } = a;
  return (
    <div className="msg-photo">
      <p>
        <strong>{[reading.name, reading.dose].filter(Boolean).join(" ")}</strong>
        {reading.frequency ? ` · ${reading.frequency}` : null} {a.sampleReading ? <Chip>Sample photo</Chip> : null}
      </p>
      {photo.data
        ? <img src={`data:${photo.data.contentType};base64,${photo.data.dataBase64}`} alt={`Patient's photo of ${reading.name}`} />
        : canResolve && a.key
          ? <Button pending={photo.isFetching} onClick={() => setShow(true)}>{photo.error ? "Photo didn't load · try again" : "Show photo"}</Button>
          : null}
      {decision
        ? <Chip tone={decision.status === "added" ? "done" : "neutral"}>{decision.status === "added" ? "Added to medicines" : "Declined"} · {clock(decision.at)}</Chip>
        : canResolve
          ? (
            <div className="msg-actions">
              <Button variant="primary" pending={resolve.isPending} onClick={() => resolve.mutate({ messageId: message.id, decision: "add" })}>Add to medicines</Button>
              <Button disabled={resolve.isPending} onClick={() => resolve.mutate({ messageId: message.id, decision: "reject" })}>Not this one</Button>
            </div>
          )
          : <p className="msg-meta">Only a doctor or a nurse adds or declines it.</p>}
      {resolve.error ? <p className="msg-error" role="alert">{resolve.error.message}</p> : null}
    </div>
  );
}

export function Thread({ patientId, canResolve }: { patientId: string; canResolve: boolean }) {
  const thread = useQuery(orpc.messages.thread.queryOptions({ input: { patientId } }));
  if (thread.isPending) return <EmptyState>Loading messages…</EmptyState>;
  if (thread.error) return <EmptyState>Could not open this thread: {thread.error.message}</EmptyState>;
  const { patient, messages } = thread.data;
  return (
    <section className="msg-thread" aria-label={`Messages with ${patient.name}`}>
      <h2>{patient.name}{patient.bed ? <span className="msg-meta"> · Bed {patient.bed}</span> : null}</h2>
      {messages.length ? null : <EmptyState>No messages yet.</EmptyState>}
      <ol>
        {messages.map(m => (
          <li key={m.id} className={m.from === "patient" ? "msg msg-in" : "msg msg-out"}>
            <p className="msg-meta">
              {m.rule ? "Sona · automatic safety message" : m.author} · {clock(m.createdAt)}
              {m.unanswered ? <> <Chip tone={labelTone(m.triage === "urgent" || m.triage === "admin" ? m.triage : "clinical")}>{m.triage ?? "not triaged"}</Chip></> : null}
            </p>
            <p>{m.text}</p>
            <MedicinePhoto message={m} canResolve={canResolve} />
            {m.unanswered ? <p className="msg-meta">{m.triageReason ?? "Not triaged: read it first"} · {triageBy(m.triagedBy)}</p> : null}
            {m.from === "patient" && m.seenAt ? <p className="msg-meta">Seen by care team</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

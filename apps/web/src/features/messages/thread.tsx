import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useState } from "react";

import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/page";
import { Button, Chip } from "@/components/primitives";
import { countOf } from "@/lib/format";
import { type client, orpc } from "@/lib/orpc";

import { clock, triageBy } from "./format";

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

/** "Today", or the weekday and date, for the separators between days of a thread. */
const dayOf = (at: Date | string) => {
  const d = new Date(at);
  return d.toDateString() === new Date().toDateString() ? "Today" : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
};
const timeOf = (at: Date | string) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** How many of the newest messages a thread opens with; the rest wait behind "Show earlier". */
const RECENT = 30;

export function Thread({ patientId, canResolve }: { patientId: string; canResolve: boolean }) {
  const thread = useQuery(orpc.messages.thread.queryOptions({ input: { patientId } }));
  const queryClient = useQueryClient();
  const [all, setAll] = useState(false);
  // Opening a thread marks it seen on the server, so the inbox's unread counts are re-read once it has loaded.
  useEffect(() => {
    if (thread.dataUpdatedAt) void queryClient.invalidateQueries({ queryKey: orpc.messages.inbox.key() });
  }, [thread.dataUpdatedAt, queryClient]);
  if (thread.isPending) return <section className="msg-thread"><EmptyState>Loading messages…</EmptyState></section>;
  if (thread.error) return <section className="msg-thread"><EmptyState>Could not open this thread: {thread.error.message}</EmptyState></section>;
  const { patient, messages } = thread.data;
  // The newest unanswered message carries the triage the header states.
  const open = messages.findLast(m => m.unanswered);
  // "Bed 4B-12" for a bare code; a full place ("Wad 4B Kardiologi, Katil 12") already says what it is.
  const bed = patient.bed ? (/^bed|\s/i.test(patient.bed) ? patient.bed : `Bed ${patient.bed}`) : null;
  const triage = open ? `${open.triage ? `Triage: ${open.triage}` : "Not triaged: read it first"} · ${triageBy(open.triagedBy)}` : "Nothing waiting";
  // A long thread opens on its newest messages, where the one waiting for a reply is.
  const earlier = all ? 0 : Math.max(0, messages.length - RECENT);
  const shown = messages.slice(earlier);
  return (
    <section className="msg-thread" aria-label={`Messages with ${patient.name}`}>
      <header className="msg-thread-head">
        <Avatar name={patient.name} />
        <div>
          <h2>{patient.name}</h2>
          <p className="msg-meta">{[bed, triage].filter(Boolean).join(" · ")}</p>
        </div>
      </header>
      {messages.length ? null : <EmptyState>No messages yet.</EmptyState>}
      <ol>
        {earlier ? <li className="msg-earlier"><Button onClick={() => setAll(true)}>Show {countOf(earlier, "earlier message")}</Button></li> : null}
        {shown.map((m, i) => (
          <Fragment key={m.id}>
            {i === 0 || dayOf(shown[i - 1]!.createdAt) !== dayOf(m.createdAt) ? <li className="msg-day">{dayOf(m.createdAt)}</li> : null}
            <li className={m.from === "patient" ? "msg msg-in" : "msg msg-out"}>
              <p>{m.text}</p>
              <MedicinePhoto message={m} canResolve={canResolve} />
              {m.unanswered && m.triageReason ? <p className="msg-meta">{m.triageReason}</p> : null}
              <p className="msg-meta">
                {m.rule ? "Sona · automatic safety message" : m.author} · <time dateTime={new Date(m.createdAt).toISOString()}>{timeOf(m.createdAt)}</time>
                {m.from === "patient" && m.seenAt ? " · Seen by care team" : null}
              </p>
            </li>
          </Fragment>
        ))}
      </ol>
    </section>
  );
}

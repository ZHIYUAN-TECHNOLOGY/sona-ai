import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/primitives";
import { countOf } from "@/lib/format";
import { client, orpc } from "@/lib/orpc";

import { whenOf } from "./time";

export type BookingRequest = Awaited<ReturnType<typeof client.bookings.list>>[number];

/** The soonest requests shown before "Show all"; a long queue would otherwise bury the rest of the rail. */
const CAP = 5;

/** Booking requests waiting for an answer, soonest first. Each is read in full, then confirmed or declined where it sits. */
export function BookingRequests({ requests, canDecide }: { requests: BookingRequest[]; canDecide: boolean }) {
  const [all, setAll] = useState(false);
  if (!requests.length) return null;
  return (
    <>
      <ul className="today-requests">
        {(all ? requests : requests.slice(0, CAP)).map(r => <Request key={r.id} request={r} canDecide={canDecide} />)}
      </ul>
      {!all && requests.length > CAP ? <Button size="sm" onClick={() => setAll(true)}>Show all {countOf(requests.length, "request")}</Button> : null}
    </>
  );
}

function Request({ request: r, canDecide }: { request: BookingRequest; canDecide: boolean }) {
  const queryClient = useQueryClient();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const decide = useMutation(orpc.bookings.decide.mutationOptions({
    // A confirmed request becomes an appointment, so the day and the week change too.
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.bookings.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.day.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.tasks.list.key() }),
    ]),
  }));

  return (
    <li className="today-request">
      <p className="today-request-who">{r.patientName}</p>
      <p>{r.doctorName}, {r.specialty}</p>
      <p>{whenOf(new Date(r.startsAt))}{r.room ? ` · ${r.room}` : ""}</p>
      {r.reason ? <p className="today-quiet today-reason">“{r.reason}”</p> : null}
      {canDecide ? (
        declining ? (
          <form
            className="today-decline"
            onSubmit={e => { e.preventDefault(); decide.mutate({ requestId: r.id, decision: "decline", note: note.trim() || undefined }); }}
          >
            <label>
              Note to the patient (optional)
              <textarea value={note} maxLength={500} rows={2} onChange={e => setNote(e.target.value)} />
            </label>
            <div className="today-actions">
              <Button type="submit" variant="danger" pending={decide.isPending}>Decline request</Button>
              <Button onClick={() => setDeclining(false)} disabled={decide.isPending}>Back</Button>
            </div>
          </form>
        ) : (
          <div className="today-actions">
            <Button variant="primary" pending={decide.isPending} onClick={() => decide.mutate({ requestId: r.id, decision: "confirm" })}>Confirm</Button>
            <Button onClick={() => setDeclining(true)} disabled={decide.isPending}>Decline</Button>
          </div>
        )
      ) : null}
      {decide.isError ? <p className="today-error" role="alert">{decide.error.message || "That did not go through. Try again."}</p> : null}
    </li>
  );
}

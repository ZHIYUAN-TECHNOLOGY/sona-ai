import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button, Chip, Field } from "@/components/primitives";
import { orpc } from "@/lib/orpc";

import { dayWords, timeWords, whenWords, type Lang } from "./dates";

const STEPS = ["Doctor", "Day", "Time", "Review"];

/** Pick a doctor, a clinic day and a time, review the line, then ask. The care team confirms or declines. */
export function Booking({ lang }: { lang: Lang }) {
  const queryClient = useQueryClient();
  const doctors = useQuery(orpc.care.doctors.list.queryOptions({ input: {} }));
  const [doctorId, setDoctorId] = useState<string>();
  const [dayAt, setDayAt] = useState(0);
  const [time, setTime] = useState<number>();
  const [reason, setReason] = useState("");
  const [dayTouched, setDayTouched] = useState(false);

  const doctor = doctors.data?.find(d => d.id === doctorId);
  const day = doctor?.nextSlots[dayAt];
  // The picked time only counts while the server still lists it as free.
  const slot = day?.times.find(t => t.getTime() === time);

  const request = useMutation(orpc.care.bookings.request.mutationOptions({
    onSuccess: () => { setTime(undefined); setReason(""); setDayTouched(false); },
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.care.bookings.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.care.doctors.list.key() }),
    ]),
  }));

  const step = !doctor ? 0 : !slot ? (time === undefined && !dayTouched ? 1 : 2) : 3;
  const pick = (id: string) => { setDoctorId(id); setDayAt(0); setTime(undefined); setDayTouched(false); request.reset(); };

  return (
    <section className="card fu-book" id="book" aria-labelledby="book-title">
      <h2 className="card-title" id="book-title">Book a visit</h2>
      {doctors.isPending ? <p className="fu-muted">Loading doctors…</p>
        : doctors.isError ? <p className="fu-muted">We couldn't load the doctors. <Button onClick={() => doctors.refetch()}>Try again</Button></p>
        : !doctors.data.length ? <p className="fu-muted">No doctors are listed yet. Message your care team to book.</p>
        : (
          <>
            <ol className="fu-steps" aria-label="Steps">
              {STEPS.map((s, i) => <li key={s} data-done={i < step || undefined} aria-current={i === step ? "step" : undefined}>{i + 1}. {s}</li>)}
            </ol>
            <h3 className="fu-step">1. Choose a doctor</h3>
            <ul className="fu-doctors">
              {doctors.data.map(d => (
                <li key={d.id}>
                  <button type="button" className="fu-doctor" aria-pressed={d.id === doctorId} onClick={() => pick(d.id)}>
                    <strong>{d.name}</strong>
                    <span>{d.specialty} · {d.room}</span>
                    {d.careTeam ? <Chip tone="info">Your care team</Chip> : null}
                  </button>
                </li>
              ))}
            </ul>
            {doctor ? (
              <>
                <h3 className="fu-step">2. Choose a day, then 3. a time</h3>
                {doctor.nextSlots.length ? (
                  <>
                    <div className="fu-pills" role="group" aria-label="Clinic days">
                      {doctor.nextSlots.map((d, i) => (
                        <button key={d.day.getTime()} type="button" className="fu-pill" aria-pressed={i === dayAt} onClick={() => { setDayAt(i); setTime(undefined); setDayTouched(true); }}>
                          {dayWords(d.day, lang)}
                        </button>
                      ))}
                    </div>
                    <div className="fu-pills" role="group" aria-label="Free times">
                      {day?.times.map(t => (
                        <button key={t.getTime()} type="button" className="fu-pill" aria-pressed={t.getTime() === time} onClick={() => setTime(t.getTime())}>
                          {timeWords(t, lang)}
                        </button>
                      ))}
                    </div>
                  </>
                ) : <p className="fu-muted">No free times in the next two weeks. Try another doctor.</p>}
              </>
            ) : null}
            {doctor && slot ? (
              <form className="fu-review" onSubmit={e => { e.preventDefault(); request.mutate({ doctorId: doctor.id, startsAt: slot, reason: reason.trim() || undefined }); }}>
                <h3 className="fu-step">4. Review your request</h3>
                <p className="fu-note" data-tone="info">You are asking for: <strong>{doctor.specialty} visit with {doctor.name}, {whenWords(slot, lang)}</strong>, {doctor.room}.</p>
                <Field label="Reason (optional)" hint="A few words help the care team.">
                  {c => <input {...c} className="fu-input" maxLength={200} value={reason} onChange={e => setReason(e.target.value)} />}
                </Field>
                <p className="fu-muted">Nothing is booked until the hospital confirms it. To change it, pick another doctor, day or time above.</p>
                <Button variant="primary" type="submit" pending={request.isPending}>Confirm request</Button>
              </form>
            ) : doctor?.nextSlots.length ? <p className="fu-muted">Pick a time to continue.</p> : null}
            <div role="status" aria-live="polite">
              {request.isError ? <p className="fu-note" data-tone="soon">{request.error.message || "We couldn't send your request. Please try again."}</p> : null}
              {request.isSuccess ? <p className="fu-note" data-tone="done">Request sent. The hospital still has to confirm it. Until then it shows as "Waiting for the hospital" under Upcoming.</p> : null}
            </div>
          </>
        )}
    </section>
  );
}

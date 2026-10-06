import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button, Card } from "@/components/primitives";
import { orpc } from "@/lib/orpc";

import { daysAfter, hospitalTime } from "./rules";

// ponytail: the four jumps the page was asked for; the API also has "day-1" (the morning dose) and
// "next" (needs a visit, so it belongs on a visit page).
const JUMPS = ["day-2", "day-7", "visit", "now"] as const;
type Jump = (typeof JUMPS)[number];

/** The demo hospital's clock: where it is, and the jumps the latest discharge allows. A jump is reviewed before it runs. */
export function DemoClock() {
  const queryClient = useQueryClient();
  const status = useQuery(orpc.demo.status.queryOptions({ refetchInterval: 60_000 }));
  const [choice, setChoice] = useState<Jump>();
  // The clock moves for the whole hospital, so everything on screen is read again.
  const jump = useMutation(orpc.demo.jump.mutationOptions({ onSuccess: () => { setChoice(undefined); return queryClient.invalidateQueries(); } }));

  const s = status.data;
  const label = (to: Jump) =>
    to === "now" ? "Back to real time" : to === "visit" ? "Clinic review" : `Day ${s?.checkInDays[to === "day-2" ? 0 : 1] ?? (to === "day-2" ? 2 : 7)} check-in`;
  const now = s ? new Date(s.now) : undefined;
  const pick = (to: Jump) => { jump.reset(); setChoice(to); };

  return (
    <Card title="Demo clock">
      {status.isPending ? <p className="settings-muted">Reading the clock…</p>
        : status.isError || !s || !now ? <p className="settings-muted" role="alert">The demo clock couldn't be read. {status.error?.message}</p>
        : (
          <>
            <p className="settings-lead">
              {hospitalTime(now)}
              {s.offsetMs ? ` · demo time${s.dischargedAt ? `, day ${daysAfter(new Date(s.dischargedAt), now)} after discharge` : ""}` : " · real time"}
            </p>
            <div className="settings-actions">
              {JUMPS.map(to => (
                <Button key={to} disabled={!s.available.includes(to) || jump.isPending} aria-pressed={choice === to} onClick={() => pick(to)}>{label(to)}</Button>
              ))}
            </div>
            {choice ? (
              <div className="settings-review">
                <p>
                  {choice === "now" ? "Put the demo hospital's clock back to real time" : `Move the demo hospital's clock to the ${label(choice).toLowerCase()}`} for
                  everyone signed in to it? Any check-in then due is sent, and Sona Care follows at once.
                </p>
                <div className="settings-actions">
                  <Button variant="primary" pending={jump.isPending} onClick={() => jump.mutate({ to: choice })}>{jump.isPending ? "Moving…" : "Move the clock"}</Button>
                  <Button disabled={jump.isPending} onClick={() => setChoice(undefined)}>Cancel</Button>
                </div>
              </div>
            ) : null}
            {jump.isError ? <p className="field-error" role="alert">{jump.error.message}</p> : null}
            {s.dischargedAt ? null : <p className="settings-muted">Discharge a patient first; the jumps count from their discharge.</p>}
          </>
        )}
      <p className="settings-muted">
        Synthetic demo hospital only. This moves the hospital's clock for everyone, in Sona Pro and Sona Care, not just for you.
      </p>
    </Card>
  );
}

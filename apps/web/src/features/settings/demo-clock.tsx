import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { EmptyState } from "@/components/page";
import { Button, Chip, Skeleton } from "@/components/primitives";
import { orpc } from "@/lib/orpc";

import { daysAfter, hospitalTime, offsetText } from "./rules";
import { Section } from "./section";

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
    <Section
      title="Demo clock"
      description="Moves the synthetic demo hospital's clock for everyone, in Sona Pro and Sona Care, not just for you."
      aside={<Chip>Demo only</Chip>}
    >
      {status.isPending ? <Skeleton height={48} />
        : status.isError || !s || !now ? <EmptyState icon="clock" title="The demo clock couldn't be read"><span role="alert">{status.error?.message}</span></EmptyState>
        : (
          <>
            <p>
              The hospital's clock reads <strong className="settings-lead">{hospitalTime(now)}</strong>, {offsetText(s.offsetMs)}
              {s.offsetMs && s.dischargedAt ? ` (day ${daysAfter(new Date(s.dischargedAt), now)} after discharge)` : ""}.
            </p>
            <div className="settings-row">
              <span className="settings-label" id="demo-jump">Jump to</span>
              <div className="settings-jumps">
                <div className="settings-segment" role="group" aria-labelledby="demo-jump">
                  {JUMPS.filter(to => to !== "now").map(to => (
                    <button key={to} type="button" disabled={!s.available.includes(to) || jump.isPending} aria-pressed={choice === to} onClick={() => pick(to)}>{label(to)}</button>
                  ))}
                </div>
                <Button variant="secondary" disabled={!s.available.includes("now") || jump.isPending} aria-pressed={choice === "now"} onClick={() => pick("now")}>Back to now</Button>
              </div>
            </div>
            {/* The jumps count from a discharge; say so instead of leaving them disabled with no reason. */}
            {!s.dischargedAt ? <p className="settings-label">The check-in and review jumps open once a patient at this hospital is discharged.</p> : null}
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
    </Section>
  );
}

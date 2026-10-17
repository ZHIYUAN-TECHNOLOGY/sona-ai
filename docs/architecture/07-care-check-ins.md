# 07 · Sona Care check-ins and care-team tasks

[Diagram](07-care-check-ins.html) · [SVG](07-care-check-ins.svg) · [PNG](07-care-check-ins.png) · [source](07-care-check-ins.archify.json)

**Answers:** what happens after discharge, and how a patient's reply becomes work for the care team.

## What it shows

- **Discharge** (`discharge.request`, doctor only) schedules check-ins at 10:00 MYT on the chosen days (defaults by condition, for example pneumonia days 2 and 7; `packages/domain/src/check-ins.ts`) and calls the agent's `tick`.
- **CheckInAgent** (`apps/server/src/agents/check-in.ts`), one Durable Object per discharged visit, runs one tick at a time: sends due check-ins as Expo pushes, then acts on `decideFollowUp` (`packages/domain/src/check-in-agent.ts`) and sets its next alarm. Ticks also come from every reply, the hourly cron (`0 * * * *`, `wakeFollowUps`), a demo-clock jump and `checkIns.tick`.
- **Reply** (typed or spoken) is labelled `fine`, `worse` or `urgent` by Gemma with a rules floor: if the red-flag words say urgent, it is urgent (`packages/api/src/chat-models.ts`).
- **worse or urgent** creates a check-in task owned by "Attending doctor" (a repeat of the same open title is reused). **urgent** also posts the 999 message as Sona in the care-team thread and sends a `call-999` push, once.
- **Book in** (doctor) creates the appointment, completes the task and pushes `booked`.

## Agent decisions (`decideFollowUp`)

- Re-ask the latest check-in when it has had no reply for 2-24 h.
- After a worse reply, bring a check-in forward to tomorrow if none is due by then.
- Replies older than 24 h are logged, not acted on. Timeline kept to the last 40 entries.

## Demo clock

`hospitals.clock_offset_ms` shifts "now" for every route (`packages/api/src/clock.ts`). `demo.jump` (demo hospital only) moves to day 1, the first or second check-in day, the review visit, or the agent's next action, then wakes follow-ups and announces `demo` to every linked patient; Sona Care reads the offset with `care.clock`.

## Known limits

- Tasks are always owned by "Attending doctor"; there is no nurse-specific routing yet, though nurses can list and complete them.
- A patient with no registered push token gets no push: the check-in is still marked sent and waits in the app, and the re-ask is logged as "no phone registered to ask again".

Checked against code at `cd76571b` on 8 Oct 2026.

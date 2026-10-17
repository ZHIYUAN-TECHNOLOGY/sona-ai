# 05 · Guarantee letter to discharge

[Diagram](05-guarantee-letter.html) · [SVG](05-guarantee-letter.svg) · [PNG](05-guarantee-letter.png) · [source](05-guarantee-letter.archify.json)

**Answers:** the states a claim moves through, who moves it, and what blocks sending and discharge.

## States (`claims.status`, `packages/db/src/schema/clinical.ts`)

`sent | approved | queried | denied | appealed`. `draft` is not stored: `claim.status` returns it when no row exists.

| Transition | Who | Code |
| --- | --- | --- |
| draft, queried or denied → `sent` | Doctor, `claim.send` | refused unless every open criterion is met and a doctor approves; a new 7-day link each send (`routers/claim.ts`) |
| `sent` or `appealed` → `approved` | Insurer, on the link page | also marks the stay's GL row `received` (`packages/api/src/insurer.ts`) |
| `sent` or `appealed` → `queried` | Insurer | needs the question text |
| `sent` or `appealed` → `denied` | Insurer | must pick PEC, MED, DOC or COV |
| `denied` → `appealed` | Doctor or management, `claim.appeal` | every point must cite a note sentence; a new link |
| any other | Insurer | "Already decided"; an expired link is refused |

## Send checklist (`packages/domain/src/claim.ts`)

Criteria are read on the server against the saved note plus what the visit recorded (`letterNote`, `insurer.ts`): the chest X-ray as Sona Vision read it, and the chart's CURB-65 when the note is about pneumonia.

- Severity score documented (CURB-65, CRB-65, qSOFA, NEWS).
- Imaging **result** attached (an order such as "X-ray to check for pneumonia" does not count).
- Diagnosis confirmed (applies to pneumonia; "possible" or "to rule out" does not count; the doctor can confirm it only once the visit's X-ray has been read).
- Organism documented (pneumonia).
- Reason for IV antibiotics (when IV is mentioned).

## Discharge readiness (`packages/domain/src/discharge.ts`)

A check appears only when the record can answer it: vitals within limits (temp ≤ 37.8, pulse ≤ 100, resp ≤ 24, systolic ≥ 90, SpO₂ ≥ 90), GL received (stays with a GL), medicines confirmed, follow-up chosen, no open finding, no pending lab or transport wait. `discharge.request` (doctor only) then creates tasks, schedules check-ins at 10:00 MYT, sets `dischargedAt`, approves the leaflet and starts the check-in agent ([07](07-care-check-ins.md)).

## Live updates

Every write announces a topic on the hospital's `HospitalChannel` (and on `patient:<id>` for that patient's Sona Care); the insurer's POST announces `claim`, so the letter page updates within a second on Sona Pro iPhone and web.

## Known limits

- No amount is sent (`estimateCents = 0`); `insurer_criteria` rows exist but the keyword rules are used.
- The insurer page checks expiry against real time while `sentAt` uses the demo clock; a demo-clock jump can make a link look older or younger.
- A self-pay stay has no GL row and no GL check.
- Synthetic insurer; no real payer integration.

Checked against code at `cd76571b` on 8 Oct 2026.

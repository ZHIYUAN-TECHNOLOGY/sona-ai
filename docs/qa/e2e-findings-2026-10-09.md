# End-to-end findings, 8 to 9 October 2026

From the first full e2e suite (`e2e/`, see its README) on a Neon branch of staging with the SageMaker models live.
Each finding has a test written for the correct behaviour, skipped with a reason that starts `BUG:` (or `DECIDE:`
where the intended behaviour needs a product call); fixing the app
and removing the skip turns it into a regression test.

## Sona Pro, web

1. **Sona's panel on a patient page does not read the page.** It says "Sona reads this page with you", but
   `apps/web/src/features/patients/patient-overview.tsx` registers neither `useVisitAsk` nor `useSonaContext`. With
   SpO₂ 97 % on screen, the model answered that it had no oxygen data.
2. **A general evidence question shows a patient's film.** "CURB-65 of 2: admit or treat at home?" returned "Chest
   X-ray: Amelia Tan" as source 1 and opened the film. Library search has no relevance floor
   (`packages/api/src/routers/evidence.ts:76`, a known limit), and X-ray reads always lead the sources (`:135`).
3. **The ambient scribe ends on the sample draft.** Both tries: "Revision 1 · Sample draft" after about 110 s, while
   the same model answered everywhere else. `scribe-model.ts:196-206` waits up to 90 s and turns any error or refused
   draft into the rule-based sample.
4. **A free question on Today is mostly answered by rule.** 4 of 5 tries came back "Sona · rules" with the generic
   "2 patients need you" line: `ask-model.ts:111-122` drops a model reply that fails the grounding check.
5. **Tasks points at a control that does not exist.** With no tasks it says "Add the first one from the patient's
   page"; the patient page has no add-task control (`routes/pro/_app/tasks.tsx:49,135,146`).

## Sona Care, web

6. **A wrong sign-in code shows "Invalid OTP"**, the server's text, instead of the page's own line
   (`apps/web/src/routes/care/sign-in.tsx:47`).
7. **A short join code shows "Input validation failed"** (`routes/care/join.tsx:19`; the server refuses codes under 8
   characters, `packages/api/src/routers/care.ts:45`), instead of the page's plain fallback (`join.tsx:39`).
8. **Decide: after discharge she reads a sample leaflet, not the approved one.** Web and phone pick the leaflet by the
   app's language (`routes/care/_app/discharge-plan.tsx:26,45`, `apps/care/app/discharge.tsx:50-51`); the doctor
   approved it in Malay, so English gets the authored text ("Sample leaflet" on the web). `apps/care/lib/i18n.ts` says
   the plan's language should win. Skipped with `DECIDE:` until the intended rule is chosen.
9. **After discharge, "Choose a photo" on Medicines is 46 px tall**, under Care's 48 px floor
   (`features/care-medicines/photo.tsx:110`).

## Sona Care, iPhone

10. **Same wrong-code message** as 6: "Invalid OTP" or "OTP not found" (`apps/care/features/sign-in/welcome.tsx:310`).
11. **The keyboard covers "Sign in" on the email step**: keyboard avoidance is off for that step
   (`welcome.tsx:133`), so a tap lands on the keyboard.
12. **The sample medicine photo never reaches the model**: "Use the sample photo" sends no image
    (`features/doses/photo.tsx:98`), the server answers from stubs (`packages/api/src/routers/care.ts:186`), and the
    result is labelled "Sample · photo reading model not switched on" although the models are up.

## Sona Pro, iPhone

13. **The app crashes around the sidebar.** Expo Go aborted twice (22:29 and 23:26 on 8 Oct) on an uncaught
    JavaScript error thrown inside a Reanimated/worklets animation-frame callback on the main thread, both times as
    the sidebar opened or closed. Not reproducible on demand, so no test is skipped for it. Crash reports:
    `~/Library/Logs/DiagnosticReports/Expo Go-2026-10-08-222919.ips` and `…-232616.ips`.
14. **Unconfirmed: "Who opened this record" shows each line twice**, and its clock times do not fit "just now"
    ("10:01, just now" read at about 22:23).

## Test-environment notes

- Expo Go's floating Tools button covers top-right controls (New chat): switch it off once per simulator.
- Every suite signing in as Amelia shares the demo phone's single stored code; parallel phone sign-ins can collide.
- Today, Visit and Schedule depend on the clock: `bun run reset` re-times the seeded visits to 15 and 45 minutes ahead.

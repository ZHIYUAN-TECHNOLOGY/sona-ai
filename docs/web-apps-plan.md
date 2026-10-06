# Web versions of Sona Pro and Sona Care: plan

Status: approved by the owner on 6 Oct 2026. Phases 1 to 4 are built on `feat/web-apps` (6 Oct) and every page
was walked in a browser as each role against a local Worker on a Neon branch, with the model keys blank. Not done:
phase 5 on staging with the real models, the two new migrations on staging (`care_readings_visit_prep`,
`visit_summaries`), a deploy, and the patient phone-code sign-in, mic and live voice call in a real browser.
How to build a page: `apps/web/README.md`. This worktree (`feat/web-apps`) is the orchestrator: it splits the work
into worktree subagents by dependency and merges their branches.

References (screenshots only, layout and feature ideas, not our look):
- Sona Pro: `/Users/ngchwanlii/Documents/sona-ai/reference-uis/ai-clinician` (11 screens)
- Sona Care: `/Users/ngchwanlii/Documents/sona-ai/reference-uis/ai-patient-portal` (12 screens)

Read first: `docs/handoff.md`, `docs/design-direction.md` (UX principles are standing rules).

## Architecture

- One new app, `apps/web`: Vite, React, TanStack Router and Query. Sona Pro at `/pro`, Sona Care at `/care`.
- Served from the existing server Worker (`apps/server`, `packages/infra/alchemy.run.ts`), same origin, so the
  better-auth cookie works for `/rpc` and for the WebSockets (`/live`, `/agents/sona-voice-agent/:id`) with no CORS change.
- Reuse the typed oRPC client, `packages/domain`, `packages/api/src/roles.ts`, better-auth (email and password
  for clinicians, phone code for patients).
- Do not touch `apps/native` or `apps/care`. Do not port them with Expo web: 17 Skia files, iOS glass,
  SwiftUI controls, Vision Camera and `react-native-audio-api` do not run in a browser, and the layouts are phone layouts.

## Design

- Each app's tokens become CSS variables: Pro from `apps/native/components/sona/theme.ts` (canvas `#F5F6F8`,
  ink `#1D1F23`, blue `#245BCC`), Care from `apps/care/lib/theme.ts` (Plus Jakarta Sans, canvas `#FAFAFA`).
- Layout from the references: left sidebar (grouped by kind of work, shown per role), a row of insight cards,
  a main table or detail area, a right rail.
- The references' blue AI card becomes our insight card: one lead line, one suggested next step,
  "you decide · N sources".
- Colour carries meaning only: red must-not-miss, amber soon or blocked, teal `#0F6E66` done or safe, blue next step.
- Pro: letter avatars, no stock photos. Care: body text 17 px or larger, tap targets 48 px or larger,
  red only for "call the hospital now".
- Liquid glass becomes a CSS gradient and backdrop blur; halftone is a rare accent.
- Sona bar at the bottom of every page: type, or hold the mic (browser records 16 kHz WAV for `voice.transcribe`).
  Answers appear in the page. No separate Live screen, no sheets.

## Phases

1. Foundation (one agent, first): scaffold, hosting from the Worker, sign-in, tokens, page frame, sidebar per
   role, Sona bar, shared table, chart (SVG line and bar) and insight-card components.
2. Pro pages (parallel): Today and week schedule; Patients and patient overview; Visit (scribe, note,
   medicine orders); Messages and review queue; Results; Ward, handover and tasks; Discharge, guarantee letter
   and audit; Library, X-ray and training data; Settings.
3. Care pages (parallel): Home; Follow-ups and booking; Medicines and doses; Care team and messages;
   Ask Sona including the live voice call in the browser; Discharge plan and check-ins; Join by code.
4. Gap features that need new API (below).
5. Verify each role end to end in a browser on staging with the real models.

Estimate: 4 to 5 days with parallel worktree agents. Not ready for the 8 Oct demo.

## Gap decisions (approved)

Build, Sona Pro:
- Review queue: one place to approve anything a patient will read, with numbered sources and automatic checks.
- After-visit summary in plain words, sent to the patient when the note is signed.
- Medicine orders to review beside the note (`prescribing.simulate`, `amend`). No lab or referral orders.
- Week calendar with open slots (`bookings.slots`, `appointments`).
- Patient overview trend cards and a 12-month lab chart (`observations`, `lab_results`).
- Results triage: priority, "Acknowledge normal", "Why this is urgent".

Build, Sona Care:
- Lab results page with "what this result means" (needs a patient-facing results procedure).
- Plain-words visit summary with "what changed" (reuses the after-visit summary).
- Visit prep: share readings and questions, "what the doctor will see" (feeds the Pro briefing).
- Home readings log and weekly chart (patients cannot write `observations` today).
- Month calendar of visits. Download PDF (browser print). Add to calendar (`.ics`).

Skip: care-plan goals with progress %, "Shorter" and "Warmer tone" on drafts, Export, Add patient, video
visit, email and text reminders, insurance and copay, doctor credentials page, interpreter toggle.

## Other decisions

- Camera features on web (scan a paper note, medicine photo, library scan): file upload plus webcam capture,
  without the phone's crop tool.
- Paid model servers for phase 5 testing: allowed, but ask for approval before each paid job.
- The 8 Oct demo flow must stay real: no mocks or simulated steps.

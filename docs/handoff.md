# Sona AI handoff

Updated 24 September 2026. Prepared for Claude Opus 5.5 or another continuing agent.

## Start here

1. Continue in `/Users/ngchwanlii/zyt/projects/sona-ai`. Inspect `git status --short` before editing. All work so far is committed on `main` and pushed to the private repo `github.com/zyt-ngchwanlii/sona-ai`. Preserve any uncommitted work you find.
2. Read [implementation status and verification](ui-implementation-progress.md), then [the walkthrough](ui-walkthrough.md). The previous Codex UI goal is complete; that means implemented and ready for user review, not user acceptance or live AI completion.
3. **UI feedback in progress (24 Sep 2026):** reviewed and approved piece by piece: the Monogram-style home, voice interaction (aurora glass veil, aurora orb, living status glyphs, tap-or-hold), keyboard-synced glass chatbox, attachments menu, workspace sidebar, top bar (tasks button + in-encounter patient chip), the glass-first design system (90% glass, 10% dithering; `components/sona/ui.tsx`, `motion.ts`) and the rebuilt Follow-up tasks screen (sentence card with `@owner` / date parsing, endless day ruler with native picker, tap-to-complete rows, worklist across visits). See [design direction](design-direction.md#design-system-glass-first-dithering-as-accent-2026-09-24). All seven capability answers are now rebuilt as generated sections on the design system (scribe/note, reasoning, X-ray, medication and prescribing were built in parallel by worktree subagents and merged on 24 Sep). Done since: shared parts promoted to `components/sona/parts.tsx`, section landmarks with grouped sources (one pill per section, fit-to-content sources sheet), and a VoiceOver/Reduce Motion/hit-target pass on the shell and tasks; the blocked prescribing run was reviewed on the simulator. Still pending: whole-UI acceptance, and release-build frame-time and VoiceOver checks on the physical iPhone (sidebar escape gesture, task row "Open source" action, due-date readout beside the native picker, status announcements).
4. Help the user review the running app and address their concrete visual/interaction feedback. The UI is not yet accepted.
4a. **Navigation rework agreed on 29 Sep 2026.** Read [information architecture and Sona on every page](design-direction.md#information-architecture-and-sona-on-every-page-2026-09-29) and open the [prototype](prototypes/sona-navigation-rework.html). Pass 1 (grouped sidebar, Continue capped at 3, titles matching the sidebar) is built; pass 2 (`Page` primitive) is next.
5. **Backend plan agreed on 25 Sep 2026.** It runs in parallel with UI review; leave `apps/native` UI files to the UI track. Read the [delivery plan](delivery-plan.md) for models, hosting (Baseten Dedicated, 3×L4, US, synthetic data only), fine-tuning, sequence, cut order and costs. The research is in `docs/research/`. The deadline is one to two weeks from 25 Sep. The next step is day-1 deployment and baselines. **Manglish STT training plan agreed on 27 Sep 2026:** read the [ASR training plan](asr-training-plan.md); its next step is the Stage 0 engine check.

Completion of this handoff means understanding the current app, opening the correct preview when requested, preserving existing work, and continuing the user's next requested change. Rebuilding the scaffold or repeating the entire planning conversation is unnecessary.

## Accepted product and visual direction

Clinician/hospital B2B iPhone assistant for the healthcare competition: ambient documentation, intelligent workflows, triage support and hospital operations with privacy-focused open-weight models.

- One conversational workspace with automatic capability routing. The current router and responses are fixtures; arbitrary natural-language understanding is a backend task.
- Seven capabilities: briefing/timeline including medical/family/social history; ambient scribe and editable note; clinical possibilities with evidence/gaps; chest X-ray; medication interactions; autonomous synthetic prescribing; follow-up tasks.
- Autonomous prescribing intentionally has no clinician approval gate in the supported synthetic case. It still blocks missing inputs/stale checks, records sources and creates an immutable simulation receipt. Preserve that accepted behavior.
- Monogram-first liquid glass, pale grey canvas, subtle blue wash replacing the supplied Oria pink, charcoal type and selective Arc progress/source effects. Read [design direction](design-direction.md) and [UI specification](ui-specification.md) before changing the design. Supplied PNGs are in `docs/references/`.
- English baseline, bounded Malay/English/Mandarin Manglish demonstration. Current dialogue is scripted; real STT/TTS/S2S and code-switching capability have not been demonstrated.
- Baseten cloud is the intended inference platform, with hybrid deployment later. MedGemma is intended for medical/multimodal work; Gemma 4 is a candidate to evaluate, not a deployed model. Unsloth is intended for potential training. Budget was described as ample. Deployment, privacy/compliance and model capability still need actual evaluation.

For feature details, consult [PRD](prd.md), [storyboard](demo-storyboard.md) and [fixture plan](ui-fixture-plan.md) as needed. Proposed hospital ops demo flows (discharge, guarantee letter, ward view, evidence answers) are ranked in [ops demo flows](research/ops-demo-flows.md).

## What exists and where

| Area | Location / key boundary |
| --- | --- |
| Native routes and shell | `apps/native/app/`; `features/encounter/workspace-screen.tsx` |
| Grey/blue glass, typography, motion | `apps/native/components/sona/` |
| Encounter state, fixtures, revisions, request/action lifecycle | `apps/native/features/encounter/` |
| History, reasoning, reconciliation, bounded interactions, synthetic prescribing | `apps/native/features/clinical/` |
| Recording sample, transcript/English edits, structured note | `apps/native/features/scribe/` |
| Licensed original radiograph, viewer, attachment/analysis states | `apps/native/features/imaging/` |
| Plan proposal, native owner/date form, task lifecycle and source snapshot | `apps/native/features/tasks/` |
| Actual json-render catalogue, registry and validation | `apps/native/features/presentation/` |

JSON controls allowlisted native composition. Patient/encounter identity, clinical state, callbacks and action status remain app-owned. Preserve stable stream element IDs, source checks, cancellation and revision guards. Read the [presentation adapter notes](../apps/native/features/presentation/README.md) before changing this boundary. JEV-style composition has been adopted for the backend. The published `@json-render/core` 0.21.0 already exports `experimental_composeSpec`; pin that exact version. Its `evaluate` function is a self-hosted Laya server, not Vercel's hosted model. See [UI composition research](research/ui-composition.md).

The backend foundation is built and deployed (26 Sep 2026): shared rules in `packages/domain`, contracts in `packages/api/src/contracts.ts`, the clinical schema and seed in `packages/db`, hybrid retrieval in `packages/retrieval`, and login-protected routes for encounters, discharge, claims, the ward, the coding audit and tasks in `packages/api/src/routers`. Model calls are stubbed until the Baseten boxes (lane B) come off hold. **Live backend mode** (26 Sep): in Settings, sign in as the synthetic test doctor (`TEST_DOCTOR` in `packages/db/src/seed.ts`) and switch on **Use the live backend**; the switch survives reloads. Discharge, the guarantee letter, Bed 6's ward owners and the coding audit then read and write the server (`apps/native/features/live`); every other screen stays on fixtures until wave 3 in the [delivery plan](delivery-plan.md#sequence). **Demo clock and live Sona Care** (27 Sep): in live mode, Settings has a Demo clock card that jumps the demo hospital's server time to the day-2 check-in, day 7 or the clinic review (counted from the latest discharge) and back (`demo.status` / `demo.jump`, offset in `hospitals.clock_offset_ms`, read by every route through `clockOf`). Sona Care opens its own live socket (`/live` joins `patient:<id>`, which only hears changes about that patient) and follows the offset (`care.clock`, `apps/care/lib/clock.ts`), so a jump or a doctor's write shows on the patient's phone within a second. **Speaking to Sona Care** (27 Sep): patients can speak instead of typing (Ask Sona Care mic, hands-free voice mode that answers aloud and listens again, "Say it instead" on the check-in reply). Audio is recorded as 16 kHz WAV (`apps/care/lib/listen.ts`), sent to `care.transcribe`, and questions the authored answers do not cover go to `care.ask` (answers from the patient's own plan only). Both sit on the model seam (`Models.transcribe`, `Models.answerFromPlan`); no model is hosted yet, so speaking says "isn't switched on yet" and answers fall back to the authored ones. A tested Workers AI adapter (Whisper + SEA-LION v4) is in `packages/api/src/workers-models.ts`, not wired in. Run the Worker locally with `cd packages/infra && bun run dev` (the app's `EXPO_PUBLIC_SERVER_URL` points at `localhost:3000`). Verified on the simulator end to end, including server refusals, a reload mid-flow and owners read back; follow paths 14–20 in the [golden paths](qa/sona-golden-paths.pdf). Clinical terms are colour-coded by one rule set (`apps/native/components/sona/marked-terms.ts`); the key is in Settings. Keep synthetic labels accurate.

**Diagrams** (open in a browser; sources beside them as `*.archify.json`, rendered with the archify skill): [infrastructure](diagrams/sona-infra.html) and [continuous training loop](diagrams/continuous-training.html).

**Staging** (synthetic data only):
- Worker: https://sona-ai-server-staging-uxfqzyce5rxhzsju.zhiyuantech.workers.dev (health check `POST /rpc/healthCheck`; clinical routes need a login).
- Database: Neon project `sona-ai-staging` in Singapore (`aws-ap-southeast-1`), database `sona`. Its connection string lives only in the gitignored `apps/server/.env` and the Worker's encrypted settings.
- Update it from the repo root: `bun run db:migrate`, then `bun run db:seed` (safe to rerun), then `bun run deploy`, which always targets the `staging` Alchemy stage. Alchemy reads `CLOUDFLARE_ACCOUNT_ID` from the saved profile in `~/.alchemy/config.json`; if its Cloudflare login lapses, rerun `bunx alchemy profile refresh --profile default --provider Cloudflare` in a real terminal.

## Preview without disturbing other projects

At handoff, Sona's Metro endpoint responded at `http://127.0.0.1:8088/status`. This is a historical observation, so check again. Reuse it only after verifying the listening process belongs to this project's `apps/native` directory. If another project owns the port, choose a free port and use that port consistently in Metro and the Expo URL; leave the other process running.

The current preview device is iPhone 18 Pro Max, iOS 27.0, UDID `409FA8ED-3EF5-49BB-B727-B9883BEE1F27`, driven with agent-device session `sona18` (Expo Go was installed on it from the iPhone 17 Pro bundle). The earlier iPhone 17 Pro (`A98E7DA8-…`) was taken over by another project (`bible-alarm`, Metro on 8081); leave it alone. Target the exact device and preserve other simulator sessions. The last verified app state had Amelia selected with her saved note/task retained and the keyboard dismissed.

**Visibility gotcha:** this Xcode installation has Device Hub at `/Applications/Xcode.app/Contents/Applications/DeviceHub.app`, rather than `Contents/Developer/Applications/Simulator.app`. An agent-device iOS `open --foreground` successfully opens the app inside the simulated phone but did not surface its desktop window. Even `--device-hub` alone did not resolve that in this session. The native macOS `open` command in the walkthrough did. The visible window title is `iPhone 17 Pro – iOS 26.5`; Device Hub's bundle identifier is `com.apple.dt.Devices`.

Agent-device desktop app discovery did not find the nested Device Hub bundle. Verify the actual desktop window before claiming it is visible; a successful iOS snapshot only proves the simulated app is running. Leave the app open when the user wants to explore it, since `agent-device close` closes the app.

Read [walkthrough run instructions](ui-walkthrough.md#run) for exact launch commands. Avoid the scaffold-wide `bun run dev` or database/infra setup merely to preview this UI.

## Verification and fixes to preserve

Last implementation verification: **47 Bun tests** (24 Sep 2026), native TypeScript and whitespace checks passed. Core simulator checks exercised sources, X-ray original/zoom/reset, reconciliation, blocked/automatic prescribing, English recording/correction, structured note save, plan-to-task create/complete/reopen, archived source provenance, patient isolation, keyboard scrolling and live large-text reflow. Read [verification notes](verification/README.md) before treating historical screenshots as current proof.

Physical iPhone/release performance, VoiceOver and exact runtime Reduce Motion/Reduce Transparency toggles remain unverified. Reactive reduced-effects support is implemented and code-reviewed. Earlier Manglish playback was exercised, but it was not rerun in the final audit. Not every recovery case received a fresh end-to-end device run. High host load caused some XCTest timeouts even when the action had applied; inspect the resulting state before retrying.

Preserve these fixes:

- The outer response container uses a noncollapsible native View. Animating its automatic height caused overlapping content and stale touch bounds. Pulse/reveal/source crossfade remain inside it.
- Shared native text remeasures on font-scale changes; removing this workaround reproduced clipped labels after live Dynamic Type changes.
- Amendment orchestration and unfinished proposed-medication drafts live in encounter/provider state, so compact-response unmounts cannot discard them.
- Generated assessment/plan fields are empty; legacy placeholder text cannot become a clinician-authored task. Current plan drafts, including deliberate clearing, take precedence over saved sections.
- Previous prescription, patient/image and task-source snapshots retain their originating context. Current edits invalidate stale checks without rewriting earlier receipts.

For changes affecting these behaviors, run the affected tests and relevant simulator interaction. The established full native test command, from `apps/native`, is:

```sh
bun test features/encounter/state.test.js features/scribe/model.test.js features/tasks/state.test.js features/clinical/interaction-lookup.test.js features/presentation/catalog.test.js features/imaging/zoom.test.js
```

Use the package's `check-types` script for the native/API type dependency build. Documentation-only handoff edits do not require repeating runtime tests.

## Tools and working scope

`apps/native/src/env.ts` is untracked, so new git worktrees lack it and `check-types` fails there until it is linked or copied from the main checkout.


The user requested agent-device for mobile interaction; use its installed skill. For additional motion inspiration, use 60fpsdesign search/detail/breakdown/code/related-shot tools when available, translating SwiftUI references into React Native. Relevant requested skills include emil-design-eng, animate-expo, global-dev-toolkit:animations, expo-native-ui and react-native-best-practices. Discover what the new session actually exposes; previous MCP availability does not guarantee the same tools in Claude.

The implementation used native subagents with separate feature ownership in this same worktree. Follow the current host's delegation and managed-workspace rules if further parallel work is requested. This document prepares a handoff; it does not itself launch a Claude session or authorize backend provisioning.

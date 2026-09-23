# Eighteen-day delivery plan

Status: proposed allocation for review, 2026-09-22. Days are relative to the confirmed start; exact deadline and daily available hours are not yet known. This is an ambitious, bounded competition prototype schedule, not a delivery guarantee.

## Sequence and checkpoints

| Days | Work | Reviewable outcome |
| --- | --- | --- |
| 1–2 | Review PRD, storyboard, treatment boundary and data dependencies; settle initial tokens from supplied screenshots | Agreed scope and screen/component/state map; clear evidence-source dependencies |
| 3–4 | Build the iPhone shell, patient context, liquid-glass composer, blue ambient treatment and basic response components | One polished briefing interaction with simulated streaming |
| 5–7 | Build recording, reasoning, X-ray viewer, medication review, simulated prescription, note editing and task proposal UI | Entire encounter navigable with synthetic fixtures, including blocked prescribing states |
| 8–9 | Complete failure/edit/cancel states, keyboard behaviour, accessibility and physical-device motion review | User-reviewed UI completion checkpoint |
| 10–11 | Establish validated backend tools and Baseten deployment; verify Gemma/MedGemma streaming and image preprocessing | First actual briefing and X-ray response through the existing UI contracts |
| 12–13 | Integrate STT/diarization; compare English and code-switched fixtures; connect note generation and contextual reasoning | Real captured input flows into sourced draft results; speech limitations documented |
| 14–15 | Integrate bounded drug/regimen evidence, prescribing checks, simulated prescription creation and task persistence; complete all seven capabilities end to end | Full fictional encounter with real inference, explicitly simulated prescribing and stored follow-up work |
| 16 | Run held-out workflow evaluations, integrity checks and measured timing; fix failures introduced by integration | Evaluation notes, known limitations, stable candidate build |
| 17–18 | Buffer for critical fixes, release-device verification, rehearsal, backup video and pitch preparation | Repeatable iPhone demonstration and accessible submission artifacts as required |

Respect the user's order: plan → UI completion → backend. Do not begin a hidden backend implementation or paid model deployment during the UI phase. Read-only documentation and data-access research can clarify dependencies while UI work proceeds.

The initial research and design conversation has already taken time. Rebase this allocation against the actual remaining days before implementation. If a milestone slips, surface the effect on the plan; do not silently remove required capabilities or represent an unfinished capability as complete.

Autonomous prescribing adds regimen sourcing, patient-eligibility checks, simulated issuance and evaluation to the original scope. The day allocations above are provisional and have not been re-estimated from implementation evidence. Treat prescribing-data access as an early planning dependency; the additional scope increases schedule risk even with ample GPU budget.

## Existing foundation to reuse

- `apps/native`: Expo 57 / React Native 0.86 with Expo Router, Reanimated, Worklets, Gesture Handler and @expo/ui already declared.
- `apps/server` and `packages/api`: Hono/oRPC scaffold for application tools and schema validation.
- `packages/auth` and `packages/db`: existing authentication/database foundations, whose actual behaviour still needs inspection during implementation.
- Cloudflare infrastructure scaffolding can serve the application layer; GPU inference belongs on the selected Baseten deployments.
- json-render, Skia, audio, glass and other integration dependencies need compatibility checks before installation. Verify current official APIs; imported skill examples may target different package versions.

This plan is grounded in README/manifests only. No build, runtime, deployment or package-compatibility verification has yet been performed for this planning task.

## UI-to-backend boundary

Specify request, patient/encounter identity, tool progress, partial result, completion, cancellation and error events before implementing the UI. Use fixtures that conform to the same domain-result schemas. Separate result data from presentation specifications; make the stream adapter replaceable so integration does not require redesigning screens.

UI acceptance checkpoint: all seven storyboard scenes can be completed with fixtures, important states are covered, reading/editing remains stable while streaming, and the agreed liquid-glass/grey/blue direction is visible on the demonstration iPhone. The user reviews this result before the project switches to backend work.

## Model evaluation strategy

Start with the documented candidates in the PRD, not every possible model. Compare quality, usable-result latency, valid tool calls and integration cost. Sufficient budget permits a larger model or dedicated capacity when measurements justify it; it does not eliminate engineering time.

Allocate the first speech session to baseline comparison rather than training. Build a small development and held-out collection from fictional English, Malay-English, Mandarin-English and three-language conversations. Measure critical fact preservation and speaker attribution separately. Only propose fine-tuning once a reproducible weakness and suitable data are identified. Unsloth compatibility with the selected model/training task must be checked before promising a training path.

If speech results are inadequate, keep correction visible and report the limitation. An honestly labelled narrow demonstration is acceptable evidence of a prototype; it is not proof of broad Manglish clinical support.

## Dependencies that can affect delivery

| Dependency | Required resolution | Response if unresolved |
| --- | --- | --- |
| Drug-interaction evidence | Usable source, permitted access, declared pair coverage | Propose an explicitly bounded sourced fixture set for review; do not substitute unsourced model recall |
| Prescribing evidence | Bounded conditions/formulary, sourced regimen fields and required patient checks | Stop unsupported simulated issuance and surface the missing dependency; do not invent dose guidance |
| Teaching chest X-ray | Permitted image and usable accompanying annotations | Use another permitted teaching case; do not invent an image finding or use a generated scan as validation evidence |
| MedGemma/Gemma deployment | Working model/image runtime and stream path | Measure and adjust model/runtime; keep UI contract stable; report any reduced capability |
| Manglish | Held-out recordings and actual baseline quality | Correctable transcript and transparent scope; request a plan adjustment before adding a training project |
| Clinical evaluation | Currently no clinical reviewer | Keep prototype limits explicit; report extraction/source tests separately from clinical correctness |
| Local-model track story | Actual deployment boundary and organiser expectations | Describe Baseten Cloud truthfully; do not claim hypothetical hybrid/on-device deployment is implemented |
| Device | Exact iPhone and iOS version | Establish during first UI milestone; verify glass fallbacks and release performance there |
| Submission rules | Current semifinal requirements and final slot length | Confirm participant materials before artifact preparation; no public deployment occurs merely because it appears in this plan |

## Evidence and proportional verification

- UI: test screen states, cancellation, editing, VoiceOver, text scaling, reduced motion, keyboard and image gestures on the primary device.
- Backend: test patient isolation, invalid arguments, schema rejection, source references, unknown medication coverage, prescribing stop cases, cancellation, and idempotent task/simulated-prescription creation.
- AI: keep reproducible fixtures and held-out cases; record failures and sample size. Do not infer production accuracy from a handful of successful examples.
- Integration: complete the entire encounter and replay failure cases; measure first useful result and complete workflow time.
- Performance: inspect release behaviour while streaming and interacting. Record actual frame/timing evidence before making a performance claim.
- Existing checks: run repository type/build checks appropriate to changed packages and focused tests for critical behaviour. Broaden only when new evidence warrants it.

Planning changes alone do not require application tests. Implementation, credentials, migrations, model provisioning, publication and deployment have not occurred as part of drafting these documents.

## Review decisions

Use the [UI specification](ui-specification.md) for the ordered UI implementation slices and fixture acceptance scenarios.

Automatic routing is accepted, with hybrid/manual selection later. Autonomous prescribing is included as synthetic-patient simulated issuance. Review the [PRD](prd.md) and [storyboard](demo-storyboard.md) for its bounded case/formulary and evidence dependencies. Remaining practical inputs are exact deadline, available daily hours, and the iPhone model/iOS version. Ample budget and iPhone as the platform are already settled.

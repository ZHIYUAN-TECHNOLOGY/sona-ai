# Demo storyboard and UI states

Status: draft for review, 2026-09-22. Companion to the [PRD](prd.md) and [design direction](design-direction.md). Proposed demo sequence, not a claim of implemented behaviour.

## Presentation shape

Build a 10-minute core presentation, with up to five additional minutes for questions or deeper inspection. Official slot length is unconfirmed. Timing below is an allocation, not measured execution time.

| Time | Scene | Demonstrated value |
| --- | --- | --- |
| 0:00–1:00 | Identify clinician's task, buyer, and fictional case | Establish the outpatient workflow and prototype limits |
| 1:00–2:00 | Patient briefing | Relevant history and changes with traceable sources |
| 2:00–3:30 | Capture a short English/Manglish consultation excerpt | Visible recording, original transcript, English interpretation |
| 3:30–4:30 | Explore diagnostic possibilities and add missing history | Context changes suggestions; no invented clinical facts |
| 4:30–5:30 | Review a chest X-ray | Original image plus preliminary observations |
| 5:30–6:30 | Medication review and autonomous prescribing simulation | Sourced checks followed by a simulated prescription, or an explicit blocked result |
| 6:30–7:30 | Edit the note and confirm follow-up | Connected work persists after review |
| 7:30–9:00 | Show measured results and architecture | Technical feasibility, uncertainty and deployment boundaries |
| 9:00–10:00 | Explain proposed pilot, economics and next validation step | Commercial hypothesis and Malaysian relevance |

The scenario should connect these capabilities naturally. Prepare the specific fictional presentation, medication pair, and appropriately licensed teaching X-ray together; do not invent a clinical answer key to force the story. Without a clinical reviewer, label generated medical interpretation as unvalidated and use available source annotations only within their limits.

## Screen and scene specification

### 1. Home and patient context

- Pale grey canvas; a slight blue wash near the lower edge; subtle dotted halo around a blue ambient orb.
- Floating liquid-glass composer, voice control and attachment action. Route automatically; manual specialist shortcuts belong to a later hybrid mode.
- A compact patient selector opens the synthetic patient list. Entering the encounter establishes a persistent patient identity above the response area.
- Proposed prompts: “Brief me on this patient”, “Start consultation”, “Review medications”, “Review an X-ray”. Labels are draft clinical copy, not copied from reference apps.
- Patient switch with an active recording or unsaved note must offer an explicit resolution. Never silently discard work or attach it to another patient.

### 2. Briefing response

Prompt: “What changed since the last visit?”

- Monogram-style activity pulse gives immediate feedback; compact progress reflects real work once connected to the backend.
- Summary, timeline, medication list and missing-history cards appear as available.
- Source badges open a readable source-detail sheet containing record identity, date and passage.
- Maintain scroll position once the clinician moves away from the newest content.

### 3. Consultation capture

- Tap to start/stop a recording; optional long press opens focused voice entry for short commands.
- A persistent recording indicator, timer, waveform, pause/stop controls and patient identity remain visible.
- Do not use hold-to-talk for the entire ambient consultation.
- Show speaker-labelled transcript with editable roles. Display original mixed-language text and English interpretation as separate views.
- For a simulated UI prototype, show clearly identified fixture audio/transcript. Later stream actual transcription events through the same state contract.
- A system interruption or permission failure leads to an explicit recoverable state; completed transcript sections remain available.

### 4. Clinical reasoning

Prompt: “What possibilities should I consider with this history?”

- Show a concise contextual summary, diagnostic possibilities, supporting/conflicting findings, missing information and retrieved references.
- Allow a new family/social-history fact to be recorded with its source. Re-run and identify the updated sections without destroying the prior version.
- Present concise evidence-linked explanations, not a raw model reasoning trace.
- Clinician assessment is an editable separate field. Suggestions never automatically become the recorded diagnosis.

### 5. Chest X-ray review

- Attach or choose the permitted teaching image. Open a dedicated viewer for pinch/zoom and original-image inspection.
- When requesting analysis, use Arc's source-to-summary idea: a preview settles above the result while the original remains one tap away.
- Apply visual effects to the surrounding interface, never to the diagnostic pixels. A full-resolution source must remain available.
- Distinguish image observations, contextual interpretation and uncertainty. Do not draw inferred localization boxes without a supported and evaluated localization output.
- Unsupported file/image categories produce a useful message and preserve the rest of the encounter.

### 6. Medication review

Prompt: “Check this proposed medication against the current list.”

- Show resolved ingredients for confirmation when names are ambiguous.
- Result cards identify the medication pair, the source's warning and supporting passage.
- Display coverage/unknown states explicitly. No result is not a universal safety clearance.
- Keep dose/unit text stable during streaming; do not animate or regenerate medication data merely because the layout changes.

Then request a prescription for the fictional encounter. The assistant selects a regimen from the bounded supported scope, retrieves its evidence and evaluates required patient inputs and checks. Show medication/formulation, dose/unit, route, frequency, duration, evidence and a compact check summary.

When checks complete, the backend creates a clearly labelled simulated prescription without a mandatory clinician-approval step. Keep this distinct from a clinician-authored prescription and allow subsequent inspection/amendment. Missing input, contraindication, ambiguous medication, unsupported regimen or unknown coverage stops issuance and explains why. Include one blocked example in rehearsal and in the test fixtures. No real prescription is sent to a pharmacy.

### 7. Note review and follow-up

- Open a focused note editor with source links and explicit draft/reviewed status.
- Clinician changes remain separate from generated suggestions and survive retries or navigation.
- Proposed follow-up tasks include editable owner/date/details and a preview of what will be created.
- Save confirmation shows the persisted result. Repeated presses/retries do not duplicate it.
- Keep the proposed scheduling scope inside the prototype task list; show external system connections only if they are actually implemented.

## Shared dynamic component catalogue

| Component family | Core examples |
| --- | --- |
| Context | PatientContext, EncounterHeader, SourceBadge |
| Briefing | SummaryCard, HistoryTimeline, MedicationList, MissingInformationCard |
| Capture | RecordingControls, TranscriptSegment, SpeakerEditor, EnglishInterpretation |
| Clinical reasoning | PossibilityCard, EvidenceComparison, ReferencePanel, AssessmentEditor |
| Image | ImagePreview, ImageViewer, FindingsCard |
| Medication review | IngredientConfirmation, InteractionCard, CoverageNotice |
| Prescribing simulation | RegimenCard, PrescribingCheckSummary, BlockedPrescription, SimulatedPrescriptionReceipt |
| Documentation and work | NoteEditor, TaskProposal, SaveReceipt |
| Shared state | ToolProgress, PartialResultNotice, RetryControl, EmptyState |

Names are conceptual until implementation. The UI composer can select and arrange permitted components; the application validates schemas, binds trusted results, and authorizes actions independently. A fixed component arrangement is the recovery path for invalid generated layouts.

## State coverage required before UI completion

| State | Required behaviour |
| --- | --- |
| Idle | Clear input affordance and current patient context |
| Listening | Unambiguous recording state, stop control and real audio activity when connected |
| Working | Actual operation label; no fabricated completion percentage |
| Partial response | Mark incomplete sections; permit reading without implying finality |
| Ready | Stable interactive cards and available actions |
| Missing input | Ask for the particular missing field and retain current work |
| Interrupted/error | Preserve usable content, explain what failed, and offer scoped retry |
| Cancelled | Stop updates from the cancelled request, retain intentional user edits |
| Editing | Incoming layout updates do not overwrite user input |
| Saving/saved/failed | Prevent duplicate submission and reflect the actual stored state |

## Motion and material acceptance

- Monogram sets the liquid-glass material, dock continuity and primary reveal language.
- Arc adds progress/source presentation and selected voice/source-to-summary transitions.
- The PNG references set the pale grey canvas and slight blue atmospheric colour; blue must not take over every surface.
- Reanimated handles view motion; Skia is reserved for custom ambient visuals. Use native views for clinical text, controls and accessibility.
- Animate new response sections rather than every token. Do not make users wait for animation to finish before reading a ready result.
- Glass surfaces have appropriate contrast and an opaque fallback. Text scaling, reduced motion, keyboard behaviour and safe areas work on the demonstration iPhone.
- Verify in a release build on a physical iPhone under streaming load; do not infer frame rate from simulator appearance.

## Rehearsal and fallback

The [screen-by-screen UI specification](ui-specification.md) translates this walkthrough into navigation, screen anatomy, component contracts and interaction states.

Use a repeatable fixture reset and preloaded permitted assets. Record a truthful backup walkthrough after the working build is stable. If live inference fails, identify a replay or fixture mode explicitly. Do not present precomputed outputs as live inference. Hold actual outputs and evaluation results for inspection rather than relying solely on a choreographed success path.

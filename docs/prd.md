# Sona AI — competition prototype PRD

Status: draft for review, 2026-09-22. Sona AI is the repository's working name; final branding is not decided. This document does not authorize application implementation, deployment, or clinical use.

## Product and intended outcome

A clinician-facing iPhone assistant for a hospital outpatient department. One conversational workspace connects patient context, consultation capture, diagnostic-support exploration, chest X-ray review, medication interaction review, autonomous prescribing simulation, and follow-up tasks. The interface streams structured, interactive results using Monogram-inspired liquid glass on a pale grey canvas with a slight blue wash.

The demonstration should show one fictional encounter progressing from preparation to reviewed documentation and follow-up. It must make the difference between retrieved facts, generated suggestions, and the clinician's decisions visible.

Primary user: outpatient clinician. Proposed first buyer: a hospital outpatient department or clinical operations lead. Buyer, willingness to pay, and adoption assumptions are hypotheses; there is no customer validation yet.

Constraints: one builder, 18-day planning window, sufficient GPU budget, iPhone demonstration, UI completed before backend implementation. No clinical reviewer is currently available. Presentation duration is provisionally 10–15 minutes.

## Required capabilities and bounded scope

All seven capabilities below are retained from the discussion, including the user's addition of autonomous prescribing. Implementation order is a dependency order, not permission to silently drop a feature.

| Order | Capability | Competition version | Acceptance criteria |
| --- | --- | --- | --- |
| 1 | Patient briefing | Summarize synthetic records, timeline, current medications, allergies, medical/family/social history, and changes since a previous encounter | Every displayed historical fact has a record reference; dates and units are preserved; missing history is distinguished from a negative finding |
| 2 | Ambient scribe | Start/stop consultation recording, editable speaker-labelled transcript, structured English draft note | Recording state is explicit; user can correct speaker roles and text; note statements link to their evidence; clinician assessment and plan are not invented to fill empty sections |
| 3 | Clinical reasoning | Diagnostic possibilities, supporting/conflicting findings, missing information, retrieved evidence, and next-step suggestions for a narrow case set | New history can trigger a clearly identified updated result; suggestions remain preliminary; no fabricated probabilities, citations, or examination findings |
| 4 | Chest X-ray review | One supported image category; inspect an attached chest X-ray and view preliminary observations alongside patient context | Original image remains accessible and unfiltered; image observations are distinct from contextual interpretation; unsupported inputs and unavailable results have explicit states |
| 5 | Medication review | Resolve medication ingredients and check pairs against a bounded, documented interaction source; explain sourced findings | Display affected pair and supporting source; surface ambiguous names; unknown/uncovered pairs never produce a blanket safe result; preserve source qualifiers |
| 6 | Autonomous prescribing simulation | For synthetic patients in a bounded case/formulary set, select a regimen, check its prerequisites, and create a simulated prescription without mandatory clinician approval | Include medication, formulation, dose/unit, route, frequency, duration and supporting evidence; incomplete/unsupported inputs or failed checks block creation; label and persist the result as simulated and AI-created; no pharmacy transmission |
| 7 | Care coordination | Turn the recorded plan into editable follow-up task proposals and persist confirmed tasks inside the prototype | Preserve whether plan content was clinician-entered or AI-generated in simulation; show proposed changes before confirmation; repeated confirmation cannot duplicate a task; failed saves are visible; no claim of external hospital scheduling or messaging |

Treatment scope: autonomous prescribing is included. Given the accepted synthetic-patient competition context, this means the assistant selects a regimen and creates a simulated prescription without requiring clinician approval for every result. The user can inspect or amend it afterward. A simulated prescription is not a valid prescription for a real patient, and the prototype has no dispensing or real prescription-transmission integration.

The prescribing path must retrieve indication-specific regimen evidence and check the required patient facts, allergy/contraindication information, current medication list, interaction coverage, and applicable age/weight/organ-function requirements. Requirements depend on the selected regimen; absent information must never be treated as normal. Unknown coverage, unresolved ambiguity, missing prerequisites or a failed check produces a blocked result with the reason, not an automatically issued prescription. Structured checks are a bounded prototype control, not proof of clinical safety.

Separate simulated prescriptions from ordinary note completion: the scribe must not invent prescribing decisions or imply clinician endorsement. Retain the evidence/source version, patient inputs, check outcomes, model provenance, and prescription version. Retried creation must be idempotent. Prescribing output stays non-actionable while streaming; only a complete, schema-checked result can enter the simulated-created state.

No clinical reviewer is available. Assess this workflow as a simulation; Google states that unvalidated MedGemma outputs are not intended to directly inform diagnosis or treatment. [MedGemma use and limitations](https://developers.google.com/health-ai-developer-foundations/medgemma/model-card#limitations)

## Language and input

- Preload synthetic patient records and support document/image attachments and live consultation recording.
- English is the baseline. Include a bounded Malay-English-Mandarin code-switching demonstration with English clinical output.
- Keep the original transcript and English interpretation separate and editable. Capture corrections explicitly instead of silently rewriting source material.
- Compare existing open-weight STT candidates before deciding whether to fine-tune. A successful example does not establish general clinical language accuracy.
- Optional English TTS may read a completed response. Mixed-language speech output and full-duplex speech-to-speech are later work unless the baseline evaluation makes them inexpensive to integrate.
- Use synthetic records, consented recordings of fictional conversations, and appropriately licensed/de-identified teaching images. Do not use image-generation outputs as evidence of medical-image capability.
- Broad PDF-to-EHR import is outside the demo scope; attached documents can be inspected and used within the bounded workflow.

## Workspace and interaction

Accepted default: natural-language automatic routing. A hybrid experience with manual specialist selection can follow later; it is not required for the first UI. Show which specialist is working without making the clinician choose an underlying model.

The workspace includes a visible patient context, floating glass composer, voice control, compact progress, and a scrollable response area. Dedicated focused views handle recording, image inspection, evidence, and note editing. A patient switch must not carry the prior patient's active tools or draft into the next patient accidentally.

See [design direction](design-direction.md) and [demo storyboard and UI states](demo-storyboard.md). Liquid glass is a defining design material, especially on the composer, voice controls, chips, and floating panels. Dense clinical text stays readable. Grey remains the dominant canvas; blue is a restrained accent/ambient wash.

UI completion means the whole scripted encounter is usable with simulated data, including cancellation, missing information, unsupported images, stream interruption, editing, confirmation, and failed saves. Device readability, keyboard behaviour, safe areas, reduced motion, and text scaling must be checked before calling the UI complete.

## Proposed architecture and existing foundation

Observed in the repository manifests on 2026-09-22: Expo 57, React Native 0.86, React 19, Expo Router, Reanimated 4, Worklets, Gesture Handler, and @expo/ui. The project also has Hono/oRPC, Better Auth, Drizzle/PostgreSQL, and Cloudflare infrastructure scaffolding. Package presence is not evidence that clinical workflows, deployment, or authentication flows have been tested.

Proposed request path: iPhone → application backend → validated tool execution → Baseten inference/data services → structured results → validated UI specification → native renderer.

| Responsibility | Candidate / decision | Still to verify |
| --- | --- | --- |
| Hosting | Baseten Cloud initially | Runtime compatibility, image processing, streaming, latency and data handling for each selected model |
| Routing, tool calls, UI composition | Gemma 4 | Tool selection, valid arguments, response schemas and latency on project tasks |
| Medical text and images | MedGemma, starting with 1.5 4B | Task-specific quality; compare larger or alternative models only when evidence warrants |
| STT | Qwen3-ASR-1.7B and Malaysian Whisper candidates | Clinical code-switching, noise, numbers, medication names, chunking and time alignment |
| Speaker attribution | Separate diarization component | Model selection, attribution quality and correction flow |
| Voice output | Optional open-weight English TTS | Pronunciation and playback integration; not a dependency for text output |
| Drug evidence | Structured, sourced interaction records | Access, licensing, coverage, ingredient mapping, updates and uncertainty semantics |
| Prescribing simulation | Bounded formulary, indication-specific regimen evidence and explicit prerequisite checks | Permitted sources, regimen completeness, patient eligibility, contraindications, missing-data handling and idempotent simulated issuance |
| Clinical references | Small permitted reference collection | Provenance and retrieval quality; regional applicability must be labelled |
| Dynamic UI | json-render catalogue and native components | Actual React Native integration and streaming schema behaviour; JEV remains an optional experiment |
| Motion | Reanimated and Skia where appropriate | Compatibility with installed SDK and performance on demonstration iPhone |

Do not expose model credentials to the phone. Backend handlers enforce patient access and action authorization independent of model output. Model-selected UI actions use the same checks as fixed UI controls. Fine-tuning with Unsloth follows an identified error pattern and an appropriate held-out evaluation, not a quota of models to train.

## Prototype limits and evaluation

This is an unvalidated clinical workflow prototype. No clinical reviewer is currently available; benchmark or synthetic-case results must not be presented as proof of diagnostic safety. MedGemma's developer model requires application-specific adaptation and evaluation. A review button does not itself validate clinical output.

Measure the following and report sample sizes, conditions, and failures:

- Transcript errors and critical fact preservation across English and code-switched recordings; score negation, medication names, doses, durations, and who has a condition.
- Supported versus unsupported statements in notes and briefings, with source-reference correctness.
- Routing/tool-schema correctness, separation of patient contexts, and handling of invalid tool arguments.
- Interaction lookup correctness within declared coverage, including unknown ingredients/pairs.
- Image workflow behaviour and comparison with available teaching annotations; this is not independent clinical validation.
- Complete encounter duration, time to first useful result, retry behaviour, and observed device performance under streaming load.
- Task persistence and duplicate prevention across a retried confirmation.
- Simulated prescribing: supported regimen fields and units, source matching, missing-data/contraindication/unknown-coverage stop cases, provenance, and duplicate prevention. Passing these checks does not establish clinical validity.

Use separate development and held-out fixtures. No measured savings or accuracy claims exist yet. Proposed usability comparison: completing the same fictional documentation task manually versus with the assistant, with limitations disclosed.

## Competition story and commercial hypothesis

The published rubric lists technical feasibility 25%, commercial viability 25%, industry relevance 20%, scalability 15%, and ESG/national impact 15%. Confirm the semifinal rubric and timing with the participant materials. [Official rubric](https://maicnexus.com/en/terms#judging)

Evidence to prepare: a working connected encounter; measured operational results; a clearly identified buyer and pilot workflow; an architecture that can support departmental expansion; and a bounded code-switching demonstration relevant to Malaysian consultations. Proposed commercial model: departmental pilot, followed by per-clinician pricing with usage allowance. Pricing and customer demand are not established.

Baseten Cloud is the accepted prototype deployment. Open weights and a future hybrid option do not establish local inference. Record which data crosses each boundary and describe local/private deployment as a future path unless actually implemented and demonstrated. This is an unresolved track-fit issue, not a reason to silently change the user's platform choice.

## Deferred work and unresolved decisions

Deferred: real-patient prescription issuance or pharmacy transmission, broad autonomous triage, all-modality imaging, unrestricted drug coverage, full hospital scheduling/billing/inventory/rostering, production EHR integration, multilingual speech generation, manual specialist selection, and automatic outreach to patients or staff.

To resolve during review or before dependent work: prescribing simulation's bounded conditions/formulary and regimen evidence; iPhone model/iOS version; available daily development time and actual deadline; drug source access; teaching image permissions; clinical reference selection; semifinal artifact rules; and the local-model narrative. Automatic routing and inclusion of autonomous prescribing are settled. Budget is not an open question.

Figma MCP is unavailable, but the user's supplied PNGs resolve the visual-direction dependency. Exact tokens will be an intentional blue adaptation, not claimed Figma measurements. No additional reference gathering is required to start the UI storyboard.

Related: [UI specification](ui-specification.md), [delivery plan](delivery-plan.md), [design direction](design-direction.md), [storyboard](demo-storyboard.md).

# Sona AI — competition prototype PRD

Status: draft for review, 2026-09-22. Sona AI is the repository's working name; final branding is not decided. This document does not authorize application implementation, deployment, or clinical use.

## Product and intended outcome

A clinician-facing iPhone assistant for a hospital outpatient department. One conversational workspace connects patient context, consultation capture, diagnostic-support exploration, chest X-ray review, medication interaction review, autonomous prescribing simulation, and follow-up tasks. The interface streams structured, interactive results using Monogram-inspired liquid glass on a pale grey canvas with a slight blue wash.

The demonstration should show one fictional encounter progressing from preparation to reviewed documentation and follow-up. It must make the difference between retrieved facts, generated suggestions, and the clinician's decisions visible.

Primary user: outpatient clinician. Proposed first buyer: a hospital outpatient department or clinical operations lead. Buyer, willingness to pay, and adoption assumptions are hypotheses; there is no customer validation yet.

Constraints: one builder; the backend deadline is one to two weeks from 25 September 2026; the budget is cost-conscious (see [delivery plan](delivery-plan.md#costs)); the demo runs on an iPhone; backend planning runs in parallel with UI review. No clinical reviewer is currently available. Presentation duration is provisionally 10–15 minutes.

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
- English is the baseline. **Manglish, meaning Malay, English and Mandarin mixed within a sentence, is the main selling point.** It covers speech recognition and spoken replies, and the clinical output stays in English.
- Keep the original transcript and English interpretation separate and editable. Capture corrections explicitly instead of silently rewriting source material.
- Speech-to-text uses Qwen3-ASR-1.7B, fine-tuned on fictional Manglish consultations if it fails the baseline. A successful example does not establish general clinical language accuracy.
- Real-time voice conversation with interruption is in scope. It is built as a chain: STT, then Gemma, then VoxCPM2 TTS (LoRA fine-tuned on a Manglish voice actor if needed). End-to-end speech-to-speech models are excluded.
- Use synthetic records, consented recordings of fictional conversations, and appropriately licensed/de-identified teaching images. Do not use image-generation outputs as evidence of medical-image capability.
- Broad PDF-to-EHR import is outside the demo scope; attached documents can be inspected and used within the bounded workflow.

## Workspace and interaction

Accepted default: natural-language automatic routing. A hybrid experience with manual specialist selection can follow later; it is not required for the first UI. Show which specialist is working without making the clinician choose an underlying model.

The workspace includes a visible patient context, floating glass composer, voice control, compact progress, and a scrollable response area. Dedicated focused views handle recording, image inspection, evidence, and note editing. A patient switch must not carry the prior patient's active tools or draft into the next patient accidentally.

See [design direction](design-direction.md) and [demo storyboard and UI states](demo-storyboard.md). Liquid glass is a defining design material, especially on the composer, voice controls, chips, and floating panels. Dense clinical text stays readable. Grey remains the dominant canvas; blue is a restrained accent/ambient wash.

UI completion means the whole scripted encounter is usable with simulated data, including cancellation, missing information, unsupported images, stream interruption, editing, confirmation, and failed saves. Device readability, keyboard behaviour, safe areas, reduced motion, and text scaling must be checked before calling the UI complete.

## Proposed architecture and existing foundation

Observed in the repository manifests on 2026-09-22: Expo 57, React Native 0.86, React 19, Expo Router, Reanimated 4, Worklets, Gesture Handler, and @expo/ui. The project also has Hono/oRPC, Better Auth, Drizzle/PostgreSQL, and Cloudflare infrastructure scaffolding. Package presence is not evidence that clinical workflows, deployment, or authentication flows have been tested.

Agreed request path (25 September 2026): iPhone, then a Cloudflare Agent (Agents SDK, one Durable Object per encounter), then validated tool execution against Neon/R2, then Baseten Dedicated inference, then a json-render spec composed by the JEV engine with Laya as evaluator, then the native renderer. Plain data and login use oRPC over HTTP. Full detail and costs are in the [delivery plan](delivery-plan.md).

| Responsibility | Decision | Still to verify |
| --- | --- | --- |
| Hosting | Baseten Cloud, pay-as-you-go Dedicated deployments (US), on 3×L4 boxes built as Docker images. Development and staging only, with synthetic data. | INT4 quality and speed on L4, memory headroom, WebSockets through a custom Docker server |
| Routing, tool calls, reasoning, notes | Gemma 4 26B A4B-it, INT4 QAT, in box ① | Routing and spec validity on Manglish phrasing |
| UI composition | json-render `experimental_composeSpec` (0.21.0, pinned) with Laya as evaluator, fine-tuned on synthetic decisions; Gemma as backup evaluator | Laya accuracy after fine-tuning; options budget of about 20 per question |
| Chest X-ray | MedGemma 1.5 4B, FP8, box ③, on demand | vLLM compatibility; findings against teaching annotations |
| STT | Qwen3-ASR-1.7B plus Qwen3-ForcedAligner-0.6B, box ② | Manglish error rate, drug names, chunking |
| Speaker attribution | Nemotron-3-Diarization, merged by word timestamps; Gemma labels doctor or patient | Speaker attribution on real Manglish recordings |
| Voice output | VoxCPM2 (Apache 2.0, lists Malay and Mandarin) | Real-time speed on L4; code-switched pronunciation |
| De-identification | OpenMed PII (the language's default model) before any text reaches Gemma or MedGemma, and before any row enters a training dataset | Malay has no OpenMed model; Malaysian IC numbers use our own validator and surrogate generator. A recall test that fails on any leaked identifier gates each release |
| Drug evidence | A cited table of about 20–30 drugs (openFDA, RxNorm, FUKKM); anything outside it is "not covered" | FUKKM reuse permission |
| Prescribing simulation | Bounded formulary, indication-specific regimen evidence and explicit prerequisite checks | Regimen completeness and missing-data handling |
| Motion | Reanimated and Skia where appropriate | Performance on the demo iPhone |

Do not expose model credentials to the phone. Backend handlers enforce patient access and action authorization independent of model output. Model-selected UI actions use the same checks as fixed UI controls. Fine-tuning follows a failed baseline and a held-out evaluation. Planned targets are Qwen3-ASR and VoxCPM2, trained on Baseten Training Jobs with fictional data only, plus Laya on free Kaggle GPUs. Gemma (with Unsloth) and Nemotron are trained only if their baselines fail.

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

Baseten Cloud (US) carries synthetic data through the competition. For real patient data, production stays in **Malaysia or Singapore** (decided 25 September 2026). It will use Baseten Enterprise Self-hosted or a custom region, or the same Docker images directly on AWS or GCP, with the Agent, database and storage moved into the same region. Describe this as the production path, not as implemented, until it is demonstrated.

## Deferred work and unresolved decisions

Deferred: real-patient prescription issuance or pharmacy transmission, broad autonomous triage, all-modality imaging, unrestricted drug coverage, full hospital scheduling/billing/inventory/rostering, production EHR integration, manual specialist selection, and automatic outreach to patients or staff.

To resolve during review or before dependent work: prescribing simulation's bounded conditions/formulary and regimen evidence; FUKKM reuse permission; teaching image permissions; clinical reference selection; semifinal artifact rules; and the Baseten Enterprise quote for the production region. Backend decisions from 25 September are recorded in the [delivery plan](delivery-plan.md). Automatic routing and inclusion of autonomous prescribing are settled. Budget is not an open question.

Figma MCP is unavailable, but the user's supplied PNGs resolve the visual-direction dependency. Exact tokens will be an intentional blue adaptation, not claimed Figma measurements. No additional reference gathering is required to start the UI storyboard.

Related: [UI specification](ui-specification.md), [delivery plan](delivery-plan.md), [design direction](design-direction.md), [storyboard](demo-storyboard.md).

# Hospital ops demo flows

Ranked "wow" demo flows aimed at hospital operations and management judges. Drafted 25 September 2026 from:

- openmed agent skills: https://agent.openmed.life/docs/skills/
- openmed feature map: https://openmed.life/docs/feature-map/
- OpenEvidence features: evidence search, EvidenceGrade, consults, calculators, visits and coding.

Ranking weighs judge impact, real operational pain, and how much of the existing Sona UI each flow reuses.

Status: proposal. Nothing below is built yet.

## Ranked flows

### 1. Discharge in 60 seconds

**Pain.** A patient is medically fit at 10 am but leaves at 5 pm. The discharge summary, the insurer's final guarantee letter (GL), take-home medicines and follow-up all wait on paperwork, and the bed stays blocked.

**Demo moment.**

1. From the visit, the doctor taps "Discharge".
2. Sona drafts the discharge summary from the note and the transcript.
3. A "Blocking discharge" list shows what stands in the way: GL final pending, take-home medicines not reconciled, follow-up not booked.
4. The doctor resolves each blocker inline. This uses the same pattern as the one-card prescribing.
5. Sona produces a patient leaflet in Malay, English and Chinese, and assigns the follow-up tasks.
6. The flow ends on "Bed 12 free, 4 h 10 m earlier".

**Reuses:** the scribe, the prescribe card's blocker rows and progress ring, tasks, and handover.

**New UI:** a discharge card, medicine reconciliation (the admission list against the take-home list), the patient leaflet, and a "bed freed" receipt.

### 2. Guarantee letter and claim-ready coding in one pass

A guarantee letter is Malaysia's equivalent of prior authorisation.

**Pain.** Private hospitals wait hours to days for guarantee letters from insurers or third-party administrators. Claims are rejected when codes or documentation are missing.

**Demo moment.**

1. After the consult, Sona suggests ICD-10 and procedure codes.
2. Each code links to the sentence in the note that justifies it.
3. Sona checks the request against the insurer's criteria and flags gaps, for example "Specify: community-acquired, organism unknown".
4. The doctor fixes each flag in place.
5. Sona produces a guarantee letter packet ready to submit.
6. If a claim is denied, one tap drafts the appeal.

**Reuses:** the prescribe card's blocker pattern, and a draft, finalize and approve step with an approval token.

**New UI:** a coding panel with evidence spans, a criteria checklist, a guarantee letter packet preview, and an appeal draft.

### 3. Ward command view (for management)

**Pain.** The charge nurse and the bed manager find out what blocks each discharge at the evening huddle, which is too late to act.

**Demo moment.**

1. One screen shows the whole ward, one row per bed.
2. Each bed shows its predicted discharge time, blocker chips (GL, pharmacy, transport, pending result) and length-of-stay risk.
3. "Brief me" gives a 30-second spoken summary for the huddle.
4. Tapping a blocker assigns it to someone.

**Reuses:** My Day ranking, the time bar, quick actions, and the handover SBAR (Situation, Background, Assessment, Recommendation) format.

**New UI:** a ward grid or bed timeline, a blocker model across patients, and the huddle brief.

### 4. Evidence answer with a grade (the OpenEvidence moment)

**Pain.** Junior doctors either guess or spend ten minutes searching.

**Demo moment.**

1. During the visit, the doctor asks: "Steroids for this patient with community-acquired pneumonia?"
2. Sona answers in three lines with an evidence grade.
3. The answer cites two or three sources; tapping one opens its PubMed abstract.
4. A CURB-65 calculator (a pneumonia severity score) is filled in automatically from the patient's vitals.

**Reuses:** conversation answers and the json-render cards.

**New UI:** citation chips, a grade badge, and a calculator card.

This flow is clinical rather than operational, so it ranks lower with management judges.

### 5. Coding and casemix audit (revenue)

**Pain.** Vague documentation leads to under-coding, which loses casemix funding or claim value.

**Demo moment.** A nightly audit reports "12 notes under-specified, estimated RM 18k at risk". Each note has a one-tap query to the doctor who wrote it.

This flow reuses the engine from flow 2. Show it as a 10-second add-on rather than a standalone flow.

## Build list

### UI first (synthetic data, matching the current milestone)

| # | Item | Estimate |
| --- | --- | --- |
| 1 | Discharge card and "bed freed" receipt | about 1 day |
| 2 | Coding panel with evidence spans, and the guarantee letter packet | about 1 day |
| 3 | Ward command view | about 1.5 days |
| 4 | Citation chips, grade badge and calculator card | about half a day |
| 5 | Patient leaflet in Malay, English and Chinese | about half a day |

### Backend and models (later, per [the delivery plan](../delivery-plan.md))

| Need | Model or service |
| --- | --- |
| Drafting discharge summaries, guarantee letters and appeals | Gemma 4 with json-render, already planned. No new model. |
| Evidence answers | PubMed E-utilities, an embedding model (EmbeddingGemma or MedCPT) and a reranker. Gemma 4 synthesizes; the grade comes from rules on study type. |
| Coding | MedGemma or Gemma 4 plus a terminology lookup. Use WHO ICD-10 and Malaysian casemix (MY-DRG), not ICD-10-CM or HCC. SNOMED is optional. |
| De-identification before any cloud call | openmed de-identification models. Their 38 languages include Indonesian (`id`) but not Malay (`ms`), so Malaysian names and IC numbers need fine-tuning or added rules. |
| Calculators and insurer criteria | Deterministic code, with criteria stored as data taken from panel insurer documents. No model. |

### Skip

These are US-specific or not needed for the demo:

- HCC/RAF risk adjustment.
- US Medicare coverage rules (LCD/NCD).
- RxNorm.
- EOB explanations.
- FHIR bulk export. Add FHIR only if a hospital asks for EMR integration.

## Suggested three-minute order for judges

1. Discharge in 60 seconds, with the guarantee letter from flow 2 folded in.
2. Ward command view.
3. A 20-second evidence answer as the closer.

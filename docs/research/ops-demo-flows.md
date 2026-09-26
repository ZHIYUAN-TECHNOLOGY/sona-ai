# Hospital ops demo flows

Ranked "wow" demo flows aimed at hospital operations and management judges. Drafted 25 September 2026 from:

- openmed agent skills: https://agent.openmed.life/docs/skills/
- openmed feature map: https://openmed.life/docs/feature-map/
- OpenEvidence features: evidence search, EvidenceGrade, consults, calculators, visits and coding.

Ranking weighs judge impact, real operational pain, and how much of the existing Sona UI each flow reuses.

Status: flow 1 (discharge in 60 seconds) is built as synthetic UI: `apps/native/features/discharge`, opened from the end-of-visit Discharge button. Flow 2 (guarantee letter and claim-ready coding) is built as synthetic UI: `apps/native/features/claim`, opened from the discharge card's guarantee letter row. Flow 3 (ward command view) is built as synthetic UI: `apps/native/features/ward`, opened from the home Ward key. Flow 4 (graded evidence answer) is built as synthetic UI: `apps/native/features/evidence`, the new evidence answer. Flow 5 (coding audit) is built as synthetic UI: `apps/native/features/audit`, opened from the ward screen. Flows 6 and 7 (from the Qure.ai review) are planned; they follow the remaining backend waves.

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

### 6. Incidental finding tracker (after Qure.ai qXR and lung nodule management)

Added 26 September 2026 after reviewing https://www.qure.ai/ (qXR, lung nodule management, qXR-HF).

**Pain.** A chest film taken for one reason shows something else, such as a small nodule or an enlarged heart. It is mentioned in the report, then nobody follows it up, and a treatable cancer or heart failure is found years later.

**Demo moment.**

1. Amelia's X-ray was taken for pneumonia. Sona also flags a 9 mm nodule and a borderline heart size, each marked on the image, labelled unvalidated.
2. Each finding carries a follow-up rule (for a nodule, a CT in 3 months) and a risk band.
3. One tap turns it into a tracked follow-up: a task with an owner and a due date, and a recall for the patient.
4. The finding travels with her: it appears as a blocker line on discharge, a line in the handover and a row in a "Findings to follow up" list for the ward.
5. Overdue follow-ups turn red on the doctor's day.

**Reuses:** the X-ray screen, tasks, the discharge card, handover, the ward view and the colour-coded terms.

**New UI:** finding markers on the image, a finding card with the follow-up rule, and the follow-up list.

**Honesty:** Qure's products are regulator-cleared and trained on millions of scans. Sona's findings come from MedGemma on synthetic cases and must be labelled unvalidated; never quote Qure's accuracy figures.

### 7. After-discharge check-ins (after Qure.ai Aira)

**Pain.** Patients go home and the hospital hears nothing until they come back sicker. Nobody has time to call everyone.

**Demo moment.**

1. At discharge, Sona schedules check-ins in the patient's language (Malay, English or Chinese) for day 2 and day 7.
2. Two days later Amelia replies "demam balik" (fever is back).
3. Sona reads the reply, flags it red on the doctor's day as "Amelia: fever returned after discharge", and offers one tap to call her back or book her in.
4. Replies that need nothing ("feeling better") are logged quietly.

**Reuses:** the discharge card and leaflet languages, My Day ranking, tasks and the colour-coded terms.

**New UI:** a check-in schedule on the discharge receipt, a reply thread on the patient sheet, and the flagged row on My Day.

## Build list

### UI first (synthetic data, matching the current milestone)

| # | Item | Estimate |
| --- | --- | --- |
| 1 | Discharge card and "bed freed" receipt | about 1 day |
| 2 | Coding panel with evidence spans, and the guarantee letter packet | about 1 day |
| 3 | Ward command view | about 1.5 days |
| 4 | Citation chips, grade badge and calculator card | about half a day |
| 5 | Patient leaflet in Malay, English and Chinese | about half a day |
| 6 | Incidental finding tracker: markers on the image, finding card, follow-up list | about 1.5 days |
| 7 | After-discharge check-ins: schedule, reply thread, flagged row on My Day | about 1 day |

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

# UI fixture plan

Status: implementation support, 2026-09-22. Fixtures demonstrate UI behaviour; they are authored synthetic data, not clinical guidance or model evaluation results. Companion to the [UI specification](ui-specification.md).

## Runtime fixture update — 23 September 2026

The preparatory patient proposals and training dose values below are **superseded** by the shared runtime contract in [encounter/fixtures.ts](../apps/native/features/encounter/fixtures.ts). Implementations must consume that file, not copy the earlier proposals.

- **Amelia Tan · SYN-1042 · visit-1042 · 42 years:** five-day cough, fever since yesterday, childhood asthma, maternal asthma/paternal diabetes, teacher/never smoker, reported penicillin rash, reported salbutamol/cetirizine. Observations are synthetic. Medication reconciliation and allergy details remain incomplete for clinical use.
- **Daniel Rahman · SYN-1086 · visit-1086 · 57 years:** exertional breathlessness with onset missing, incomplete medical/family/social history, unknown tablet and no recorded allergy history or observations.
- Sources use IDs scoped to each patient: `history`, `vitals`, `consultation`, `medication`, `simulation`, `xray` where available. Patient binding is mandatory when resolving these intentionally repeated IDs.
- The runtime successful order is **DEMO-REGIMEN-01**, a nonclinical training order containing **no drug, dose, route or treatment duration**. It replaces the earlier demo-unit suggestion. A current medication-review workflow step enables only this training simulation, not clinical interaction clearance.
- `Encounter.prescription` is the authoritative receipt status. Rendering a card never issues an order. Missing fixture eligibility or a review from an older revision blocks the simulation; retry can reevaluate a blocked result and cannot duplicate an already-created receipt.

The deterministic scenario matrix and asset dependencies remain applicable. The remainder of this document preserves the original proposal as planning history only.

## Shared bindings and provenance

Main-agent contracts are authoritative. Suggested fields to preserve across feature fixtures:

```ts
type FixtureBinding = {
  patientId: string;
  encounterId: string;
  contextRevision: number;
  requestId: string;
};

type FixtureSource = {
  id: string;
  patientId: string | null;
  kind: 'synthetic-record' | 'synthetic-transcript' | 'training-rule' | 'teaching-image';
  title: string;
  date: string;
  passage: string;
  version: number;
  availability: 'available' | 'unavailable' | 'superseded';
  provenanceLabel: string;
};
```

Use stable source, card, task and operation IDs. A missing fact has an explicit unknown state; an empty string does not mean a negative finding. Preserve original transcript and English interpretation separately. Simulated receipt events originate from the fixture action adapter, never from a card's presentation payload.

## Primary encounter

**Aina Rahman · SYN-001 · 42 years · fictional adult patient**. Encounter `enc-aina-20260922`, baseline context revision `1`. Proposed outpatient encounter date: 22 September 2026. Patient name is fictional; there is no real hospital identifier, phone number or address.

| Source ID | Date | Synthetic source passage / intended display |
| --- | --- | --- |
| `aina-record-background` | 2026-08-19 | “Medical history: hypertension. Current recorded medication: amlodipine; dose and last reconciliation are not available in this imported fixture. Allergy history: not recorded.” |
| `aina-record-family` | 2026-08-19 | “Patient reports that her father has asthma. No further family history was collected.” |
| `aina-record-social` | 2026-08-19 | “Patient reports never smoking. Works in a school. Household exposure history has not been collected.” |
| `aina-record-last-visit` | 2026-08-19 | “Routine follow-up. No cough reported during this visit.” |
| `aina-record-current` | 2026-09-22 | “Reason for visit: cough for four days. Patient describes feverishness overnight and discomfort on deep breathing. Temperature, oxygen saturation and chest examination have not yet been recorded.” |
| `aina-transcript-1` | 2026-09-22 | “I've had this cough for four days. Last night I felt feverish.” |
| `aina-transcript-2` | 2026-09-22 | “My father has asthma. I haven't been diagnosed with it.” |
| `aina-transcript-3` | 2026-09-22 | Original: “Batuk dah empat hari, doctor. Last night rasa panas, 今天早上还是咳嗽.” English interpretation: “I've had a cough for four days, doctor. I felt feverish last night, and I was still coughing this morning.” |
| `aina-transcript-4` | 2026-09-22 | Original: “Saya tak merokok. My father ada asthma, bukan saya.” English interpretation: “I do not smoke. My father has asthma, not me.” |
| `aina-context-update` | 2026-09-22 | “Patient reports a household member has recently had a cough.” Added through the fixture history editor; source version and encounter context revision increment. |

Use English segments for baseline playback and the bounded mixed-language segments for the Manglish view. These are manually authored text fixtures, not transcribed audio or a validated translation. Do not expose fake timestamps, speaker-confidence scores or audio seek controls. If consented fictional audio is added later, replace these with genuinely aligned segments.

The history update provides a useful visible change in briefing/reasoning while preserving the old result as “Based on earlier history”. It must not turn the father's asthma into the patient's diagnosis.

### Seven-workflow projection

1. **Briefing:** four-day cough, previous visit had no reported cough, background hypertension, family/social details, medication/allergy/examination gaps. Every historical fact links to the source table.
2. **Scribe:** speaker labels initially `Speaker 1` and `Speaker 2`; user can assign `Patient`/`Clinician`. English note has Presenting history, Background, Assessment and Plan. Assessment/Plan initially read “Not documented”; fixture diagnosis/prescribing output must not appear as clinician-authored text.
3. **Reasoning:** an explicitly authored UI example of respiratory diagnostic possibilities, supporting history and missing examination/vitals; no probabilities or implied validated answer key. Keep `Clinical evidence unavailable in this fixture` visible until a permitted real reference is supplied. History revision visibly updates the context summary.
4. **X-ray:** attached-image metadata and original-image viewer can be exercised independently of findings. Until a permitted asset and annotation are provided, render `Teaching image not loaded` / `Analysis unavailable`, not a fabricated radiograph or finding. Use a supported original image if the parent locates a permitted asset.
5. **Medication:** amlodipine is a recorded name, not a complete medication reconciliation. UI can demonstrate exact-name resolution; clinical interaction outcome is `Coverage unavailable` until a real permitted interaction source exists. A deliberately ambiguous entry `BP tablet` exercises correction without guessing an ingredient.
6. **Autonomous prescribing:** the patient-data path initially blocks on missing allergy history, medication reconciliation and regimen evidence. A separate explicitly identified **training-only scenario** exercises successful automatic receipt creation, described below. Do not claim that this patient's cough has a confirmed prescribing indication.
7. **Follow-up:** fixture proposal “Review the completed consultation note” with owner and due date missing; edit owner to `Demo clinician` and choose a date, then create a local task. A second proposal “Review outstanding medication history” links to `aina-record-background`. Neither sends a message or books an appointment.

## Second patient and isolation cases

**Daniel Tan · SYN-002 · 58 years · fictional adult patient**. Encounter `enc-daniel-20260922`, context revision `1`.

Source `daniel-record-current`: “Routine medication review requested. Patient reports taking two medicines but cannot identify them. Medical, allergy and family history have not yet been collected.” Source `daniel-record-social`: “Patient reports living alone. Smoking history not recorded.”

This intentionally sparse patient tests missing-information layout and patient isolation. Starting Aina's briefing then switching to Daniel must not display Aina's late cards, transcript, image or prescription. Returning to Aina can restore her own encounter draft. A recording or unsaved edit requires the explicit resolution defined in the UI specification.

## Successful simulated receipt without invented medical dosing

Before permitted regimen evidence exists, use **training materials with no real medicine**, visibly labelled “UI training scenario · nonclinical values”. This fixture demonstrates lifecycle and layout only.

Suggested complete payload:

| Field | Training value |
| --- | --- |
| Medication | `Training medicine A — not a real drug` |
| Formulation | `Training tablet` |
| Dose | `1 demo-unit` |
| Route | `Demo route` |
| Frequency | `Once per demo-day` |
| Duration | `3 demo-days` |
| Indication provenance | `Authored UI training scenario; no patient diagnosis established` |
| Regimen source | `training-regimen-a-v1` |
| Coverage | `Training rules only; no clinical interaction coverage` |
| Outcome | `Simulated prescription created` |

The training scenario uses an isolated fixture context (`scenarioId: training-prescription-complete`), not a silent mutation of Aina's missing history. Source `training-regimen-a-v1` explicitly repeats that values are nonclinical. Individual checks can be labelled “Fixture prerequisite satisfied” rather than “Clinically safe”. Do not claim that an actual clinical eligibility/interaction check passed.

Flow: requested → checking → creating simulation → created. No clinician approval button is required. Operation ID `op-training-rx-001` deduplicates retry; revision 2 amendment supersedes revision 1 and reruns training checks. The original snapshot remains inspectable. Clinical medication/regimen fixtures replace these values only when evidence is supplied.

## Deterministic scenario set

| Scenario ID | Trigger / injected event | Expected result |
| --- | --- | --- |
| `briefing-complete` | Stable sections emitted sequentially | Summary, timeline, history gaps and sources |
| `briefing-interrupted` | Fail after first complete section | First section preserved; retry resumes/replaces by stable IDs |
| `patient-switch-late-event` | Deliver old patient request after switch | Reject old event from current workspace |
| `context-change-late-event` | Deliver old revision after history correction | Prior result marked older; not accepted as current |
| `transcript-manglish` | Load original + interpretation segments | Both editable; corrections preserved |
| `note-edit-during-update` | Update suggestion after manual edit | Preserve edited field; offer separate suggestion |
| `medication-ambiguous` | Recorded name `BP tablet` | Ask for ingredient; no guessed match |
| `medication-coverage-unknown` | Resolved names but no source coverage | Incomplete check; no blanket safe result |
| `prescription-blocked` | Missing facts/evidence in primary encounter | Reasons and correction actions; no receipt/bypass |
| `training-prescription-complete` | Complete explicit training checks | Automatically create clearly simulated nonclinical receipt |
| `prescription-retry` | Repeat same completed operation event | Exactly one receipt |
| `prescription-cancel-race` | Created event precedes cancellation result | Show existing receipt; do not claim it was revoked |
| `task-save-failed` | Fail initial local fixture action | Preserve edited proposal and stable operation ID |
| `task-retry` | Retry and repeat completion | Exactly one created task |
| `image-unavailable` | No permitted teaching image | Honest empty/attachment state with no invented findings |
| `image-unsupported` | Unsupported attachment metadata | Preserve attachment metadata; analysis unavailable |
| `source-unavailable` | Valid reference identity, missing content | Source unavailable; no invented quotation |

These are UI adapter scenarios, not production model prompts. Test assertions should target behaviour (isolation, deduplication, edit preservation), not duplicated fixture text.

## Asset dependencies and implementation handoff

- No teaching X-ray or audio asset was present in the inspected `docs/references` and `apps/native/assets` folders. Existing PNG references are interface design references only.
- A chest X-ray needs its permitted source, attribution/licence, original file and available teaching annotation. No image-generation substitute.
- A clinical interaction success/warning needs a permitted source entry and its actual qualifiers. A clinical prescribing example additionally needs a sourced complete regimen and applicable prerequisite facts. These remain separate from UI training success.
- Keep fixture dates deterministic and display them explicitly. Do not imply these historical fixture events happened “just now” except for an actual local interaction receipt.
- Main agent decides the final runtime types, storage and registry. Feature workers should consume shared fixtures/contracts rather than define competing patient IDs or scenario controls.

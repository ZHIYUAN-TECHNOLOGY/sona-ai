# P0 On-Device Scribe Slice — Build Plan (the Semi-Finals weapon)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ONE working, end-to-end, **fully on-device** scribe slice that runs the MAIC Semi-Finals live demo: record a real consult, transcribe and write a structured SOAP note on the phone, **with airplane mode ON**, then review, sign, and export. Not 27 screens. One slice that actually runs and cannot be faked.

**Why this plan exists:** The 27-screen prototype (`docs/superpowers/visuals/sona-features-prototype.html`) is frozen and sufficient for the Aug online Preliminary. It is NOT sufficient for the Sep live demo in KL, where judges expect something running. A quantized LLM writing a clinical note offline on a phone is the one demo Sully / Abridge / DeepScribe (all cloud) cannot show. This plan converts exactly one feature from mockup to real.

**Depends on:** `docs/superpowers/plans/2026-06-16-scaffold-and-ondevice-spike.md` (the spike) must be GREEN first. This plan **consumes** its output `docs/superpowers/decisions/2026-06-16-ondevice-runtime-decision.md` — it does not re-benchmark. If the spike is NO-GO on the local LLM, this plan still ships (cloud-default summarizer on de-identified text; see Gate 0 and Risks).

**Non-negotiable rule (the moat):** Only **de-identified** text may ever cross the device boundary, and only on the optional cloud path. Raw audio and the re-identify map never leave the phone. Every task below is gated on preserving this.

---

## The acceptance criterion IS the demo (define done first)

This slice is "done" when this 3-minute script runs on the target device, reproducibly, in front of someone:

1. Open Sona, tap **New consult**, capture **consent** (toggle + timestamp logged on device).
2. Tap record. Play a scripted **60-90s BM/EN code-switched** consult. Live transcript appears on-device.
3. **Visibly flip airplane mode ON** (show the control centre). No network.
4. Tap **Finish**. A structured **SOAP note generates on-device** while offline. Names are stripped before any processing and restored locally in the final note.
5. Review, **edit one line**, tap **Sign**.
6. **Export FHIR + PDF**; show the **audit log** entry and that **raw audio is discarded**.
7. (Optional flourish) Turn airplane mode off, toggle **Cloud helper**, regenerate, show the premium-quality note built from **de-identified** text only.

If that script works 5 times in a row on the locked device, the slice is done. Nothing else in this plan matters more than that script.

---

## Scope discipline (in / out / stretch)

| In (build it) | Out (defer, stays mockup) | Stretch (only if Gate 3 is early) |
| --- | --- | --- |
| Consent capture + on-device audit log | Web clinician dashboard | **Multi-doc from one session: note + referral letter + patient explainer, all offline (Heidi read, §8c — ~2 extra prompts, triples demo value)** |
| Audio capture + on-device STT, live transcript | Multi-device sync / auth | ICD-10 / E-M coding surfaced from the note, **with verbatim transcript justification quotes (Heidi pattern)** |
| On-device PII redaction + local re-ID map | Ask Sona | One Guardian hero (camera vitals on a judge) |
| SOAP generation: on-device LLM + optional cloud toggle (de-identified only) | Pricing / plans, Note-style learning | Cloud-vs-local quality A/B in the demo |
| Review / edit / sign | Guardian (triage, pill-ID, emergency) | Specialty template switch |
| Export FHIR DocumentReference + PDF | Mandarin / Tamil, diarization | Streaming token render for "AI feel" |
| Local-first persistence (consult, transcript, note, audit) | Orders extraction (nice, not load-bearing) | |
| **BM/EN code-switch demo moment (promoted per §8c — the language pill Heidi can't do offline)** | | |

**One device, one specialty (general practice), one language pair (BM/EN), happy path + airplane-mode proof.** Edge cases, error recovery polish, and breadth are explicitly out. Resist every urge to widen this. The BM/EN pair is now a *featured demo beat*, not just a constraint: one exchange of the scripted consult happens in Bahasa Malaysia and the note comes out in clean English — offline.

---

## Mockup -> real screen mapping

Only these prototype screens become functional code for the slice. The rest remain vision mockups in the deck.

| Prototype screen (in HTML) | Build for slice? | Becomes |
| --- | --- | --- |
| Consent + privacy proof | YES | real consent + audit write |
| Recording (live transcript) | YES | real audio capture + on-device STT stream |
| Generating (skeleton) | YES | real on-device inference progress |
| Consult note (review) | YES | real generated note, editable |
| Sign and export | YES | real FHIR + PDF + audit + audio-discard |
| Success state | YES | real post-export confirmation |
| Pre-visit brief, Today, Patients, Ask Sona, Guardian*, Pricing, Note style | NO | stay mockup (vision) |

\* Guardian camera-vitals is the one stretch screen, only if Gate 3 lands early.

---

## Go / No-Go gates (slice-level, distinct from the spike's per-stage thresholds)

| Gate | Checkpoint | Pass condition | If fail |
| --- | --- | --- | --- |
| **Gate 0** | Spike decision locked | runtime + summarizer model + redaction path chosen in the decision doc; each stage individually GO | If local LLM NO-GO: set cloud-on-de-identified as the **default** summarizer, local LLM as the offline toggle; the airplane-mode demo then shows transcript + redaction offline and notes the offline-note path as roadmap. Decide this explicitly, do not drift. |
| **Gate 1** | Privacy pipeline real | de-identified text is what the summarizer sees; re-ID map written to device secure storage only; proven by logging what each stage receives | Block. The moat is the product. Do not proceed without it. |
| **Gate 2** | End-to-end offline | record -> note on-device, airplane mode, ≤ ~2 min perceived, no OOM across 5 runs | Drop to smaller model / shorter max-tokens / streaming; or cloud-default per Gate 0 |
| **Gate 3** | Clinical plausibility | a real clinician rates ≥ 8 / 10 sample notes as "usable with light edits" | Tune the SOAP prompt + template; if still failing, cloud path carries quality and local is "draft" |
| **Gate 4** | Demo reproducible | the 3-min script runs 5/5 on the locked device | Harden the weakest task; record the failure mode honestly |

---

## File structure (created/modified by this plan)

```
apps/native/
  app/                                 # Expo Router screens (real slice UI)
    consult/
      consent.tsx                      # consent capture + audit write
      record.tsx                       # capture + live transcript
      review.tsx                       # generated note, edit, sign
      export.tsx                       # FHIR + PDF + success
  lib/
    ondevice/
      stt.ts                           # STT wrapper (locked runtime from decision doc)
      summarize.ts                     # SOAP gen: local LLM + cloud toggle (de-identified in)
      redact.ts                        # PII redaction + re-ID map (locked path from decision doc)
      reidentify.ts                    # restore names locally into the final note
    store/
      db.ts                            # on-device DB (op-sqlite / expo-sqlite) schema + queries
      audit.ts                         # immutable on-device audit log
    export/
      fhir.ts                          # DocumentReference / Encounter builder
      pdf.ts                           # note -> PDF (expo-print)
    secure/
      reidStore.ts                     # re-ID map in secure storage (never leaves device)
  spike/                               # from the spike plan; reuse stt/llm adapters, do not re-bench
docs/superpowers/
  plans/2026-06-17-p0-scribe-slice-build.md   # this file
  decisions/2026-06-16-ondevice-runtime-decision.md  # consumed (Gate 0)
```

---

## Task 0: Gate 0 — confirm the runtime is locked

**Files:** read `docs/superpowers/decisions/2026-06-16-ondevice-runtime-decision.md`

- [ ] **Step 1: Verify the spike is green and the decision doc is filled** with measured numbers: STT runtime, summarizer model + runtime, redaction path, and the two-runtime coexistence note. If any field is a placeholder, STOP and finish the spike first.
- [ ] **Step 2: Record the chosen defaults at the top of this plan** (one line): e.g. "STT = Whisper-small/RN-ExecuTorch; LLM = Qwen3-1.7B baseline (Gemma 4 fast-follow); redaction = deterministic Path B floor." This is the contract the rest of the tasks build against.
- [ ] **Step 3: Decide the summarizer default** per Gate 0: local-first if LLM GO, else cloud-on-de-identified default + local toggle. Write the choice down; do not leave it implicit.

---

## Task 1: On-device persistence + audit (local-first)

**Files:** `lib/store/db.ts`, `lib/store/audit.ts`

- [ ] **Step 1: Add the on-device DB** (op-sqlite or expo-sqlite per what builds in the dev client). Tables: `consult(id, patient_label, started_at, consent_at, status)`, `transcript(consult_id, text, lang, created_at)`, `note(consult_id, soap_json, signed_at, signed_by)`, `audit(id, consult_id, event, at)`. All on device.
- [ ] **Step 2: Write the audit logger** — append-only, timestamped, never deleted: events `consent_captured`, `recording_started`, `redacted`, `note_generated_local|cloud`, `signed`, `exported_fhir|pdf`, `audio_discarded`. The demo shows this log.
- [ ] **Step 3: Unit-check** the queries (create consult -> add transcript -> add note -> read back) with a tiny test or a dev button. Commit.

---

## Task 2: Audio capture + on-device STT -> live transcript

**Files:** `lib/ondevice/stt.ts`, `app/consult/record.tsx`

- [ ] **Step 1: Capture mic audio** with `react-native-audio-api` at 16 kHz mono (match the spike). Stream or chunk so the transcript appears progressively (the "live note" feel from the mockup).
- [ ] **Step 2: Wrap the locked STT runtime** in `stt.ts` reusing the spike adapter — `transcribe(buffer) -> { text, lang }`, multilingual (Whisper-small, NOT the EN-only tiny). Do not re-benchmark; consume the spike's choice.
- [ ] **Step 3: Build `record.tsx`** to the prototype's recording screen: waveform, timer, live transcript, Pause/Finish. Persist the transcript to the DB. Audit `recording_started`.
- [ ] **Step 4: Airplane-mode check** — confirm STT runs with no network. If it silently used a network model, fix the runtime config. Commit.

---

## Task 3: On-device redaction + re-ID map (Gate 1, the moat)

**Files:** `lib/ondevice/redact.ts`, `lib/secure/reidStore.ts`, `lib/ondevice/reidentify.ts`

- [ ] **Step 1: Implement `redact(text) -> { deidentified, map }`** using the locked path from the decision doc (ML NER Path A, or deterministic Path B floor). `map` is `{token -> realValue}` (e.g. `[NAME_1] -> "Tan Mei Ling"`).
- [ ] **Step 2: Store the re-ID map in secure storage** (`expo-secure-store` / Keychain / Keystore) keyed by consult id. **This map must never be sent anywhere.** Add an explicit comment + a guard so no network call can read it.
- [ ] **Step 3: Implement `reidentify(note, map)`** — restore real values into the final note locally, after generation.
- [ ] **Step 4: Gate 1 proof** — log (dev-only) exactly what string the summarizer receives; assert it contains no seeded PII span. Audit `redacted`. Commit.

---

## Task 4: SOAP generation — local LLM + cloud toggle (de-identified only)

**Files:** `lib/ondevice/summarize.ts`

- [ ] **Step 1: `summarizeLocal(deidentifiedTranscript) -> soap`** using the locked on-device LLM adapter from the spike + the `SOAP_SYSTEM_PROMPT`. Parse to `{ subjective, objective, assessment, plan }`.
- [ ] **Step 2: `summarizeCloud(deidentifiedTranscript) -> soap`** calling the Workers/oRPC backend -> Claude, sending **only de-identified text** (assert again at the call site). This is the premium toggle, off by default in airplane demo.
- [ ] **Step 3: One `summarize(transcript, { mode })`** entry that redacts (Task 3), routes to local|cloud per the Gate 0 default, then re-identifies (Task 3) before returning. Audit `note_generated_local|cloud`.
- [ ] **Step 4: Wire the "Generating" screen** (skeleton/progress) to real inference state. Commit.

---

## Task 5: Review / edit / sign

**Files:** `app/consult/review.tsx`

- [ ] **Step 1: Render the generated SOAP** in the prototype's consult-note layout; make each section editable (controlled text).
- [ ] **Step 2: Sign** — capture signer + timestamp, set `note.signed_at/by`, lock further edits. Audit `signed`.
- [ ] **Step 3: Persist edits** back to the DB so export uses the final text. Commit.

---

## Task 6: Export — FHIR + PDF + audio discard

**Files:** `lib/export/fhir.ts`, `lib/export/pdf.ts`, `app/consult/export.tsx`

- [ ] **Step 1: `toFhir(note, consult) -> DocumentReference`** (+ minimal Encounter). Valid R4 JSON; save to file / share sheet.
- [ ] **Step 2: `toPdf(note) -> uri`** via `expo-print`. Clinical layout, signer + timestamp footer.
- [ ] **Step 3: Discard raw audio** — delete the captured audio file after the note is signed; audit `audio_discarded`. Show this on the success screen (the moat payoff).
- [ ] **Step 4: Export screen** with FHIR + PDF actions and the success state. Audit `exported_*`. Commit.

---

## Task 7: Consent + airplane-mode hardening

**Files:** `app/consult/consent.tsx`

- [ ] **Step 1: Consent screen** (the prototype's): patient-consent toggle, "works offline" badge, log `consent_captured` with timestamp before recording can start.
- [ ] **Step 2: Full offline pass** — run consent -> record -> redact -> local note -> sign -> export with airplane mode ON, start to finish. Fix anything that reaches for the network.
- [ ] **Step 3: Reliability — run the full flow 5x** on the locked device; record timings and any OOM/crash (Gate 2 / Gate 4). Commit.

---

## Task 8: Clinical quality + demo artifact

**Files:** `docs/superpowers/decisions/2026-06-17-slice-quality-and-demo.md`

- [ ] **Step 1: Generate 10 sample notes** from 10 scripted consults; have a real clinician (or the closest available reviewer) rate each "usable with light edits?" (Gate 3, target ≥ 8/10). Record verbatim.
- [ ] **Step 2: If < 8/10**, tune the SOAP prompt/template (one iteration), re-rate. If still short, set cloud as quality carrier and local as "draft," and say so.
- [ ] **Step 3: Write + rehearse the 3-min demo script** (the acceptance script above). **Record a 2-3 min demo video** for the Aug Preliminary submission, leading with the airplane-mode moment.
- [ ] **Step 4: Commit** the quality doc + demo video link.

---

## Timeline (mapped to MAIC stages)

| Window | Do | Output |
| --- | --- | --- |
| **Now -> mid-Jul** | Run the **spike** plan to green (Gate 0) | runtime/model/redaction locked |
| **mid-Jul -> Aug** | Tasks 1-6 (the working slice) + Task 8 demo video | offline slice runs; **Preliminary submission** = deck + frozen prototype + demo video |
| **Aug -> Sep** | Tasks 7-8 hardening, clinician review, rehearse | **Semi-Finals live demo** in KL |
| **Sep -> Nov** | Stretch (coding / one Guardian hero), pursue a pilot LOI, commercial polish | **Grand Finals** |

The single most important deadline is the **spike going green** — it de-risks whether any of this is buildable. Do it first, before more product work.

---

## Risks + fallbacks

- **Local LLM too slow / OOM (Gate 2).** Fallback: cloud-on-de-identified as default summarizer; the offline demo still proves transcript + redaction on-device, with the offline-note path shown as near-term roadmap. Decide at Gate 0, do not discover on stage.
- **Redaction recall weak (Gate 1).** Deterministic Path B is the floor (IC/phone/email/date + gazetteer); ML NER is the upgrade. Never present sample recall as production recall.
- **Note quality below clinician bar (Gate 3).** Cloud path carries quality; local is labelled "draft." Honest framing beats a bad offline note.
- **Scope creep.** Every screen outside the mapping table above is a distraction from the one script that wins. If tempted, add it to the deck as roadmap, not to the build.
- **Two surfaces.** Guardian stays a single optional hero moment (camera vitals), not a second product, until after the scribe slice is demo-stable.

---

## Done when

- The spike decision doc is locked (Gate 0) and this plan records the chosen defaults.
- The privacy pipeline provably feeds only de-identified text to the summarizer; the re-ID map never leaves the device (Gate 1).
- record -> on-device note -> sign -> FHIR/PDF runs offline, 5/5, on the locked device (Gates 2 + 4).
- A clinician reviewer rates the notes usable (Gate 3), or the cloud-carries-quality fallback is documented.
- A 2-3 min demo video exists for the Aug submission, and the 3-min live script is rehearsed for Sep.

This plan deliberately ships ONE thing that runs. Breadth lives in the prototype and the deck; the win lives in this slice.

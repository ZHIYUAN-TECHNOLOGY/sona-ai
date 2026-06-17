# Sona — On-Device Ambient Medical Scribe (+ Guardian)

**Design spec — 2026-06-16**
**Competition:** MAIC Nexus Challenge, Track T2 — AI for Healthcare & Medical
**Status:** Approved direction, pre-implementation

---

## 1. One-line

Sona is a privacy-first, **on-device** ambient medical scribe for Malaysian (and emerging-market) clinicians: it listens to a consult in Malay/English/Manglish, writes a structured clinical note, and **never lets patient audio or identity leave the device**. A consumer-facing **Guardian** surface extends the same on-device engine to camera-based vitals and guided emergency response.

## 2. Problem

Clinicians spend ~2 hours/day on documentation. Existing ambient scribes (DeepScribe, Abridge, Heidi, Sully, Nuance DAX, mdhub Emma) are all **cloud-based**, **English-first**, and send patient audio off-device. That makes them:

- **Legally blocked or slow** in data-residency regimes (Malaysia PDPA, India DPDP, GDPR, MENA).
- **Useless offline** — no good in low-connectivity rural clinics.
- **Linguistically blind** to Malay / Mandarin / Tamil and Manglish code-switching.

The MAIC T2 track explicitly asks for _"ambient AI systems and intelligent workflows to automate clinical documentation… using privacy-focused, **local models**."_ The market gap and the competition prompt point at the same answer.

## 3. Target users & buyers

- **Primary:** private GP / specialist clinic doctor (paying per-seat). Buyer = clinic owner.
- **Secondary (B2G):** MOH public-clinic / hospital doctor. Buyer = hospital IT / ministry; requires on-prem/data-on-soil.
- **Guardian (consumer/national-impact):** patients, families, first responders, rural communities.

## 4. Why this wins the competition (rubric mapping)

| Rubric category       | Weight | How Sona scores                                                                                                                          |
| --------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Technical Feasibility | 25%    | Real, load-bearing pipeline: on-device STT + LLM + medical NER + PII redaction + multimodal rPPG. Not a GPT wrapper. Demos live.         |
| Commercial Viability  | 25%    | Proven category (per-seat SaaS, $50–119/seat/mo benchmarks) + B2G + near-zero marginal inference cost (on-device) = fat margins.         |
| Industry Relevance    | 20%    | Maps 1:1 to T2 wording; solves a real, current clinician pain.                                                                           |
| Scalability           | 15%    | SaaS; on-device inference scales with users at ~zero infra cost; platform expands scribe → coding → triage → Guardian.                   |
| ESG / National Impact | 15%    | PDPA data sovereignty, serves rural + public clinics, multilingual (BM/Manglish), Guardian saves lives offline. US rivals score ~0 here. |

**Demo wow:** flip airplane mode mid-demo → "audio never left the device, still works" → toggle cloud → show premium note quality. Then Guardian: measure a judge's heart rate from the camera, live.

## 5. Strategic moat (unicorn thesis)

The wedge is the one thing cloud incumbents structurally cannot do and the track rewards: **on-device, privacy-first, multilingual clinical AI for the markets cloud scribes can't reach** (SEA → India → MENA → LatAm → Africa).

- **Cost moat:** local inference ≈ $0 marginal/min; cloud rivals bleed GPU/LLM-API per minute.
- **Privacy/law moat:** audio never leaves device → clears PDPA/DPDP/GDPR data-residency.
- **Connectivity moat:** works offline → rural + emergencies.
- **Land-and-expand:** scribe is the front door → coding/billing, triage, decision support, EHR, Guardian.

Positioning: _"The privacy-first ambient scribe for the world's other 6 billion patients — runs on the doctor's own phone, in their own language, no cloud required."_

## 6. System architecture

Two surfaces, one on-device engine.

| Component                  | Runs where                            | Responsibility                                                                    |
| -------------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| **Capture app** (RN bare)  | Doctor phone/tablet                   | Consent → record → live transcript → review/sign                                  |
| **Voice pipeline**         | On-device                             | VAD → STT (Whisper/Moonshine), multilingual code-switch                           |
| **Privacy gate**           | On-device                             | OpenMed PII-NER de-identifies transcript; holds re-ID map locally                 |
| **Summarizer** (dual path) | On-device LLM **or** cloud Claude     | De-identified text → SOAP + entities                                              |
| **Clinical NER**           | On-device                             | OpenMed tags Dx / drug / anatomy → problem list, med list, ICD-10                 |
| **Guardian engine**        | On-device                             | rPPG vitals (Shen.ai), VLM pill-ID, MediaPipe FaceMesh (FAST), first-aid guidance |
| **Backend**                | Cloudflare Workers (+ on-prem option) | oRPC API, auth, encrypted sync, audit log, FHIR/PDF export, Claude proxy, billing |

## 7. Data flow — the privacy pipeline (the moat, enforced in code)

```
Consent toggle
  → mic → VAD → STT (on-device)   → raw transcript [encrypted, on-device only]
  → PII-redaction (on-device)     → de-identified text  +  re-ID map [stays on device]
  → summarize:
        OFFLINE → local LLM
        ONLINE  → TLS → Claude (only de-identified text leaves device)
  → SOAP note returns
  → re-ID map reapplied locally   (names reinserted on-device)
  → doctor reviews / edits / signs
  → export FHIR R4 + PDF          → immutable audit log
  → raw audio discarded after transcript (configurable retention)
```

**Hard rule (enforced, not policy):** only de-identified text may ever cross the device boundary. The re-ID map never leaves the device. If redaction confidence is low, cloud send is blocked and the app falls back to local-only.

## 8. Feature roadmap (scope + timeline)

### P0 — preliminary artifact + demo video (target 4–6 weeks, before Aug)

1. Record consult (mobile)
2. On-device STT, live transcript, EN + BM code-switch
3. On-device PII redaction (OpenMed)
4. SOAP generation — cloud Claude on de-identified text + **offline local-LLM toggle**
5. On-device clinical NER → problem list + med list + **orders/follow-ups/referrals extraction** (action items the doctor voiced)
6. Doctor review / edit / sign screen
7. Export PDF + copy-to-clipboard
8. Consent capture + audit log

(9 features; this alone passes prelim.)

### P1 — semi-finals / KL demo day (Sep)

9. Web clinician dashboard (Vite) — history, edit, export
10. FHIR R4 export (DocumentReference / Encounter)
11. Summary-language choice (BM consult → EN note) + specialty SOAP templates
12. Auth + encrypted multi-device sync (oRPC / Workers / Neon)
13. Auto **ICD-10 + E/M coding** surfaced from NER — audit-ready, with a charge-captured / "code the typed note misses" revenue readout
14. Accuracy-metrics screen (WER, acceptance rate) — pitch ammunition
15. **🦸 Guardian hero:** on-device camera vitals (rPPG / Shen.ai) + guided emergency escalation
15a. **On-device symptom triage:** sorts symptoms to a safe next step (self-care → see GP → urgent → 999) with a red-flag safety net. Borrows the "AI Triage Nurse" value, no EHR/telephony needed.
15b. **On-device adaptive learning ("Note style"):** personalizes note structure/phrasing per clinician from accepted edits + plain-language rules, stored and applied locally. DeepScribe's differentiator, re-cast as a privacy moat (no cloud training on PHI).

### P2 — grand finals (Nov) / scale + moat

16. On-prem / self-host backend (MOH; data stays on soil)
17. Coding/billing automation module (land-and-expand)
18. Subscription / billing (Stripe), admin console
19. Mandarin + Tamil; speaker diarization (doctor vs patient)
20. EMR integration + public API
21. Guardian polish: FAST stroke screen (FaceMesh), offline first-aid/CPR coaching, pill/drug identifier (VLM) with **on-device interaction check against the patient's own med list** (the "AI Pharmacist" value, local drug DB)

## 8a. Competitor read — Sully.ai (and why we don't clone it)

Sully ships a **horizontal cloud suite** of "AI employees" (Triage Nurse, Receptionist, Consultant, Scribe, Pharmacist, Medical Coder) + EHR Bridge + multi-model Consensus. Their moat is breadth + integrations + US enterprise distribution — un-clonable in a hackathon and reads as vaporware if attempted. Our moat is the one thing every Sully agent is not: **fully on-device**. Decision: cherry-pick only the agents that sharpen the on-device wedge, skip the cloud/telephony/EHR plumbing.

- **Fold in:** Medical Coder → audit-ready ICD-10/E-M + charge capture (P1.13). Consultant → already = Ask Sona. Triage Nurse → on-device symptom triage (P1.15a). Pharmacist → drug-interaction check in pill-ID (P2.21).
- **Skip:** Receptionist (telephony/scheduling, zero on-device story), full EHR Bridge (keep light FHIR export only), Consensus (multi-cloud-model → kills the $0/min cost moat).
- **Steal as a pitch asset, not a feature:** their ROI Calculator → a defensible ROI number in the deck (~2 hrs/day back, RM 30k+/clinician/yr, ~$0/consult-minute).

## 8b. Competitor read — DeepScribe (and what we adopt)

DeepScribe is a pure ambient scribe (no Guardian). Workflow: select patient from schedule → record → review in EHR → sign. Headline differentiator: **"learns your style, absorbs every edit, applies it to future notes."** Claims 99.92% note approval, 1.6-min chart closure.

- **Adopt (it sharpens our moat):** **on-device adaptive learning** — the note model personalizes per-clinician *locally* from accepted edits + plain-language rules. This is DeepScribe's top selling point AND a moat amplifier: cloud rivals train on clinician/PHI data; Sona's personalization never leaves the device. Surfaced as a "Note style" screen (learned rules + custom-instruction line).
- **Adopt (depth, no new infra):** **orders / follow-ups / referrals extraction** — beyond SOAP, pull the action items the doctor voiced ("review in 1 week", "FBC if fever persists", safety-net advice). Captures what otherwise goes undocumented. Added as a note section.
- **Fold in lightly:** schedule-led entry → a mini day-agenda on the Today home (tap → pre-visit), not a cloud calendar/EHR sync. Mirror their chart-closure-time metric on the dashboard.
- **Skip:** EHR-review-then-sign step (their cloud/EHR dependency; we export FHIR/PDF).

## 9. Sona Guardian (scoped emergency surface)

**Build for comp:** camera vitals (rPPG) + guided emergency escalation + on-device symptom triage. **Roadmap:** FAST stroke screen, offline first-aid coaching, pill-ID with interaction check.

**Safety reframe — non-negotiable:** Guardian **detects warning signs, measures vitals, guides first response, and escalates to 999 / a clinician.** It does **not** diagnose conditions or prescribe treatment. A laypeople-facing "diagnose + cure a heart attack from video" feature is a regulated medical device (SaMD) with maximum liability and a false-negative can kill — explicitly out of scope. Guardian mirrors the scribe's doctor-in-the-loop rule: human + emergency services always in the loop.

## 10. Tech stack (locked)

- **Mobile:** React Native **bare** (native-bare) — required for on-device ML native modules.
- **API:** **oRPC** (type-safe) on **Cloudflare Workers**.
- **DB:** **Neon Postgres** via Hyperdrive binding.
- **Web dashboard:** **Vite**, deployed on Cloudflare.
- **IaC / deploy:** **Alchemy.run** (TypeScript) provisioning Workers + Hyperdrive→Neon + R2 (exports) + KV/D1 (audit/config) + optional Durable Objects (sync) + optional Workers AI (de-identified premium STT/LLM).
- **On-device engine:** Whisper/Moonshine STT · **Gemma 4 E4B/E2B local LLM** (edge-optimized, 140 languages incl. Malay, multimodal) with Qwen3-1.7B as the runs-today fallback · OpenMed PII + clinical NER (quantized/ONNX) · rPPG (Shen.ai SDK) · multimodal VLM (Gemma 4 E-series / Moondream / SmolVLM) for pill-ID · MediaPipe FaceMesh for FAST.
- **On-device runtime candidates:** RN-ExecuTorch (ships Whisper + Qwen/Llama/Phi/LFM2, **no Gemma**) vs **Google AI Edge / LiteRT (MediaPipe)** vs RunAnywhere — Gemma 4 needs LiteRT or RunAnywhere; decided by the week-1 spike.
- **Cloud premium path:** Claude (`claude-opus-4-8` / `claude-sonnet-4-6`) via Workers — de-identified text only.

**Stack constraint:** Cloudflare Workers cannot run heavy Python ML (OpenMed transformers). This is by design — all PHI-touching ML runs on-device; Workers only does orchestration, auth, sync, FHIR, Claude proxy, billing. Any future server-side ML uses Workers AI or a separate container service.

## 11. Clinical safety & error handling

- **Doctor-in-the-loop always** — AI drafts, the MD signs. Never auto-finalize.
- **Hallucination guard** — every SOAP line traces to a transcript span (tap a line → see evidence). Doses are _extracted_, never generated; never invent meds.
- **Redaction fail-safe** — low redaction confidence blocks cloud send and forces local-only.
- **Offline fallback** — cloud unreachable → local LLM, with a clear notice.
- **PDPA** — consent before recording, encryption at-rest + in-transit, immutable audit, configurable retention, raw audio discarded post-transcript.
- **Regulatory framing** — documentation aid, MD responsible; Guardian = screening/guidance, not diagnosis. Not marketed as a diagnostic device.

## 12. Testing strategy

- **STT accuracy** — WER on scripted BM/EN/Manglish role-play consults (headline pitch metric).
- **Redaction recall** — ≥ target on synthetic PHI; weight recall over precision (a false negative = a leak).
- **SOAP quality** — vs MD-written reference + clinician acceptance rate.
- **E2E** — happy path, offline path, redaction-fail path.
- **Pilot** — 2–3 friendly clinics for real-world signal + testimonials (boosts Commercial + Relevance scoring).

## 13. Top risks & mitigations

| Risk                                | Mitigation                                                          |
| ----------------------------------- | ------------------------------------------------------------------- |
| Phone too slow for on-device models | Quantize, smaller models, week-1 perf spike, demo on a newer device |
| BM/Manglish STT accuracy weak       | EN-primary fallback, collect MY medical audio, prompt-tune          |
| Redaction leak                      | Fail-safe block + local-only mode; recall-weighted testing          |
| Regulatory pushback                 | Doc-aid framing, MD-in-loop, Guardian = guidance not diagnosis      |
| Scope creep (two surfaces)          | P0 frozen for prelim; Guardian gated to P1 hero only                |
| Workers can't host PHI ML           | By design — PHI ML stays on-device                                  |

## 14. Business model

- **SaaS per-seat** (benchmark $50–119/seat/mo) — private clinics; tiers map to the local-only (max-privacy) vs cloud-premium (top-quality) paths.
- **B2G / enterprise** — MOH public clinics, on-prem, custom.
- **Expansion** — coding/billing automation, EHR integration, Guardian consumer/B2B2C.

## 15. Milestones

- **Jun–Jul 2026** — P0 build; week-1 on-device runtime spike; scripted-consult dataset; apply to MAIC.
- **Aug 2026** — online prelim: submit pitch deck + summary + AI disclosure + demo video + artifact link.
- **Sep 2026** — semi-finals (KL demo day): P1 + Guardian hero live demo + pilot testimonials.
- **Nov 2026** — grand finals: P2 scale features + full platform pitch.

# Sona — Feature Roadmap to Win MAIC & Become the Next Healthcare Unicorn

**Product:** Sona — the offline, on-device ambient medical scribe built for Malaysia (and ASEAN).
**Audience for this doc:** core team + judges.
**Date:** June 2026.
**Prototype:** the full app is built and visualized — `docs/prototype/sona-prototype.html` (interactive, animated) — **42 screens across 9 sections**: onboarding · the offline consult · outputs · paperwork & claims · clinical intelligence + AI team · clinic-owner desktop · settings/library/states · the patient app · safety & data-flywheel.

---

## 1. The thesis in one paragraph

Every leading AI scribe — Heidi, DeepScribe, Sully, Microsoft Dragon, Abridge — is **cloud-first and US-EHR-first**. Their entire architecture sends patient audio to a data centre, bills per cloud-minute, codes to US billing standards, and struggles with intra-sentence code-switching. Sona inverts all of it: **the AI runs on the doctor's phone, no patient data ever leaves the device, it understands how Malaysians actually speak (BM + English + Mandarin + Tamil + dialects mid-sentence), and the marginal cost per consult is ~zero.** That is not a feature the incumbents can bolt on — it is the opposite of how they are built. It is also exactly what wins a Malaysian national AI competition judged on technical feasibility, commercial viability, industry relevance, scalability, and national/ESG impact — and it is the wedge into a multi-billion-dollar ASEAN clinical-documentation market that no US player is positioned to take.

---

## 2. Why this can win MAIC (rubric map)

| MAIC axis | Weight | How Sona scores maximum |
|---|---|---|
| **Technical feasibility** | 25% | Working on-device pipeline (STT → PII redaction → LLM → re-identify) on real Malaysian open models (mesolitica + OpenMed), all Apache-2.0/MIT. Live demo in airplane mode. |
| **Commercial viability** | 25% | Zero marginal cloud cost → margins incumbents can't match; clear per-seat SaaS + enterprise tiers; a design-partner clinic with quantified time-saved. |
| **Industry relevance** | 20% | Doctor burnout + documentation burden is the #1 operational pain in Malaysian primary care; paperwork (MC, referral, MMC/MoH formats) automated. |
| **Scalability** | 15% | On-device = no per-user server cost; same app scales from a solo GP to a hospital network to ASEAN with no infra rebuild. |
| **ESG / national impact** | 15% | Data sovereignty (PDPA, stays in-country), serves rural/low-connectivity clinics, multilingual equity (Tamil/Mandarin/BM patients understood), built on Malaysian models. |

**Theory of victory:** "Proof it's real." A live, offline demo on a phone + a real design-partner clinic + quantified outcomes beats slideware. Everything below serves that.

---

## 3. Competitive landscape (what we're up against)

| Capability | Heidi | DeepScribe | Sully | Dragon | Abridge | **Sona** |
|---|---|---|---|---|---|---|
| Ambient note (SOAP/DAP) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Custom templates | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (P1) |
| Coding / ICD / billing | partial | ✅ E/M+HCC | via agent | partial | ✅ RCM | ✅ ICD-10-AM + panel/Takaful (P1) |
| Pre-charting | — | ✅ SmartPrep | — | — | ✅ | ✅ (P1) |
| Linked evidence | ✅ | — | — | ✅ | ✅ verifiable | ✅ timestamp-grounded (P1) |
| Multi-agent staff | — | — | ✅ 7 agents | — | — | ✅ (P2) |
| Languages | 110+ | 25+ | via agent | multi | multi | **rojak code-switch, BM/EN/中文/Tamil + dialects** |
| **Runs fully offline (inference on-device)** | capture only | ❌ | capture only | ❌ | ❌ | ✅ **only one** |
| **PHI never leaves device** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **only one** |
| **Data residency in-country** | ❌ US | ❌ US | ❌ | cloud | ❌ US | ✅ **only one** |
| Local EHR / MyKad / MoH formats | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Marginal cost / consult | cloud $ | cloud $ | cloud $ | cloud $ | cloud $ | ~$0 |

**The five structural moats** (architecture, not features — incumbents can't copy without rebuilding):
1. **On-device inference** — the model runs on the phone, not the cloud.
2. **Privacy-by-architecture** — raw audio, transcript, and re-identify map never leave the device; only de-identified text may cross the device boundary, and only on the optional cloud-premium path.
3. **Data sovereignty** — PHI stays in-country/on-device → wins government & hospital tenders no US player can bid.
4. **Rojak fluency** — real Malaysian code-switching + local drug/brand names, on Malaysian models.
5. **Zero marginal cost** — no per-consult cloud bill → pricing and margins the incumbents structurally can't match.

---

## 4. The model stack (all commercial-safe)

| Stage | Model | Params | License | Why |
|---|---|---|---|---|
| Speech-to-text | `mesolitica/Malaysian-whisper-large-v3-turbo-v3` | ~0.8B | **MIT** | Best-tested Malaysian STT; ms/en/zh/ta code-switch; turbo = fast on-device. Lighter fallback: `malaysian-whisper-small-v3` (~0.2B, Apache-2.0, word-level timestamps). |
| PHI redaction (NER) | `OpenMed/privacy-filter` (MLX-8bit) | quantized | **Apache-2.0** | Purpose-built HIPAA-style de-identification; ready-made on-device MLX build for Apple Silicon. |
| Clinical entity extraction | `OpenMed-NER-DiseaseDetect / PharmaDetect / AnatomyDetect ElectraMed` | 109–149M | **Apache-2.0** | Tiny; tags conditions, drugs, anatomy on-device. |
| Generative note LLM | `mesolitica/Malaysian-Qwen2.5-7B-Instruct` (4-bit) | ~7B | **Apache-2.0** | Instruct, ms/en/zh/ta; writes SOAP + paperwork. Smaller-device fallback: 1.5B variant. |
| TTS (optional readback) | `mesolitica/Malaysian-TTS-0.6B-v1` | 0.6B | **Apache-2.0** | Voice readback of patient summary. |

**License discipline:** avoid MaLLaM (unstated license) and Llama-3.2 (restricted Community License) in the shippable core. Add a **rules layer for dosage/frequency** (OpenMed gives drug *name* only) and an **ICD-10-AM terminology linker** (OpenMed gives spans, not codes).

> **The moat rule (product + code, verbatim):** Raw audio, the transcript, and the re-identify map NEVER leave the device. Only de-identified text may cross the device boundary, and only on the optional cloud-premium path.

> **Doctor-in-the-loop, always:** AI drafts, the MD signs. Never auto-finalize. Doses and clinical values are *extracted from the audio*, never generated.

---

## 5. Feature roadmap (tiered)

Tags: **[Stakes]** = needed to look professional · **[Moat]** = our unfair advantage · **[Revenue]** = monetisation lever · **[Borrow:X]** = inspired by competitor X.
Phases: **P0** = MAIC demo (build now) · **P1** = pilot/post-comp · **P2** = scale/unicorn.

### Tier 0 — Table-stakes (match or look amateur)
- **[Stakes][P0]** Ambient passive listening (no wake word), in-room + tele-consult; phone mic.
- **[Stakes][P0]** Structured note generation — **SOAP** (+ DAP/H&P templates P1) — not raw transcript.
- **[Stakes][P0]** Clinician edit + e-sign gate before anything is finalized; version/edit tracking.
- **[Stakes][P0]** After-visit / patient summary in plain language.
- **[Stakes][P0]** PDF export.
- **[Stakes][P1]** Custom templates that learn the clinician's style (Customization Studio equivalent). **[Borrow:DeepScribe]**
- **[Stakes][P1]** Multi-specialty output (GP first; then specialists).
- **[Stakes][P1]** EHR/HIS write-back (FHIR R4 + local clinic CMS connector).
- **[Stakes][P0]** Security: on-device encryption, RBAC, full audit log, **PDPA + (HIPAA-aligned)** posture.

### Tier 1 — The Moat (what wins MAIC, can't be copied)
- **[Moat][P0]** **Fully offline operation** — entire pipeline runs in airplane mode. *Demo this live.*
- **[Moat][P0]** **Privacy-by-architecture** — visible on-device pipeline; raw audio discarded after note; nothing leaves device. Privacy/consent gate as the first screen.
- **[Moat][P0]** **Rojak code-switch transcript** — BM + English + Mandarin + Tamil + dialects, **color-coded by language live** (the headline visual). Local drug/brand-name recognition.
- **[Moat][P0]** **Timestamp-grounded note** — every clinical line in the SOAP note links back to the exact transcript moment it came from (audit-grade traceability; beats incumbents' "linked evidence"). **[Borrow:Abridge, improved]**
- **[Moat][P0]** **Doctor-in-the-loop safety layer** — low-confidence flags on uncertain entities; doses shown as "extracted from audio," never generated; nothing auto-finalizes.
- **[Moat][P1]** **Data-sovereignty mode** — on-prem/on-device guarantee as a sellable product for govt/hospital tenders; PDPA artifacts (DPIA, data-flow diagram, residency attestation) generated.
- **[Moat][P1]** **Malaysian paperwork automation** — MC (medical certificate), referral letter (MoH format), prescription, **ICD-10-AM** coding, MyKad/IC patient identity.
- **[Moat][P1]** **Live consult interpreter** — real-time BM⇄EN⇄中文⇄Tamil captions during the visit (Sully charges extra for this; we make it core). **[Borrow:Sully, free]**

### Tier 2 — Revenue & growth (the unicorn engine)
- **[Revenue][P1]** **Coding & claims module** — ICD-10-AM auto-suggestion + **panel / insurance / Takaful claim formatting** for Malaysian payers. Ties directly to clinic revenue → high willingness-to-pay. **[Borrow:Abridge/DeepScribe, localized]**
- **[Revenue][P1]** **Pre-charting / SmartPrep** — pull the patient's prior notes/meds/labs forward before the visit; surface care gaps. **[Borrow:DeepScribe]**
- **[Revenue][P1]** **Timestamp-grounded clinical evidence** — surface guideline/drug-interaction references at point of care, each linked. **[Borrow:Abridge]**
- **[Revenue][P2]** **Multi-agent clinic staff** — beyond scribe: AI receptionist (appointment calls), AI nurse (intake/triage), AI coder (claims), AI pharmacist (interaction check). Reframes Sona from "scribe" to "the AI operating layer for a clinic." **[Borrow:Sully]**
- **[Revenue][P2]** **Practice dashboard** — time saved, note volume, claim acceptance, panel utilisation; per-clinician analytics for clinic owners.
- **[Revenue][P2]** **Patient-communications** — automated follow-up, recall, multilingual after-visit messaging. **[Borrow:Heidi Comms]**

### Tier 3 — Platform / unicorn expansion
- **[P2]** **ASEAN localization** — Indonesia (Bahasa Indonesia), Thailand, Philippines, Vietnam: same on-device architecture, swap the language model. Massive TAM, same code.
- **[P2]** **Data flywheel (consented, on-device federated learning)** — improve models from corrections *without* centralizing PHI; a durable, privacy-preserving moat that compounds.
- **[P2]** **Model & template marketplace** — specialty templates, language packs, third-party clinical modules.
- **[P2]** **Clinic OS** — billing, inventory, scheduling on top of the documentation layer → become the system of record, not a plugin.
- **[P2]** **Medico-legal vault** — timestamp-grounded, signed, immutable records as a defensibility product for malpractice protection.

---

## 6. What to build for the MAIC demo (P0 scope)

**The full app is already visualized** as a 42-screen, 9-section interactive prototype (`docs/prototype/sona-prototype.html`). For the judge-facing demo — a **live, offline phone walkthrough** of one consult plus the clinic-owner story — P0 = the screens below, built fully working (everything else is designed and storyboarded in the prototype):

1. Today's clinic (queue, offline status, time-saved-today)
2. Pre-charting card (patient context surfaced)
3. Consent & privacy gate (privacy as the *first* action)
4. **Live consult — ambient record with rojak color-coded transcript** (the hero)
5. On-device pipeline (3 models, de-identification, "airplane mode" badge)
6. Review & sign (SOAP + low-confidence flags + extracted-dose + ICD-10 + timestamp-grounding)
7. Paperwork (MC / referral / prescription auto-generated)
8. Multilingual patient summary (BM/EN/中文/Tamil)
9. Signed & exported (PDF + FHIR + CMS push + audit; raw audio discarded)
10. Live interpreter (consult captions)
11. Practice dashboard (desktop — the scalability/commercial story)
12. Compliance & sovereignty panel (desktop — PDPA artifacts, audit, model versions)

---

## 7. Business model (unicorn math)

- **Freemium solo GP** — unlimited offline notes, standard templates; converts on paperwork + coding.
- **Clinician Pro** — ~RM X/seat/mo: coding/claims, pre-charting, templates, evidence.
- **Clinic / Enterprise** — per-site: dashboard, admin, EHR/HIS integration, sovereignty mode, SSO.
- **Government / hospital tenders** — data-sovereignty deployments US players can't legally bid.
- **Why the margin wins:** on-device inference = ~zero marginal cost per consult. Incumbents pay cloud GPU minutes on every visit; we don't. That gap funds either fatter margins or a price the incumbents can't match — the classic disruptor wedge.
- **TAM path:** Malaysian private GPs & clinics → Malaysian hospitals & govt clinics → ASEAN primary care (same architecture, swap the language model). Documentation is the wedge; the Clinic OS + claims layer is the expansion.

---

## 8. Risks & how we retire them

| Risk | Mitigation |
|---|---|
| On-device performance unverified | **The spike** — bench the locked models on a phone (tok/s, RAM, WER, PII recall, E2E latency). GO/NO-GO before building. |
| Clinical safety / hallucination | Doctor-in-the-loop sign-off; doses extracted-not-generated; timestamp-grounding; low-confidence flags. |
| Regulatory (MDA Act 737) | Positioned as a documentation aid, not a diagnostic medical device. |
| Model licensing | Locked to Apache-2.0/MIT only; MaLLaM & Llama excluded from core. |
| Coding accuracy (no ICD in OpenMed) | Add ICD-10-AM terminology linker + clinician confirm step. |

---

*Next step after this doc: run the on-device spike (the only gating risk), then build the P0 demo screens. The prototype in `docs/prototype/` visualizes the target.*

# Sona — On-Device Ambient Clinic Copilot

**Team:** ZHIYUAN TECHNOLOGY
**Competition:** MAIC Nexus Challenge — Track T2: AI for Healthcare & Medical
**Status:** Concept locked · Full **42-screen UI prototype built** (9 sections) · Model stack revised on competitive research · **On-device spike Phase-0 = GO** (Mac: 1.5B 177 tok/s, 7B 72 tok/s; SOAP in ~2–6 s; STT well under bar) — phone confirm next
**Last updated:** 2026-06-24
**Prototype:** `docs/prototype/sona-prototype.html` (interactive, animated — open in a browser) · static exports `sona-app-part1.png` + `sona-app-part2.png`. Feature plan: `docs/sona-feature-roadmap.md`.

---

## TL;DR

Sona is an **offline, privacy-first ambient medical scribe** for Malaysian clinics. A doctor talks to a patient normally — in any mix of Bahasa Melayu, English, Mandarin, and Tamil — and Sona listens, then writes the clinical note and all the paperwork (medical certificate, referral, prescription, diagnosis codes). The doctor reviews, edits, and signs. The whole thing runs **on the phone, with no internet**, so patient data never leaves the device.

We win because we own five things **no competitor can match** — they are all locked out by their cloud architecture: **true offline operation, Malaysian code-switched ("rojak") understanding, on-device data residency (PDPA), local clinic-system integration, and Malaysian-clinic pricing.**

---

## 1. The Problem

Doctors spend up to **two hours a day** on documentation and admin — typing notes, filling medical certificates, writing referrals, coding diagnoses. It is the number-one driver of clinician burnout worldwide, and it steals time from patients.

Existing AI scribes are built for English-speaking markets and run in the **cloud** — patient health data is uploaded to overseas servers. For Malaysia this fails on three fronts:

1. **Language** — they don't understand how Malaysians actually speak (code-switching across BM, English, Mandarin, Tamil, plus dialect, often within one sentence).
2. **Privacy & data residency** — uploading patient data abroad clashes with Malaysia's PDPA 2024 and clinic trust.
3. **Connectivity** — many clinics, especially rural and public ones, can't rely on stable internet.

## 2. The Solution — What Sona Does

A general-practitioner switches Sona on at the start of a consult and talks to her patient the way she always does. At the end:

- Sona has produced a structured **SOAP note** (Subjective / Objective / Assessment / Plan).
- It has drafted the **medical certificate (MC)**, **referral letter**, and **prescription**.
- It has suggested **ICD-10 diagnosis codes**.
- The doctor reviews everything on screen, edits anything, and **signs**.
- Output is exported as **PDF** and **FHIR**, with a full audit trail.

Total time: roughly **30 seconds** of review instead of several minutes of typing. And critically — **it all works in airplane mode.**

> **Doctor-in-the-loop, always.** Sona *drafts*; the doctor *signs*. It never auto-finalizes a record. Medication doses are *extracted* from what was said, never invented. This keeps Sona a documentation aid — not a regulated medical device under Malaysia's MDA Act 737.

**Beyond the single consult**, Sona is a complete clinical workflow — visualized end-to-end in our prototype (42 screens, 9 sections):

- **Before the visit:** first-run onboarding + one-time on-device model setup; **pre-charting** that surfaces prior notes, meds, allergies and care gaps.
- **The consult:** consent gate → live rojak transcript → on-device pipeline → review & sign → inline edit.
- **Outputs:** SOAP note, MC, referral letter, prescription (with allergy + interaction check), **coding & claims** (ICD-10-AM + panel / Takaful), multilingual patient summary, live consult interpreter.
- **Clinical intelligence:** linked evidence (cited MoH CPGs) + a **multi-agent "AI clinic team"** — receptionist, nurse-triage, coder, pharmacist, interpreter.
- **Clinic-owner web app:** practice dashboard (hours saved, claim acceptance), patient records & timeline, template editor, team & billing, and a **compliance & data-sovereignty** console.
- **The patient's phone:** visit summary in their own language, e-consent, appointments & recall.
- **The flywheel:** on-device **federated learning** — corrections improve the models, PHI never leaves the device.
- **Production states:** loading skeleton, success toasts, claim-submitted, consent-declined, low-storage / model-update, empty state, mic-permission denied, offline/sync.

## 3. How It Works — The Pipeline (and the Moat)

```
  Consult audio (on phone)
        │
        ▼
  [1] Speech-to-text ............. malaysian-whisper-small-v3   → transcribe "rojak" speech
        │
        ▼
  [2] PII redaction .............. OpenMed-PII (NER)            → strip patient identifiers
        │
        ▼
  De-identified text  ──────────── (re-identify map stays on device, encrypted)
        │
        ▼
  [3] Summarize ................. Malaysian-Qwen2.5 (on-device) → write SOAP + MC + referral + Rx + ICD-10
        │
        ▼
  [4] Re-identify (local) ........ map reapplied locally        → real names back in
        │
        ▼
  [5] Doctor review + e-sign
        │
        ▼
  [6] Export: PDF + FHIR R4 + audit log     ·     raw audio discarded
```

### The privacy moat (core IP — non-negotiable)

> **Raw audio, the transcript, and the re-identify map NEVER leave the device. Only de-identified text may cross the device boundary, and only on the optional cloud-premium path.**

This is **privacy by architecture**, not privacy by promise. A clinic's IT auditor — or a competition judge — can verify it by watching the network: with the phone offline, the entire flow still completes. A cloud scribe physically cannot demonstrate this.

## 4. Competitive Landscape

The market is real and funded (Heidi is valued at ~USD 465M; Abridge at ~USD 5.3B) — which makes our category *investable*. But every serious player is cloud-first, and each leaves the Malaysian-specific gaps wide open.

| Competitor | Presence | Offline? | Code-switch (rojak) | PDPA / MY data residency | MY price | Where we beat them |
|---|---|---|---|---|---|---|
| **Heidi** | en-MY page + Singapore hub | No (on-device STT only; LLM cloud) | No — per-language only | No PDPA claim | ~RM650/mo | offline, rojak, residency, local CMS, price |
| **Sully** | US / UAE | No | Interpreter 17 langs — **no Malay** | No | ~USD99/mo | offline, Malay, residency |
| **DeepScribe** | US | No | English / Spanish only | No | ~USD350–750/mo | nearly everything for MY |
| **Abridge** | US | No | 28 langs, English note output | No (US-only) | ~USD2.5–7k/yr | not present in MY |
| **MS Dragon Copilot** | US / EU (9 countries) | No | 58 langs but English output; Malay flagged "lower accuracy" | Not MY | ~USD369–830/mo | not in MY, offline, price |
| **Qmed Asia** | **Malaysia (local)** | Likely no (cloud) | Mixed-language yes | Unclear | n/a | offline + privacy-by-architecture + deeper code-switch |

**Five gaps no competitor fills** — and all five are *structural* (their cloud architecture forbids offline; they cannot bolt it on):

1. **Offline / on-device** operation
2. **Rojak code-switching** (intra-sentence Malay + English + Mandarin + Tamil)
3. **PDPA / on-device data residency** (data never leaves the phone or the country)
4. **Local clinic-system (CMS) integration**
5. **Malaysian clinic-economics pricing** (RM, not USD)

> **Note on Qmed Asia** — a local player already runs a MaLLaM-based cloud scribe in Malaysia. Judges may know it. It is our real local benchmark, and our differentiation against it is explicit: **on-device offline + privacy-by-architecture + deeper code-switching + a fine-tuning data flywheel.** We name it in the pitch rather than pretend it doesn't exist.

## 5. Tech Stack

### On-device AI core (runs locally, offline) — all commercially licensed

| Role | Model | Size | License | Notes |
|---|---|---|---|---|
| Speech-to-text | **Malaysian-Whisper-large-v3-turbo** (Mesolitica) · light fallback `malaysian-whisper-small-v3` | ~0.8B / 0.2B | MIT / Apache-2.0 | Best-tested Malaysian STT; covers Malay + Manglish + Mandarin + Tamil code-switch; word-level timestamps |
| PII redaction (**the moat**) | **OpenMed privacy-filter** (Apple MLX / ONNX) | quantized | Apache-2.0 | HIPAA-style de-identification; ready-made on-device Apple-silicon build |
| Clinical entity tagging | **OpenMed-NER (ElectraMed)** — disease / drug / anatomy | 109–149M | Apache-2.0 | Tiny on-device entity extraction; mix per entity type |
| Note + paperwork generation | **Malaysian-Qwen2.5-7B-Instruct** (premium) · `-1.5B` (phone fallback) | 7B / 1.5B | Apache-2.0 | Writes SOAP + MC + referral + Rx + ICD-10; ~4.5 GB / ~0.9 GB at 4-bit; trains Malay+English+Mandarin+Tamil+dialects |

**Important model decisions (from research, 2026-06-22):**

- We use **Malaysian-Qwen2.5**, not the original MaLLaM Gen-1. This fixes two risks at once: (a) the license is now **clean Apache-2.0** (Gen-1 weight cards had no SPDX license tag), and (b) Gen-2 explicitly trains Mandarin and Tamil, which Gen-1 handled weakly. We keep "MaLLaM / Mesolitica sovereign model" as the pitch label — the lineage is honest.
- **Avoid the 3B size.** `Malaysian-Qwen2.5-3B` inherits the **Qwen Research License (non-commercial)** — a trap. Use the 1.5B or 7B (both Apache-2.0).
- **OpenMed gaps to engineer around:** it does *not* yet tag dosage/route/frequency, and does *not* yet do ICD-10 concept linking (on their roadmap for Q1 2026). So the **LLM** produces ICD-10 suggestions and extracts doses (doctor verifies); OpenMed handles **PII redaction** (the moat) and entity tagging.
- **Platform:** OpenMed runs natively on iOS (Apple MLX / OpenMedKit). Android needs a manual ONNX export + INT8 quantization. → **We build the competition demo iOS-first**, Android on the roadmap.

### Fine-tuning path (confirmed supported)

- **LLM:** Unsloth QLoRA (Qwen is first-class; 1.5B needs ~3.5 GB VRAM, 7B ~5 GB — a free Colab T4 suffices) → export **GGUF (q4_k_m)** → run on phone via llama.cpp / llama.rn.
- **STT:** fine-tune Whisper separately (Unsloth or HuggingFace) on Malay clinical speech.
- **NER:** fine-tune OpenMed encoders with HuggingFace `Trainer` (not Unsloth — it doesn't cover token-classification).
- **Training data:** semi-synthetic — a large LLM generates realistic Malaysian code-switched consults + labels; a human-verified slice anchors quality. (We have no live clinical data yet; this is how we bootstrap, and it becomes a data flywheel once we have a design partner.)

### Application stack (control plane only — carries no patient health data)

- **Mobile:** Expo (bare React Native) · **API:** oRPC on Cloudflare Workers · **Data:** Neon Postgres + Hyperdrive (accounts, billing, audit metadata — **no PHI**) · **Web:** Vite · **Infra-as-code:** Alchemy.run · monorepo via Better-T-Stack.

## 6. Feature Roadmap

Tags: **[Moat]** = no competitor has it · **[Borrow: X]** = proven feature worth copying from rival X.

| Phase | Feature | Tag | Rubric axis |
|---|---|---|---|
| **P0 — Competition core** | Ambient record → SOAP note | table-stakes | Tech / Relevance |
| | **Rojak code-switch note** (intra-sentence mixing) — *the headline* | **[Moat]** | Tech / Relevance / ESG |
| | **Offline / airplane-mode** — *the hero demo* | **[Moat]** | Tech |
| | Auto MC + referral + prescription draft | — | Commercial |
| | ICD-10 suggestion (LLM, doctor-verified) | — | Commercial |
| | Review + e-sign + **safety layer** (doses extracted-not-generated, low-confidence flags, citations) | [Borrow: Abridge] | Tech / Q&A |
| | **PDPA / data-stays-on-device + consent + audit log** (visibly demonstrated) | **[Moat]** | ESG |
| | PDF + FHIR R4 export | — | Scalability |
| **P1 — Investability** | **Local CMS integration** (one MY system) | **[Moat]** | Commercial / Scale |
| | **AI Interpreter** — live Malay/Mandarin/Tamil captions | [Borrow: Sully] | ESG / Relevance |
| | Specialty templates + per-doctor style learning | [Borrow: DeepScribe] | Adoption |
| | Patient visit-summary (multilingual, plain-language) | **[Moat]** | ESG |
| | Cloud-premium path (Claude, on de-identified text only) | — | Tech |
| | **Pre-charting / SmartPrep** (prior notes, meds, allergies, care gaps) | [Borrow: DeepScribe] | Commercial / Adoption |
| | **Coding & claims** — ICD-10-AM + panel / Takaful claim formatting | [Borrow: Abridge RCM] | Commercial |
| | **Linked clinical evidence** at point of care (cited MoH CPGs) | [Borrow: Abridge] | Tech / Relevance |
| | **Patient app** — visit summary + e-consent + appointment/recall | **[Moat]** | ESG / Adoption |
| | **Clinic-owner web app** — practice dashboard + compliance/sovereignty console | — | Commercial / Scale |
| | RM pricing tiers + multi-seat clinic + audit dashboard | — | Commercial |
| **P2 — Platform ("AI Clinic Team")** | Modular agents: AI Receptionist · Nurse-triage · Pharmacist · Coder (when OpenMed ICD ships) | [Borrow: Sully multi-agent] | Scalability |
| | **Data flywheel** — on-device federated learning (corrections improve models, no PHI leaves) | **[Moat]** | Tech / Scale |
| | ASEAN localization (swap the language model; same architecture) | **[Moat]** | Scale |
| | MOH population analytics (de-identified aggregate) | **[Moat]** (vision) | ESG / Scale |

> **All of the above is visualized** in the prototype (`docs/prototype/`) — 42 screens across 9 sections (onboarding · consult · outputs · paperwork & claims · clinical intelligence + AI team · clinic-owner desktop · settings/library/states · patient app · safety & data-flywheel). P0 items are demo-ready; P1/P2 are designed and storyboarded.

## 7. Why We Win

**The pitch spine:** *"The five things Heidi, Sully, Abridge, Dragon, and Qmed cannot do — because their cloud architecture forbids it — Sona does on the device."*

| Criterion (weight) | How Sona scores |
|---|---|
| **Technical Feasibility (25%)** | On-device Malaysian-model stack, all commercially licensed, with a working offline demo. Plays directly to our AI/ML strength. |
| **Commercial Viability (25%)** | Proven, funded category. Per-seat SaaS, 85–90% gross margin, RM pricing tuned to clinic economics, clear funding path. |
| **Industry Relevance (20%)** | Matches the track wording almost word-for-word: ambient scribe + workflow automation + local LLM. |
| **Scalability (15%)** | Land private GP clinics → public hospitals / MOH → SEA (1.5–2M doctors). "AI Clinic Team" modules drive expansion revenue. |
| **ESG / National Impact (15%)** | Malaysian sovereign models, data stays in-country (PDPA 2024), serves under-resourced public clinics, multilingual reaches underserved patients. |

## 8. Market & Revenue

**Market:** ~8,000 private GP clinics and ~70,000 doctors in Malaysia → ~1.5–2M doctors across Southeast Asia.

**Pricing:** Solo RM99/month · Clinic RM199/seat/month · Enterprise & government by contract. (For reference, Heidi lists ~RM650/month — we are priced for the actual market.)

| | Year 1 | Year 3 |
|---|---|---|
| Seats | 50–200 | 15,000–30,000 (SEA) |
| ARR | USD 25k–100k | USD 7M–15M |
| Gross margin | 85–90% | 85–90% |

**Go-to-market:** clinic management systems (embed) → telehealth partners (DoctorOnCall, Doc2Us) → professional bodies (MMA / AFPM) + MAIC incubation → hospital groups (KPJ / IHH).

## 9. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Phone can't run the models fast enough** | ~~High — gating~~ → **Phase-0 retired** | Spike Phase-0 = **GO** on Mac (1.5B 177 / 7B 72 tok/s, SOAP ~2–6 s). Phone run confirms binding number. See `docs/superpowers/decisions/ondevice-runtime-decision.md`. |
| Heidi / Qmed move fast locally | Medium | Our 5 moats are structural (cloud rivals can't go offline). Win on data-residency + rojak + price; lock a design partner early. |
| OpenMed lacks dose/ICD tagging; Android needs ONNX work | Medium | LLM covers ICD + dose extraction; build demo iOS-first; budget ONNX export for Android later. |
| No live clinical data access | Medium | Semi-synthetic data + human-verified slice; recruit a clinical advisor / design partner. |
| Regulatory (seen as a medical device) | Medium | Strict doctor-in-the-loop; documentation aid; doses extracted, not generated. |
| Model licensing | **Resolved** | Whisper = MIT, Qwen2.5-1.5B/7B = Apache-2.0, OpenMed = Apache-2.0. (Avoid Qwen2.5-3B, non-commercial.) |

## 10. Immediate Next Step — The Spike (GO/NO-GO)

Everything depends on one unproven question: **can a flagship phone run Whisper + Malaysian-Qwen2.5 + OpenMed offline, fast enough to be usable?**

The benchmark harness is **to be built next** (`apps/spike/` — React Native: `whisper.rn` + `llama.rn` + ONNX NER, plus an optional Mac `llama.cpp` pre-check). We run it on a real device and bench **Malaysian-Qwen2.5-7B vs 1.5B (4-bit)** alongside Malaysian-Whisper-v3-turbo and OpenMed privacy-filter.

**GO/NO-GO thresholds:** STT ≤ 90s for a 60s clip · LLM SOAP note in ≤ 30s at ≥ 6 tokens/sec · PII redaction recall ≥ 0.90 · end-to-end ≤ 90s with no out-of-memory across 5 consecutive runs.

A green spike de-risks the project and becomes the centerpiece of the pitch.

## 11. Indicative Timeline

| Window (from 2026-06-23) | Milestone |
|---|---|
| Weeks 1–2 | On-device spike → GO/NO-GO + runtime-decision doc |
| Weeks 3–6 | Build P0 scribe slice (consent → record → SOAP → paperwork → sign → export), iOS-first |
| Weeks 7–8 | Pitch deck + polished airplane-mode live demo |
| Ongoing | Clinical-advisor validation · model fine-tuning · submission → semis → finals |

*(Exact competition submission / semis / finals dates to be confirmed against the MAIC Nexus calendar — task #1.)*

## 12. How You Can Help / Open Decisions

- **Devices:** which flagship iPhone / iPad can we use for the spike?
- **Clinical advisor / design partner:** anyone with a GP / clinic contact for validation and a pilot? (We have warm leads — let's convert one to a design partner with outcome data.)
- **Roles:** who owns mobile, who owns model/fine-tuning, who owns the pitch deck?
- **Name:** is "Sona" final, or do we want a Malaysian-language name?

---

## Appendix — Glossary (for non-clinical teammates)

- **Ambient scribe** — software that listens to a conversation and writes the notes automatically.
- **Code-switching / rojak** — mixing several languages within one conversation or sentence (very common in Malaysia).
- **SOAP note** — standard clinical note format: Subjective, Objective, Assessment, Plan.
- **MC** — Medical Certificate (the "sick note").
- **ICD-10** — international standard codes for diagnoses (needed for billing, insurance, statistics).
- **FHIR** — the standard format for exchanging health records.
- **STT** — Speech-to-Text. **NER** — Named Entity Recognition (AI that tags drugs, symptoms, names in text).
- **PII / PHI** — Personally Identifiable / Protected Health Information. **De-identification** — removing identifiers so text can't be traced to a patient.
- **PDPA 2024** — Malaysia's Personal Data Protection Act. **MDA Act 737** — Malaysia's Medical Device Act.
- **LLM** — Large Language Model. **Unsloth** — toolkit for fine-tuning LLMs efficiently.
- **QLoRA** — memory-efficient fine-tuning method. **GGUF / llama.cpp** — format + engine for running LLMs on-device. **ONNX / MLX** — runtimes for on-device models (MLX = Apple silicon).
- **Apache-2.0 / MIT** — permissive open-source licenses that allow commercial use.

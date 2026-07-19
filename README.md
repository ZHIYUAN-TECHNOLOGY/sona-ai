<div align="center">

# 🩺 Sona — On-Device AI Clinical Scribe

**Every model runs on the phone. Patient audio and text never leave the device.**

An AI scribe built for Malaysian primary care — where consults flow between
**Bahasa Melayu, English, and 中文 in a single conversation**, and where patient
privacy cannot depend on someone else's cloud.

🎬 **[Watch the live demo →](https://sona-demo.zhiyuantech.workers.dev)**

</div>

---

## The problem

A Malaysian GP sees a patient every 5–10 minutes. Documentation is written after
hours, from memory, in a second or third language. Existing AI scribes assume
monolingual English speech and stream raw patient audio to overseas servers —
a non-starter for clinical confidentiality and for clinics with unreliable
connectivity.

## The answer: everything on-device

Sona runs the **entire clinical pipeline locally on an iPhone** — speech
recognition, de-identification, note generation, document OCR, semantic search.
Airplane mode is a supported configuration, not a failure state. The app proves
it live: an on-screen network badge and an append-only audit log showing
**"0 bytes transmitted."**

```
 🎙 Record consult (BM / EN / 中文, code-switching)
      │  whisper-large-v3-turbo — on-device, tri-lingual
      ▼
 🧑‍⚕️ Speaker separation + tap-to-correct transcript
      │
      ▼
 🔒 PRIVACY GATE — deterministic de-identification
      │  names, IC, phone, address → NAME_1, IC_1, …
      │  re-ID map sealed on-device; models see tokens only
      ▼
 📝 AI SOAP note — on-device LLM (llama.rn / ExecuTorch)
      │  Subjective · Objective · Assessment · Plan · Orders
      │  clinical highlighting: doses ▪ timeframes ▪ red flags
      ▼
 ✍️ Clinician reviews line-by-line → signs → raw audio destroyed
```

## Features

| | Feature | What makes it different |
|---|---|---|
| 🎙 | **AI Transcribe** | Whisper large-v3-turbo on-device; handles true Malaysian code-switch — *"batuk berkahak three days, 有一点 sesak"* — with Mandarin kept in 中文 script, never mistranslated |
| 🔒 | **Privacy Gate** | De-identification runs *before* any LLM sees text. Deterministic engine (regex + rules — auditable, no model hallucination in the safety layer). Uncertain matches surface for one-tap clinician confirmation |
| 📝 | **AI SOAP Note** | On-device LLM drafts structured notes with a hybrid clinical highlighter: doses/vitals (deterministic — digits are never left to a model), timeframes, and context-aware red flags where negation matters (*"no chest pain"* stays unmarked) |
| 📄 | **AI SmartScan** | Native document scanner (VisionKit) → on-device OCR (PP-OCR, tri-lingual charset) → auto de-ID → structured document note. Garbled scan text is copied as written, never guessed. Page images are destroyed after OCR |
| 💊 | **Medication safety** | Note orders are checked against an on-device drug-interaction reference at review time |
| 🔍 | **Knowledge & search** | On-device RAG over clinical guidelines with multilingual embeddings — a *"sakit dada"* query matches English chest-pain guidance |
| 📤 | **Export** | FHIR R4 / PDF for EMR ingest — re-identified locally, only at the clinician's explicit action |
| 🎞 | **Audit trail** | Append-only, on-device log of every pipeline stage — recording, redaction, generation, signing — with the network counter alongside |

## On-device model stack

| Task | Model | Runtime |
|---|---|---|
| Speech-to-text | Whisper large-v3-turbo (+ bundled Malaysian Whisper offline fallback) | whisper.cpp via `whisper.rn` |
| Clinical notes & doc summaries | Bonsai-8B (GGUF) — with Qwen3 via ExecuTorch as fallback engine | `llama.rn` / `react-native-executorch` |
| Embeddings (search/RAG) | paraphrase-multilingual-MiniLM-L12-v2 | ExecuTorch |
| Document OCR | PP-OCRv6 (24 MB, Malay + English + 中文 charset) | ExecuTorch (+ Apple Vision fallback) |

Model choices are **evidence-gated, not vibes-gated**: this repo ships the
evaluation harnesses (`tools/note-eval`, `tools/stt-eval`) that every candidate
must pass — recall / hallucination / format gates for notes, WER/CER with a
*Mandarin-stays-Mandarin* kill criterion for speech. Six challenger models were
rejected on these gates in July 2026 alone; the results are committed alongside
the code.

## Why on-device matters in healthcare

1. **Confidentiality by architecture** — PHI cannot leak from a server that was
   never sent anything. The de-identification boundary means even the on-device
   LLM only ever sees `NAME_1`, `IC_1` tokens.
2. **Works where clinics are** — rural Malaysia, basement pharmacies, airplane
   mode. No connectivity dependence, no per-consult API cost.
3. **Auditable safety** — deterministic redaction and deterministic
   dose-highlighting where mistakes are dangerous; the LLM is boxed into the
   parts where language fluency helps and gated by eval harnesses where it
   doesn't.

## Getting started

```bash
bun install
cd apps/native
npx expo run:ios --configuration Release --device   # physical iPhone recommended
```

First consult downloads the note model once; the bundled Malaysian Whisper
works fully offline out of the box. A Demo Mode (hidden: long-press the Version
row in Settings) arms scripted transcript + seeded data for reproducible
walkthroughs.

## Repo map

```
apps/native/            Expo app — the product
  lib/pipeline/         STT, redaction, note generation, engines
  lib/vision/           SmartScan: scanner, OCR, doc summaries
  lib/meds/             drug-interaction reference
  lib/knowledge/        on-device RAG
tools/note-eval/        note-model evaluation harness + results
tools/stt-eval/         STT evaluation harness + results
tools/demo-site/        the hosted demo page (R2 + Workers)
docs/model-roadmap.md   model decisions, with receipts
```

---

<div align="center">

**Sona** · ZHIYUAN Technology · Built for the future of Malaysian primary care

*Demo: [sona-demo.zhiyuantech.workers.dev](https://sona-demo.zhiyuantech.workers.dev)*

</div>

# Backend delivery plan

Status: agreed with the user on 25 September 2026, after a grilling session; extended on 26 September with the backend for the built UI (demo flows 2–5, server-side state, retrieval). It replaces the earlier eighteen-day allocation. The deadline is one to two weeks from 25 September, with full-time or more effort. Backend work runs in parallel with UI review; leave `apps/native` UI files to the UI track.

Research behind each decision is in `docs/research/`:
- [speech](research/speech-models.md)
- [TTS ranking](research/tts-models.md)
- [medical models](research/medical-models.md)
- [orchestrator](research/orchestrator-models.md)
- [hosting, sizing and costs](research/model-hosting.md)
- [UI composition](research/ui-composition.md)

## Scope

- **Demo:** a live iPhone demo, with a recorded video as backup. If a live call fails or times out on stage, the app shows its existing sample data, labelled as such.
- **Every capability runs on real models:** routing, briefing, reasoning, chest X-ray, scribe, medication interactions, synthetic prescribing and graded evidence answers. Follow-up tasks are plain database records.
- **Hospital operations flows** (see [ops demo flows](research/ops-demo-flows.md)): discharge, guarantee letter and coding, ward command view, evidence answer and coding audit. Their UI is built with synthetic data; the backend for each is below.
- **Manglish is the main selling point.** Manglish here means English, Malay and Mandarin mixed within a sentence. It covers speech-to-text (never cut) and spoken replies.
- **Real-time voice conversation with interruptions (barge-in),** built as a chain: speech-to-text, then Gemma, then text-to-speech. The first audio should arrive about 0.8–1.5 s after the user stops speaking. The US region adds about 0.3 s. Both figures are estimates.
- **Scribe:** captions stream live while recording. After stop, an accurate pass runs over the full recording, and the note is built from that pass.
- **Data:** synthetic and fictional only, until production.

## Architecture

```
iPhone (Expo)
  ├─ WebSocket ─▶ Cloudflare Agent (Agents SDK, one Durable Object per encounter)
  │                 agent loop · tool calls · realtime voice relay · resumable streams
  │                 json-render experimental_composeSpec with Laya as evaluator
  └─ HTTP (oRPC) ─▶ Worker (Hono): Better Auth login, plain data (patients, tasks)
                    │
        Neon Postgres, Singapore (clinical tables, drug table, ICD-10, pgvector library) · R2 (audio, X-rays)
                    │  server-side keys only
                    ▼
   Baseten Dedicated deployments (3×L4): ① Brain · ② Voice · ③ X-ray
```

- **Existing scaffold:** Workers, Hono/oRPC, Better Auth, Drizzle with Neon, and Alchemy stay. Add the Agents SDK, R2 and the clinical tables. Provision them with Alchemy, which supports Durable Objects and R2.
- **Encounter state on the server:** the app currently keeps every visit in memory. Each encounter's state lives in its Durable Object and is snapshotted to Postgres. The server enforces revisions: an eligibility or medicine edit invalidates the medication review, and prescription and discharge receipts are idempotent.
- **Login:** use the real login screen. Restyling the existing Better Auth sign-in screens is a UI-track task.
- **UI generation:** json-render's JEV engine, `experimental_composeSpec`, which is exported by the installed `@json-render/core` 0.21.0. Pin that exact version. **Laya** is the evaluator, self-hosted in box ①. Gemma, constrained to the offered keys, is the backup evaluator.
  - **Decided 29 Sep:** the predefined pages use Laya's direct pick (`pickCard` in `packages/api/src/laya.ts`: one "which card?" question, 92% on the held-out Manglish baseline, about 40 ms), and the app builds the screen around the card. Inside the composer, whose per-card use/omit questions Laya was retrained on three times, whole screens stayed at 84–86%, so the composer is kept for free layouts only. Details in the [Laya baseline](../tools/laya-eval/README.md).
  - Pages are predefined for common hospital work: the eight capabilities (evidence is the eighth), ward round, handover, discharge, guarantee letter, coding audit and referral.
  - Anything those pages don't cover gets a free layout composed from design-system blocks.
  - Candidates own their props. Clinical values arrive only by source ID.
  - Hosted JEV is excluded because it sends prompts to Vercel's closed `typesafe-ai/jev`.
- **Drug data:** a bounded, cited table of about 20–30 drugs covering the demo scenarios. Interactions and dosing come from openFDA labels, identifiers from RxNorm, and formulary status is entered by hand from FUKKM, citing each row. Anything outside the table is reported as "not covered", never guessed.
- **Discharge** (demo flow 1 in [ops demo flows](research/ops-demo-flows.md); no new model or box, all on Gemma in box ①):
  - `draft_discharge` writes the three-line summary (diagnosis, course, plan) and the full text from the note, transcript and record. Every line carries its source ID.
  - `reconcile_medicines`: Gemma proposes the take-home list; plain code computes the changed, new and stopped diff against the admission list; doses are checked against the drug table, which must include azithromycin, paracetamol, salbutamol and cetirizine. Anything outside the table is "not covered".
  - Gemma writes the patient leaflet in Malay, English and Chinese. VoxCPM2 in box ② may read it aloud (optional).
  - Synthetic tables: admissions (bed, fit-for-discharge time, discharged time), guarantee letters (insurer, status, requested and received times, updated by a mock insurer) and discharge receipts.
  - The server refuses a discharge while any blocker is open, whatever the app shows. The discharge and the follow-up tasks it creates are idempotent.
  - The "earlier than usual" figure compares against a typical fit-to-door wait kept in config and labelled synthetic on the receipt.
- **Guarantee letter and coding** (flow 2):
  - `suggest_codes`: OpenMed clinical extraction finds diagnoses with negation and grounds them to ICD-10; Gemma picks from the top candidates of a WHO ICD-10 lookup. Every code carries the ID of the note sentence that justifies it. OpenMed's own `coding-icd10` skill targets US ICD-10-CM; Malaysian casemix uses WHO ICD-10, so keep the WHO lookup and do not adopt its CM codes.
  - ICD-10 lives in Postgres as a table searched with full-text and trigram matching, not embeddings: codes and short descriptions are exact strings.
  - Insurer criteria are structured rows checked by code; the policy text stays in the retrieval library only to show the clause behind a flag.
  - A `claims` table (draft, sent, approved) and a mock insurer that approves after a delay (a Durable Object alarm). Approval updates the same guarantee-letter row the discharge reads.
  - A note addendum endpoint creates a new note revision, so a fix is visible as evidence.
- **Ward command view** (flow 3): a beds table and a server-side view that derives each bed's blockers from admissions, guarantee letters, medicines and pending results. Blocker owners are tasks with an owner and a kind. The predicted discharge time comes from rules (fit time plus typical blocker waits), not a model. Gemma writes the three-line huddle brief.
- **Evidence answer** (flow 4, the eighth capability): retrieval over the library below plus live PubMed E-utilities search; Gemma picks three sources and summarises each with its PMID or passage ID. The certainty label comes from rules on study type. CURB-65 is plain code over an observations table read by source ID; an unrecorded factor stays unknown. Answers to the rehearsed demo questions are cached so the stage demo cannot fail on the network.
- **Coding audit** (flow 5): a nightly Cloudflare Cron Trigger runs the flow 2 coding tool over the day's notes and compares extracted lab facts with the note (for example, anaemia in the labs but not the note). Results go to an `audit_items` table; the money at risk comes from a synthetic casemix weights table; each query to a doctor is a task.
- **Retrieval library:** one store, pgvector in Neon Singapore, for everything retrieved: Malaysian MOH clinical practice guidelines, ATS/IDSA pneumonia guidance, cached PubMed abstracts and insurer policy text.
  - Ingestion: a PDF with a text layer is read in the Worker (`unpdf`, built 29 Sep); a scan goes through OCR (below); chunks cut per section and tagged with source, year and section, re-embedded when a document changes.
  - Search: hybrid, a keyword search and a vector search fused by rank, then a reranker over the top results. The keyword half and the reranker are never cut; they are what keep quality level with a managed search service.
  - Embeddings: EmbeddingGemma-300M; reranker: bge-reranker-v2-m3 (multilingual). Both run in box ②.
  - Row-level security scopes every search to the caller's hospital, ready for doctor uploads in production.
  - Chosen over Cloudflare AI Search because future doctor uploads are hospital data under the residency rule, need per-hospital access and deletion, and must not leave the single inference host.
- **Scanned documents (OCR), added 29 Sep:** OpenMed has no OCR model of its own (it wraps Tesseract or PaddleOCR and has no PDF handler), so OCR is its own step before the privacy check and indexing.
  - Uses, in order: (1) scanned guidelines and protocols a doctor adds to their library (the Worker refuses PDFs with no text today); (2) paper referral letters and outside discharge summaries photographed into the briefing and history; (3) outside lab reports photographed into the Results card; (4) insurer guarantee-letter replies (PDF or fax) read into the claim's status; (5) medicine packets and old prescriptions for reconciliation (printed only: handwriting stays out, since open OCR reads about one handwritten word in three correctly).
  - Server OCR on box ② is the one path (decided 29 Sep: every phone and the web, not only iPhones): **PaddleOCR-VL-1.6** (0.9B, Apache-2.0, 109+ languages including Malay and Chinese, first on OmniDocBench v1.6 at 96.3), served with vLLM. Runners-up: DeepSeek-OCR 2 for throughput; MinerU2.5-Pro is strongest on hard pages but check its licence first. Scans reach Baseten US, so synthetic only until the residency move. The app's review UI is built first on a labelled sample reading.
  - Rejected for now: Apple Vision on the phone (iPhone only; Android would need a second, ML Kit, module).
  - Lab report images: MedGemma 1.5 in box ③ turns them into value, unit and flag (no new model).
  - Classify before OCR (added 29 Sep): every scan is typed by MedGemma before any OCR. A chest radiograph is not read as text: the app offers "Attach it to a patient's visit" (the X-ray flow, unvalidated). A CT slice photo is "not covered" and can only be attached as a plain image. Only documents continue to OCR and the library; the doctor confirms with one tap when the type is unsure. Every capture uses one camera (Vision Camera): the doctor drags the photo's corners to crop and straighten a page (a perspective warp, no automatic edge detection), and a photo left uncropped, such as a wound, is attached as taken with no enhancement.
  - Every OCR source is labelled "Read by OCR"; pages below a confidence floor are refused; any dose OCR finds is checked against the drug table, and one outside the known range marks the passage "Check against original" instead of being cited silently.
- **Reviewer approval and provenance:** sending a claim and discharging a patient each need an explicit approval (draft, approve, final). Every AI output is logged with its source IDs, model version and approver in a `provenance` table.
- **Clinical tables:** appointments (My Day and the calendar), lab results with flags (the Results card), observations (CURB-65), handover acceptances (hold to accept), and the discharge, claim, ward and audit tables above.
- **X-ray upload:** images go to R2 through a presigned URL. MedGemma confirms the image type; anything that is not a chest radiograph, such as a CT, is answered "not covered".
- **Incidental finding tracker** (demo flow 6): MedGemma in box ③ lists findings beyond the question asked (nodule, heart size, effusion) with a rough location; a `findings` table stores each with its image, location, risk band and the follow-up rule from a small rules table (Fleischner-style intervals, stored as data). Accepting a finding creates a follow-up task and a recall; overdue follow-ups feed My Day, discharge blockers and handover. Findings are labelled unvalidated; marker placement falls back to authored overlays if MedGemma's localisation is too weak.
- **After-discharge check-ins** (demo flow 7): a `check_ins` table and a Durable Object alarm send messages on day 2 and day 7 in the leaflet's language. Gemma classifies each reply (fine, worse, urgent) and urgent or worse replies become a flagged task on the doctor's day. Messaging goes through a WhatsApp Business provider in production; the demo uses a simulated inbox so no real patient is contacted.
- **Sona Care, the patient app (`apps/care`, base only):** patients chat with or contact their doctor there, including replies to after-discharge check-ins. It shares this backend (same Worker, auth and API) and the clinician app stays clinician-only. Before real patients use it, the API needs patient and clinician roles: today any account joins the demo hospital with clinical access.
- **Push notifications (optional):** "result arrived" and "guarantee letter approved" through Expo push.
- **Privacy step:** OpenMed PII removes names, IC numbers and phone numbers before text reaches Gemma or MedGemma, before any retrieval query, and before any row enters a training dataset ([continuous training](diagrams/continuous-training.html)). Checked 28 Sep 2026 against the OpenMed source: 42 PII languages including Chinese (`OpenMed-PII-Chinese-BigMed-Large-560M`, larger than the English default) and Indonesian (`privacy-filter-multilingual`), but not Malay. Read `SUPPORTED_LANGUAGES` at start-up rather than hard-coding the list. Malaysian IC numbers get our own format check plus a surrogate generator registered with `register_clinical_provider`. Before release, a PII recall test must fail closed on any leaked identifier. Serve it with OpenMed's own FastAPI service and Dockerfile (health checks, no PHI in logs) as a Truss `docker_server` on box ②.
- **Excluded from serving:** closed models (Qwen-Audio-3.1, Gemini 3.8 TTS, hosted JEV), MERaLiON, Scicom, and any second inference host, including Cloudflare Workers AI and AI Search. Also excluded: a separate vector database, real insurer or FHIR integration, and model-based length-of-stay prediction. Generating offline training data with open models (including Scicom) is allowed; see the [ASR training plan](asr-training-plan.md).

## Models and hosting

Baseten Cloud, pay-as-you-go (Basic plan), Dedicated deployments in the US region. Each box is a plain Docker image (Truss `docker_server`) so it can move later without a rebuild.

| Box | GPU | Models | State |
| --- | --- | --- | --- |
| ① Brain | L4 24 GB | Gemma 4 26B A4B-it, INT4 QAT (`cyankiwi/gemma-4-26B-A4B-it-qat-AWQ-INT4`, vLLM with prefix caching) + Laya multilingual (`laya-serve`) | Warm while working |
| ② Voice | L4 24 GB | Qwen3-ASR-1.7B, Qwen3-ForcedAligner-0.6B (≤5 min chunks), Nemotron-3-Diarization, VoxCPM2, OpenMed PII Small, OpenMed clinical extraction, EmbeddingGemma-300M, bge-reranker-v2-m3, PaddleOCR-VL-1.6 | Warm while working |
| ③ X-ray | L4 24 GB | MedGemma 1.5 4B, FP8 | Scales to zero; the Agent wakes it when an image is attached; pre-warmed before demos |

- **Scribe merge:** each word takes the speaker whose segment covers its timestamp. Gemma then labels the speakers as doctor or patient.
- **Day-1 checks:**
  - memory headroom on box ①, and on box ② with the retrieval, extraction and OCR models added
  - PaddleOCR-VL-1.6 on the 30-page OCR baseline (below)
  - INT4 quality and speed against FP8 on an H100 MIG
  - WebSockets through a custom Docker server
  - VoxCPM2 real-time speed on an L4
  - whether one Qwen3-ASR deployment serves both streaming and batch
  - LoRA on the INT4 Gemma base (fallback: merge and re-quantise)
- **If the INT4 checks fail:** only box ① moves to an H100 MIG ($3.75/h) running Gemma FP8.
- **Environments:** development and staging are two Baseten environments in the same account. Staging is warmed only for demos. A warm-up script wakes all three boxes before a session.

## Fine-tuning

Train a model only if it fails its day 1–3 baseline. Because Manglish is the pitch, a borderline Manglish STT result still gets trained.

| Priority | Model | Where | Method | Data | GPU time |
| --- | --- | --- | --- | --- | --- |
| 1 | Qwen3-ASR-1.7B | Baseten Training Jobs, 1×H100 | Baseten's `qwen3-asr-transformers` recipe | ~30 h synthetic Manglish consultations plus ~30 h licensed real speech; see the [ASR training plan](asr-training-plan.md) | ~2–6 h per run |
| 2 | VoxCPM2 | Baseten Training Jobs, 1×H100 | Official full fine-tune (done 29 Sep; LoRA was too weak) | 4.35 h of one Gemini voice (Kore) reading single-language hospital replies; see [TTS training](tts-training.md) | ~30 min |
| 3 | Laya (**done 29 Sep: v2 passes on the direct pick, 92% vs 34% untrained, 41 ms; composer-format v3–v5 84–86%**; see [Laya baseline](../tools/laya-eval/README.md)) | Kaggle free T4 x2 | Laya notebook plus calibration | Synthetic composition decisions from the catalogue and fixtures | Free (~6 min) |
| Conditional | Gemma 4 (Unsloth), Nemotron | Baseten Training Jobs | Only if the baseline fails | — | — |
| Conditional | PaddleOCR-VL-1.6 | Baseten Training Jobs, 1×H100 | LoRA via Unsloth (fall back to the official ERNIEKit recipe); only if the OCR baseline fails | Synthetic pages we render ourselves (guidelines, dosing tables, lab reports, Malay and Chinese), so every page's exact text is known | ~1–3 h |
| Never | MedGemma, ForcedAligner, OpenMed | — | — | — | — |

- **Serving:** checkpoints load into the boxes through `bt://<project>@<job>/<checkpoint>`. Each fine-tune ships as a new box version, and rollback means promoting the previous version.
- **Region:** Training Jobs cannot pick a region. Train only on fictional or synthetic data.
- **Bottleneck:** people, not GPUs. For Qwen3-ASR this is now script review (27 Sep): its training audio is synthetic plus licensed public speech with exact transcripts, so no recordings or transcription are needed. See the [ASR training plan](asr-training-plan.md).

**Baseline pass bars** (suggested):

| Model | Passes when |
| --- | --- |
| STT | ≤ ~15% error on mixed sentences and ≥ 90% of drug names correct |
| TTS | Malaysian listeners rate it ≥ 4/5 |
| Gemma | ≥ 95% correct routing and ≥ 98% valid specs |
| OCR | ≤ 2% character error rate on 30 synthetic pages, and 100% of drug doses read correctly |

## Sequence

| Days | Backend work | People work |
| --- | --- | --- |
| 1–2 | Deploy boxes ①②③; Agent skeleton; Laya data generator and Kaggle training; ASR Stage 0 engine check | Listen to Stage 0 samples |
| 1–3 | Baselines: Gemma routing and specs, STT, TTS, INT4 vs FP8, memory and WebSocket checks; Manglish scripts and synthetic audio | Review 30 Manglish scripts |
| 3–5 | Encounter state; tools (including discharge drafting, medicine reconciliation and code suggestion), drug table, ICD-10 table, discharge and claim tables, mock insurer, patient isolation, JEV composition, scribe pipeline | Voice-actor session |
| 4–6 | Retrieval ingestion and hybrid search; evidence capability; ward view and blocker owners; coding audit cron; 30-question retrieval test set | Write and check the retrieval questions |
| 5–7 | Qwen3-ASR fine-tune and evaluation; VoxCPM2 LoRA if needed | Held-out scoring |
| 6–8 | Real-time voice, barge-in, OpenMed step, end-to-end encounter | — |
| 8–9 | Demo flows 6 and 7 (incidental finding tracker, after-discharge check-ins) on the finished backend | — |
| 9+ | Freeze models; rehearse on staging; record the backup video | — |

## Cut order if the schedule slips

1. OpenMed PII step
2. Laya fine-tune (Gemma becomes the evaluator)
3. Free-layout pages (keep the predefined ones)
4. VoxCPM2 fine-tune (use it as-is)
5. Spoken discharge leaflet (keep the written one)
6. Push notifications
7. OCR model (scanned PDFs stay refused with a clear reason)
8. OpenMed clinical extraction (Gemma extracts instead, with lower confidence)
9. Live PubMed search (keep the cached library)
10. Barge-in (keep real-time voice without interruption)

Manglish STT is never cut. Nor are the keyword half of hybrid search, the reranker, the server-side discharge and claim checks, or reviewer approval.

## Costs

Estimates in USD at list prices (Baseten L4 $0.85/h; boxes ①+② warm cost $1.70/h). Credits, discounts and Enterprise fees are not included.

| Phase | Estimate |
| --- | --- |
| Competition, about 2 weeks one-off (development + rehearsals + demo) | ≈ $450–555 |
| Development per month | ~$415–530 (8 h × 22 days) · ~$760–935 (12 h × 30 days) |
| Staging and demos per month | ~$95–125 |
| Production pilot, weekday clinic hours, per hospital per month | ~$1.2–1.35k + Enterprise fee (Malaysia/Singapore) |
| Production 24/7, per hospital per month | ~$2.35–2.5k + Enterprise fee |

Production figures assume AWS Malaysia `g6` on-demand pricing ($1.23/h for 2xlarge, $1.01/h for xlarge) plus Kubernetes, database, storage and networking. They assume about five concurrent clinicians per box set; larger hospitals need two to four times the ① and ② replicas.

## After the cascade: open speech-to-speech (added 27 Sep, optional)

Once speech-to-text → Gemma → text-to-speech works end to end, evaluate one self-hosted open speech-to-speech model as a possible faster, more natural voice. It stays out of the competition cut order; the cascade is the demo path. Research, sources and the evaluation plan: [s2s-models](research/s2s-models.md).

- **Finding:** no open, self-hostable speech-to-speech model speaks Malay yet, and none publishes Manglish results, so none can replace the cascade for Malay replies in 2026. Qwen3-Omni can listen to Malay but not speak it.
- **Candidates, ranked:** (1) MiniCPM-o 4.5 (9B, Apache-2.0, full-duplex, English and Mandarin speech, fits one L4 at int4, text prompt plus transcript, LoRA via LLaMA-Factory for listening and reasoning); (2) Qwen3-Omni-30B-A3B (best grounding and hears Malay, text before speech so a safety check can run, turn-based, needs an H100); (3) Moshi family / PersonaPlex (best interruption, 0.24 s to stop, fits an L4, English only, short context).
- **Fine-tuning reality:** LoRA can adapt listening and reasoning to Manglish and after-discharge dialogue in about a week on 1×H100; teaching a model to *speak* Malay is not supported by any primary source at that budget.
- **Evaluation:** a 60-turn fictional Manglish and medical test set; missing any of the 10 red-flag turns fails outright; a pass must still beat the cascade on latency or naturalness.
- **Choice (user, 28 Sep): MiniCPM-o 4.5, with VoxCPM2 speaking Malay.** It needs both Malay/Manglish understanding (tunable) and interruption mid-conversation (native full-duplex). MiniCPM-o listens (Whisper encoder + Manglish LoRA), thinks (Qwen3-8B + after-discharge LoRA, the patient's plan in the prompt) and decides when to talk; its reply text passes the plan and red-flag check before speech; English and Mandarin replies use its own voice, Malay replies go to VoxCPM2 (box ②). One extra L4 (int4 or llama.cpp-omni). Unverified until the 60-turn test: Manglish data hours needed, int4 quality, and Malay latency through VoxCPM2. Visual: https://claude.ai/artifact/9WBm27DdU2mdoVb5Vf4FMe

## Production path (after the competition)

The residency rule for real patient data is **Malaysia or Singapore**, decided on 25 September. Options:
- Baseten Enterprise Self-hosted in our own AWS/GCP account. Inference payloads stay in our VPC. Model code, images, metrics and billing data do reach Baseten's control plane.
- A Baseten Enterprise custom region.
- The same Docker images run directly on AWS or GCP.

For real data, the Agent, the database and object storage must also move into the region.

**Doctor uploads (production):** doctors or hospitals upload their own references and textbooks. They reuse the retrieval ingestion; each upload runs the PII check first and is flagged or stripped if it holds patient details; row-level security keeps it within the uploader's hospital (or the uploader alone); it is never shared across hospitals or used for training; deleting it removes its chunks and vectors. Until then, staging on Baseten Cloud US carries synthetic data only, labelled as synthetic.

## Open actions for the user

1. **Baseten email:** ask about credits, Loops early access, and a future Enterprise quote for Singapore or Malaysia.
2. **MOH formulary email:** ask cpfor@moh.gov.my whether FUKKM entries may be reused.
3. **Manglish data:** replaced on 27 Sep by synthetic audio and licensed speech (see the [ASR training plan](asr-training-plan.md)). Email Alibaba about Qwen TTS output for training and the Scicom authors about a licence.
4. **AWS quota (optional hedge):** request a G-instance quota in `ap-southeast-5`.
5. **Licences:** confirm reuse terms for WHO ICD-10, the MOH clinical practice guidelines and any casemix weights before they enter the library.
6. **Evidence rating:** confirm that the ATS/IDSA 2019 guideline rates "no routine corticosteroids in non-severe pneumonia" as a strong recommendation on high-quality evidence; the evidence answer says "High certainty".

## Verification

- **Backend:** patient isolation, invalid tool arguments, schema rejection, source references, "not covered" drug answers, prescribing stop cases, discharge refused while a blocker is open, claim refused while a criterion is open, reviewer approval required before a claim is sent or a patient discharged, hospital-scoped retrieval (one hospital never sees another's documents), cancellation, idempotent task, prescription, claim and discharge creation.
- **AI:** held-out Manglish sets, reporting sample sizes and failures. A native speaker reviews the demo discharge leaflet in Malay and Chinese before it is frozen. Retrieval: a 30-question set (pneumonia, codes, insurer rules, in English, Malay and Chinese) must place the right passage in the top 5 for at least 90% of questions. Code suggestion: checked against hand-coded demo notes, including negated diagnoses. No accuracy claim goes beyond what was measured.
- **Integration:** a full fictional encounter on staging, voice latency (p50/p95) and time to first useful result.

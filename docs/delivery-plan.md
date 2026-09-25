# Backend delivery plan

Status: agreed with the user on 25 September 2026, after a grilling session. It replaces the earlier eighteen-day allocation. The deadline is one to two weeks from 25 September, with full-time or more effort. Backend work runs in parallel with UI review; leave `apps/native` UI files to the UI track.

Research behind each decision is in `docs/research/`:
- [speech](research/speech-models.md)
- [TTS ranking](research/tts-models.md)
- [medical models](research/medical-models.md)
- [orchestrator](research/orchestrator-models.md)
- [hosting, sizing and costs](research/model-hosting.md)
- [UI composition](research/ui-composition.md)

## Scope

- **Demo:** a live iPhone demo, with a recorded video as backup. If a live call fails or times out on stage, the app shows its existing sample data, labelled as such.
- **Every capability runs on real models:** routing, briefing, reasoning, chest X-ray, scribe, medication interactions and synthetic prescribing. Follow-up tasks are plain database records.
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
        Neon Postgres (patients, notes, tasks, receipts, drug table) · R2 (audio, X-rays)
                    │  server-side keys only
                    ▼
   Baseten Dedicated deployments (3×L4): ① Brain · ② Voice · ③ X-ray
```

- **Existing scaffold:** Workers, Hono/oRPC, Better Auth, Drizzle with Neon, and Alchemy stay. Add the Agents SDK, R2 and the clinical tables. Provision them with Alchemy, which supports Durable Objects and R2.
- **Login:** use the real login screen. Restyling the existing Better Auth sign-in screens is a UI-track task.
- **UI generation:** json-render's JEV engine, `experimental_composeSpec`, which is exported by the installed `@json-render/core` 0.21.0. Pin that exact version. **Laya** is the evaluator, self-hosted in box ①. Gemma, constrained to the offered keys, is the backup evaluator.
  - Pages are predefined for common hospital work: the seven capabilities, ward round, handover, discharge and referral.
  - Anything those pages don't cover gets a free layout composed from design-system blocks.
  - Candidates own their props. Clinical values arrive only by source ID.
  - Hosted JEV is excluded because it sends prompts to Vercel's closed `typesafe-ai/jev`.
- **Drug data:** a bounded, cited table of about 20–30 drugs covering the demo scenarios. Interactions and dosing come from openFDA labels, identifiers from RxNorm, and formulary status is entered by hand from FUKKM, citing each row. Anything outside the table is reported as "not covered", never guessed.
- **Privacy step:** OpenMed PII Small removes names, IC numbers and phone numbers before text reaches Gemma or MedGemma.
- **Excluded:** closed models (Qwen-Audio-3.1, Gemini 3.8 TTS, hosted JEV), MERaLiON, Scicom, and any second inference host.

## Models and hosting

Baseten Cloud, pay-as-you-go (Basic plan), Dedicated deployments in the US region. Each box is a plain Docker image (Truss `docker_server`) so it can move later without a rebuild.

| Box | GPU | Models | State |
| --- | --- | --- | --- |
| ① Brain | L4 24 GB | Gemma 4 26B A4B-it, INT4 QAT (`cyankiwi/gemma-4-26B-A4B-it-qat-AWQ-INT4`, vLLM with prefix caching) + Laya multilingual (`laya-serve`) | Warm while working |
| ② Voice | L4 24 GB | Qwen3-ASR-1.7B, Qwen3-ForcedAligner-0.6B (≤5 min chunks), Nemotron-3-Diarization, VoxCPM2, OpenMed PII Small | Warm while working |
| ③ X-ray | L4 24 GB | MedGemma 1.5 4B, FP8 | Scales to zero; the Agent wakes it when an image is attached; pre-warmed before demos |

- **Scribe merge:** each word takes the speaker whose segment covers its timestamp. Gemma then labels the speakers as doctor or patient.
- **Day-1 checks:**
  - memory headroom on box ①
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
| 1 | Qwen3-ASR-1.7B | Baseten Training Jobs, 1×H100 | TRL/Transformers on the `-hf` checkpoint | 2–3 h of fictional consultations with exact code-switched transcripts and speaker labels; 20% held out | ~2–6 h |
| 2 | VoxCPM2 | Baseten Training Jobs, 1×H100 | Official LoRA | 1–3 h of one voice actor reading Manglish scripts | ~2–5 h |
| 3 | Laya | Kaggle free T4 | Laya notebook plus calibration | Synthetic composition decisions from the catalogue and fixtures | Free |
| Conditional | Gemma 4 (Unsloth), Nemotron | Baseten Training Jobs | Only if the baseline fails | — | — |
| Never | MedGemma, ForcedAligner, OpenMed | — | — | — | — |

- **Serving:** checkpoints load into the boxes through `bt://<project>@<job>/<checkpoint>`. Each fine-tune ships as a new box version, and rollback means promoting the previous version.
- **Region:** Training Jobs cannot pick a region. Train only on fictional or synthetic data.
- **Bottleneck:** people, not GPUs. Transcription takes about 5–10× the audio length, or 15–30 person-hours. Have base Qwen3-ASR write a first draft, then correct it by hand.

**Baseline pass bars** (suggested):

| Model | Passes when |
| --- | --- |
| STT | ≤ ~15% error on mixed sentences and ≥ 90% of drug names correct |
| TTS | Malaysian listeners rate it ≥ 4/5 |
| Gemma | ≥ 95% correct routing and ≥ 98% valid specs |

## Sequence

| Days | Backend work | People work |
| --- | --- | --- |
| 1–2 | Deploy boxes ①②③; Agent skeleton; Laya data generator and Kaggle training | Start Manglish recordings; book the voice actor |
| 1–3 | Baselines: Gemma routing and specs, STT, TTS, INT4 vs FP8, memory and WebSocket checks | Transcription (ASR draft, then human fix) |
| 3–5 | Tools, drug table, patient isolation, JEV composition, scribe pipeline | Voice-actor session |
| 4–6 | Qwen3-ASR fine-tune and evaluation; VoxCPM2 LoRA if needed | Held-out scoring |
| 6–8 | Real-time voice, barge-in, OpenMed step, end-to-end encounter | — |
| 8+ | Freeze models; rehearse on staging; record the backup video | — |

## Cut order if the schedule slips

1. OpenMed PII step
2. Laya fine-tune (Gemma becomes the evaluator)
3. Free-layout pages (keep the predefined ones)
4. VoxCPM2 fine-tune (use it as-is)
5. Barge-in (keep real-time voice without interruption)

Manglish STT is never cut.

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

## Production path (after the competition)

The residency rule for real patient data is **Malaysia or Singapore**, decided on 25 September. Options:
- Baseten Enterprise Self-hosted in our own AWS/GCP account. Inference payloads stay in our VPC. Model code, images, metrics and billing data do reach Baseten's control plane.
- A Baseten Enterprise custom region.
- The same Docker images run directly on AWS or GCP.

For real data, the Agent, the database and object storage must also move into the region. Until then, staging on Baseten Cloud US carries synthetic data only, labelled as synthetic.

## Open actions for the user

1. **Baseten email:** ask about credits, Loops early access, and a future Enterprise quote for Singapore or Malaysia.
2. **MOH formulary email:** ask cpfor@moh.gov.my whether FUKKM entries may be reused.
3. **Manglish data:** record consultations, book the voice actor, and set up transcription.
4. **AWS quota (optional hedge):** request a G-instance quota in `ap-southeast-5`.

## Verification

- **Backend:** patient isolation, invalid tool arguments, schema rejection, source references, "not covered" drug answers, prescribing stop cases, cancellation, idempotent task and prescription creation.
- **AI:** held-out Manglish sets, reporting sample sizes and failures. No accuracy claim goes beyond what was measured.
- **Integration:** a full fictional encounter on staging, voice latency (p50/p95) and time to first useful result.

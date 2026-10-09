# 02 · Deployment on staging

[Diagram](02-deployment.html) · [SVG](02-deployment.svg) · [PNG](02-deployment.png) · [source](02-deployment.archify.json)

**Answers:** what runs where, and what is in Malaysia today.

## What it shows

**Cloudflare** (`packages/infra/alchemy.run.ts`, stack `sona-ai`, stage `staging` only):
- Worker `server` (`apps/server/src/index.ts`): Hono, oRPC, Better Auth, the web portals as static assets. Crons `0 * * * *` (hourly check-ins) and `0 18 * * *` (nightly coding audit, 02:00 MYT).
- Durable Objects: two plain ones, `HospitalChannel` (one per hospital, live updates) and `EncounterState` (one per visit); four Agents SDK classes, `CheckInAgent`, `WatchAgent`, `SonaVoiceAgent` and `SonaLiveAgent` (the last only used when `SONA_LIVE_URL` is set).
- R2 bucket `uploads`: X-rays, handwritten scans, Sona Care medicine photos, training JSONL exports.
- Also bound but not drawn: Workers AI (`AI`, the embedder fallback) and Email (`EMAIL`). No KV, Queues or Hyperdrive.

**Neon** project `sona-ai-staging`, database `sona`, region `aws-ap-southeast-1` (Singapore). The region is not in code; it comes from [the handoff](../handoff.md). pgvector holds 768-d text vectors (`chunks`) and 512-d image vectors (`image_vectors`).

**AWS ap-southeast-5 (Malaysia)** (`packages/infra/aws/*`):

| Endpoint | Serves | Host |
| --- | --- | --- |
| `sona-brain` | Gemma 4 26B A4B INT4 (`cyankiwi/gemma-4-26B-A4B-it-qat-AWQ-INT4`, vLLM, served as `gemma-4-26b-a4b`) | SageMaker `ml.g6.2xlarge` |
| `sona-voice` | Qwen3-ASR Manglish, Nemotron-3-Diarization, VoxCPM2 Malaysian, bge-reranker-v2-m3 (`sona/voice:3`) | SageMaker `ml.g6.2xlarge` |
| `sona-xray` | MedGemma 1.5 4B FP8 | SageMaker `ml.g6.xlarge` |
| `sona-laya` | Laya router (`zhiyuantechnology/sona-laya`) | SageMaker `ml.c6i.large` |
| `sona-embed` | EmbeddingGemma-300M + BiomedCLIP, int8 | SageMaker `ml.c6i.xlarge`, always on |
| `sona-pii` | OpenMed PII mClinicalE5-Large-560M | Lambda, 6144 MB (no function URLs in this region, so the Worker calls Invoke) |

## In Malaysia today, and not

- **In Malaysia:** every model host above.
- **Not in Malaysia:** the database (Singapore), and the Worker, Durable Objects and R2 (Cloudflare, no jurisdiction or region pin in `alchemy.run.ts`).
- Pilot plan (from the pitch, not built): move the database and object storage into Malaysia; the model hosts stay.

## Known limits

- GPU endpoints are deleted between sessions to save cost (configs kept); with none up, model routes answer as labelled fixtures. Run `aws sagemaker list-endpoints` before expecting a model answer.
- `sona-live` (MiniCPM-o on `ml.g6.12xlarge`) exists as code and a test script only; it is not deployed.
- Baseten configs in `packages/infra/baseten/` remain as the fallback host for any box not named in `SAGEMAKER_ENDPOINTS`.

Checked against code at `cd76571b` on 8 Oct 2026.

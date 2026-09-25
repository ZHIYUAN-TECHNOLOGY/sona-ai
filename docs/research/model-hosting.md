# Model hosting for Sona

Researched 24 September 2026 from primary sources: vendor docs, pricing pages, trust pages, GitHub and Malaysian government sites. Bracketed numbers such as [3] point to the sources listed at the end. **Unverified** marks claims I could not confirm from a primary page. Prices and model lists change often, so recheck them before committing spend.

## Question

Where should Sona's open-weight models run? The models are an orchestrator LLM with tool calling, MedGemma for medical text and chest X-rays, ASR with diarization, and optional TTS. The setup has to hold up in a 10–15 minute live competition demo. It also needs a believable path to hospital B2B, meaning a hybrid of cloud plus an on-prem hospital GPU, under Malaysian data rules. The Worker stack is Hono, oRPC, Better Auth, Drizzle/Neon and Alchemy on Cloudflare Workers.

## TL;DR

- **Demo: Baseten Cloud dedicated deployments, called only from the Cloudflare Worker.** Baseten's Model APIs don't offer Gemma or MedGemma, so run these as dedicated deployments [7][8]:
  - Gemma 4 on vLLM. Baseten publishes a recipe for it [9].
  - MedGemma as a custom vLLM Truss.
  - Qwen3-ASR (Baseten publishes a recipe; the model supports Malay) [12][30].
  - MOSS-Transcribe-Diarize, or Baseten's streaming Whisper with diarization [13][15].
- **Keep the models warm for the demo.** Use a one-time scheduled autoscaling window with `min_replica ≥ 1` [18], and send a warm-up request beforehand. Warm, the stack costs roughly US$20–27/hour at list prices [1]: 2×H100 for Gemma 4 26B, 1×H100 for MedGemma, and an L4 for ASR, plus another H100 if you add MOSS diarization. The rest of the time it scales to zero.
- **Fallback ladder.** If Baseten fails, the Worker falls back to Workers AI `@cf/google/gemma-4-26b-a4b-it` and `@cf/openai/whisper-large-v3-turbo`. Both are open-weight and callable in-process through `env.AI` [22][23]. If that also fails, the app shows its existing labelled synthetic fixtures. Workers AI has no MedGemma, so the X-ray step falls straight to fixtures.
- **Region caveat.** Baseten's self-serve regions are only `us` and `eu`, with no Asia region [4]. That is fine for a synthetic-data demo. It is not fine for real Malaysian patient data without a PDPA s129 transfer basis [36][37].
- **Hybrid later.** Every model server should expose an OpenAI-compatible vLLM or SGLang API. The Worker then only needs a per-tenant `baseUrl`, which can point to Baseten Cloud, to Baseten Self-hosted in the hospital's cloud account (Enterprise tier; AWS, GCP or OCI) [5], or to a hospital GPU box reached over Cloudflare Tunnel. Fireworks is the one managed option with a Malaysia region (`AP_MALAYSIA_2`) [26]. Keep it as the plan B if Malaysian residency becomes a hard requirement before on-prem is ready.

## Comparison

| Platform | Serves our models? | Scale-to-zero / warm controls | Streaming | Asia / Malaysia region | HIPAA / SOC 2 | Self-host / hybrid | Indicative GPU price |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Baseten** | Any model via Truss: vLLM, SGLang, TensorRT-LLM, or its own BIS engine [3]. Gemma 4 and Qwen3-ASR recipes exist [9][12] | Yes. Min/max replicas, 15-minute scale-down delay by default, scheduled windows [2][18] | SSE, WebSocket, gRPC [10][14] | **Only `us` and `eu`**; other regions through support [4] | SOC 2 Type II; HIPAA; BAA for "qualifying customers" [6][16] | **Yes.** Self-hosted workload plane on AWS/GCP/OCI plus hybrid with Baseten Cloud (Enterprise) [5] | H100 $6.50/h, H100 MIG $3.75/h, L4 $0.85/h [1] |
| Modal | Any container (Python) | Yes. `min_containers`, `scaledown_window`, memory snapshots [20] | Yes, as ordinary HTTP. **Unverified** detail | `ap-southeast`, `ap-south`, `jp` and others, at a 1.15–1.75× price multiplier [19] | SOC 2 Type 2; BAA on Enterprise only [21] | No | H100 ≈ $3.95/h ($0.001097/s) [19] |
| Together AI | Serverless catalogue plus dedicated endpoints for custom or fine-tuned models [24] | Dedicated endpoints billed per minute [24] | Yes | Mentions Asia/Middle East storage regions; **unverified** for inference [24] | SOC 2 Type II; claims HIPAA [25] | Not documented | Dedicated H100 $3.99/h [24] |
| Fireworks | Upload your own Hugging Face weights [27] | Scale-to-zero after 1 hour idle by default; set min replicas [27] | Yes | **`AP_MALAYSIA_2`**, Tokyo, NSW. Region quota must be granted; region-locked deployments cost 1.5× [26][28] | SOC 2 Type II; HIPAA [29]. BAA **unverified** | Not documented | H100 about $8/h ($0.134/min) [28] |
| RunPod | Any container | Serverless flex or active workers | Yes | Reports 31 regions, including Asia [31] | SOC 2 Type II, HIPAA programme [31] | No | Serverless H100 flex $4.79/h [32] |
| Replicate (Cloudflare since Dec 2025 [33]) | Any Cog model | Private deployments bill for setup and idle time [34] | Yes | Not documented | Not documented [34] | No | H100 $5.49/h [34] |
| Cloudflare Workers AI | Fixed catalogue: Gemma 4 26B A4B, SEA-LION v4 27B, Whisper and Whisper-large-v3-turbo. Deepgram Nova-3, Flux and Aura are closed partner models [22][23][35]. **No MedGemma, no custom weights** documented | Serverless, no cold start to manage | SSE; WebSocket on some audio models [35] | No region control documented [38] | BAA on Enterprise; Workers, Workers AI, R2 and AI Gateway are in scope [39] | No | Gemma 4: $0.10 in / $0.30 out per million tokens; Whisper $0.000453/min [22][23] |
| DIY vLLM/SGLang on a GPU cloud | Anything | Your own job | Your own job | GCP `asia-southeast1` (Singapore): A100, A3 (H100) and G4 (RTX PRO 6000) [40]. AWS Malaysia (`ap-southeast-5`): G6 (L4) reported, no P5 [41] (**unverified** listing). Lambda: Tokyo, Osaka, India [42]. CoreWeave: US/EU [43] | Your controls plus the cloud's BAA | This is the on-prem shape | Varies |

## Baseten details

- **Products.** Model APIs are shared, per-token and OpenAI/Anthropic-compatible. Today they serve DeepSeek, GLM, Kimi, Nemotron and similar models. **No Gemma, MedGemma or ASR** is listed [7][8]. Dedicated deployments run your own model on reserved GPUs [3]. Hosting options are Baseten Cloud (multi-tenant, with a dedicated GPU per replica), Single-Tenant and Self-Hosted [17].
- **Truss.** A `config.yaml` plus an optional `model.py`, or a custom Docker server. You get development deployments with live patching, promotion into environments, and CI through the Truss Push Action [3][44]. Engines [3]:
  - Engine-Builder-LLM (TensorRT-LLM).
  - BIS-LLM, with KV-aware routing and speculative decoding.
  - BEI for embeddings.
  - Custom vLLM, SGLang or Ollama servers.
- **Gemma 4 recipe** [9]:
  - Variants and GPUs: E2B on an L4, E4B on an H100, 26B A4B on 2×H100, 31B on 2×H100 or an RTX PRO 6000.
  - Runs on vLLM with `enable-auto-tool-choice` and `reasoning-parser gemma4`.
  - Vision works, limited to one image per prompt.
  - Context is 256K tokens on 26B and 31B.
- **MedGemma.** No Baseten recipe exists. MedGemma is built on Gemma 3 [45], so a vLLM Truss should work. **Unverified until built.** Google says MedGemma "isn't yet clinical-grade" and needs validation for the intended use [45].
- **Autoscaling** [2]:
  - Defaults: `min_replica` 0 (scale to zero), `max_replica` 1, concurrency target 1, 70% target utilisation, 60-second window, 900-second scale-down delay.
  - Billing starts as soon as a replica starts booting.
  - One-time scheduled windows can raise `min_replica` for a set time range [18].
  - Deployments can be woken through the dashboard or the Inference API [44].
- **Cold starts.** A cold start pulls the image, loads the weights and initialises the engine. Baseten caches weights (BDN) and torch compile output [11]. The docs give **no cold-start durations**, so measure ours. For the demo, assume minutes and pre-warm.
- **Streaming.** A per-request `stream: true` flag, supported on Model APIs, BIS-LLM and Truss deployments [10]. WebSockets work for Truss models and Chains: messages up to 100 MiB, and connections are guaranteed at least 1 hour [14].
- **Audio** [12][13][15]:
  - A streaming-transcription WebSocket API for Whisper: 16 kHz PCM, partial transcripts, language options.
  - Baseten reports that one H100 MIG handles 40+ concurrent streams of Whisper V3 Turbo with real-time diarization.
  - Recipes exist for Qwen3-ASR (vLLM on an RTX PRO 6000, OpenAI-style chat API that takes an audio URL) and for MOSS-Transcribe-Diarize (1×H100, `/v1/audio/transcriptions`).
  - Qwen3-ASR supports Malay (`ms`), Mandarin, English and Chinese dialects. Its streaming mode needs vLLM and returns no timestamps [30].
- **GPUs** [1][46]:
  - Hourly prices: T4 $0.63, L4 $0.85, A10G $1.21, A100 $4.00, H100 MIG $3.75, H100 $6.50, B200 $9.98.
  - H200 and RTX PRO 6000 are available but not priced on the public page.
  - Up to 8 GPUs per instance, plus multi-node.
- **Regions.** Only `us` and `eu`, and only for GPU models. Chains and training can't pick a region, and the organisation must be verified. For other regions, contact support [4]. Regional environments need Baseten to set them up [47].
- **Compliance** [1][6][16]:
  - SOC 2 Type II; the report is available under NDA.
  - "HIPAA-eligible deployment configurations and … BAAs with qualifying customers."
  - Zero retention of inputs and outputs for synchronous inference.
  - A dedicated namespace per customer, and GPUs are never shared across customers.
  - The pricing page lists SOC 2 and HIPAA even on the free Basic plan. Self-host, data residency control and custom regions are Enterprise-only.
- **Self-hosted** [5]:
  - Baseten runs the control plane; the workload plane is a Kubernetes cluster in your AWS, GCP or OCI account.
  - "Inference payloads never leave your environment." Model code and images, metrics and billing data do pass through Baseten.
  - Hybrid mode routes constrained workloads to your cluster and everything else to Baseten Cloud.
  - Enterprise and custom pricing only. **The docs don't mention bare-metal on-prem.** Ask sales.
- **Chains.** Multi-model Python pipelines where each step (a "Chainlet") gets its own hardware and autoscaling. They support streaming and WebSockets [48]. For Sona, the Worker is already the orchestrator. Chains would move tool logic and patient isolation into Python on Baseten, away from where our auth and data live. Skip Chains unless one GPU step feeds another and the network hop matters.

## Architecture options

```
iPhone ──(Better Auth session)──▶ Worker (Hono/oRPC)
                                   │ authz: clinician ↔ patient/encounter
                                   │ tool loop, JSON validation, audit
                                   ├─▶ Baseten: orchestrator (vLLM, OpenAI API, SSE)
                                   ├─▶ Baseten: MedGemma (X-ray, med text)
                                   ├─▶ Baseten: ASR + diarization
                                   ├─▶ Workers AI (fallback LLM/ASR, env.AI binding)
                                   ├─▶ R2 (audio, images)   └─▶ Neon (records)
```

1. **Streaming goes through the Worker (recommended).** The phone streams SSE from the Worker, and the Worker streams from Baseten. An HTTP-triggered Worker has no wall-time limit while the client stays connected, and time spent waiting on `fetch` doesn't count as CPU time [49]. Running the tool loop in the Worker lets it:
   - check tool arguments against the encounter's patient ID before running a tool,
   - validate the JSON presentation spec,
   - forward only allowlisted events to the phone.

   The phone never sees model keys or raw model output. The alternative is streaming straight from the phone to Baseten. It saves one hop but puts keys on the phone (or needs a token broker) and bypasses patient isolation, so reject it.
2. **Audio path.** The phone asks the Worker for an upload URL. The Worker checks the session and encounter, then issues an R2 presigned PUT. The phone uploads straight to R2 [50]. The Worker then passes a short-lived presigned GET URL to Qwen3-ASR, which accepts audio by URL [12]. Presigned URLs work as bearer tokens, so keep expiry short [50]. The demo's scribe is record-then-transcribe, so batch upload is enough. **Live streaming ASR** (phone WebSocket → Worker or Durable Object → Baseten WebSocket [13][14]) is optional polish. Add it only if the demo shows live captions.
3. **Keys.** Store Baseten, R2 and AI Gateway credentials as Worker secrets (Alchemy-managed). Optionally route LLM calls through Cloudflare AI Gateway: it supports Baseten natively and custom HTTPS providers [51][52]. **AI Gateway logs prompts and responses by default** [53], so turn logging off for any real patient data.
4. **Keeping it warm for the demo.**
   - A one-time Baseten schedule from T−60 min to T+30 min with `min_replica: 1` on every model [18].
   - A warm-up script that hits each endpoint at T−10 min.
   - A health indicator in the Worker for the presenter.
   - Test the full run from the venue network.
5. **Fallback.** Per call, wrap the model client with a timeout and a single retry. After that:
   - The orchestrator falls back to Workers AI Gemma 4 26B A4B, which has the same model family, tool calling and vision [22].
   - ASR falls back to Workers AI Whisper-large-v3-turbo [23].
   - MedGemma and any remaining failure fall back to the existing labelled fixture response.

   Always label which path answered, to keep the "synthetic" and "open-weight only" claims honest.

## Malaysian data rules (short)

- **Health data is "sensitive personal data".** It covers "physical or mental health or condition" (Act 709 s4). Processing it needs explicit consent, or must be "for medical purposes" by a healthcare professional or someone with an equivalent duty of confidentiality (s40) [36].
- **PDPA does not apply to Federal and State Governments** (s3(1)) [36]. MOH public hospitals are therefore governed by government policy rather than PDPA. Private hospitals are bound by PDPA. For the B2B story, treat both as needing PDPA-grade controls.
- **The 2024 amendment (Act A1727).** Commencement dates are set in P.U.(B) 522 [37][54]:
  - From 1 April 2025, data processors are directly bound by the Security Principle, with fines up to RM1m or 3 years' jail.
  - Biometric data became sensitive data.
  - Section 129 on cross-border transfer was rewritten (also 1 April 2025).
  - From 1 June 2025, data protection officers are mandatory for controllers and processors, and breaches must be notified to the Commissioner.
- **Cross-border transfer (s129, Guideline 3/2025)** [55]. There is no longer a ministerial whitelist. A transfer is allowed:
  - to a place with a law that is "substantially similar", or
  - to a place with protection "at least equivalent" to Act 709 (assessed through a Transfer Impact Assessment, valid for 3 years), or
  - under an exception: consent, contract necessity, or due diligence through binding corporate rules, contractual clauses or certification.

  Contracts with processors must include personal-data and security clauses. Sending real Malaysian patient data to Baseten's US or EU regions needs one of these bases plus the hospital's agreement.
- **MOH, MDA and AI governance.** I found no MOH-specific guideline on cloud hosting or AI for clinical data (**unverified absence**). MDA regulates software as a medical device under Act 737 [56]. Clinical decision support such as triage, X-ray findings or prescribing may need classification. MOSTI's AI Governance and Ethics guidelines (Sept 2024) are voluntary [57].

## Open questions

1. Does Baseten offer, or plan, an APAC or Singapore region, and at what tier? Can a hospital's Baseten Self-hosted workload plane run on bare-metal on-prem Kubernetes rather than AWS, GCP or OCI? Is a BAA or DPA available on Pro? Ask sales.
2. What are our measured cold starts and end-to-end latency from Malaysia to US-region Baseten for Gemma 4 26B and MedGemma?
3. Which MedGemma variant do we use: 1.5 4B multimodal, or 27B multimodal? Does vLLM serve it cleanly? Does it meet the X-ray demo bar?
4. How accurate is Qwen3-ASR on Manglish code-switching? Is Whisper plus diarization better on our sample recordings?
5. Can Gemma 4 26B tool calling reliably produce our json-render spec, or do we need guided decoding (JSON schema) in vLLM?
6. Which hospital customer comes first: public (MOH policy) or private (PDPA)? This decides the residency requirement.
7. Should Fireworks `AP_MALAYSIA_2` be kept as the managed Malaysia-residency option? It needs a quota grant and BAA/DPA confirmation.

## Sources

1. Baseten pricing — https://www.baseten.co/pricing/
2. Baseten autoscaling — https://docs.baseten.co/deployment/autoscaling
3. Baseten docs overview — https://docs.baseten.co/
4. Baseten regional deployments — https://docs.baseten.co/deployment/regional-deployments.md
5. Baseten self-hosted — https://docs.baseten.co/hosting-options/self-hosted.md
6. Baseten secure inference — https://docs.baseten.co/observability/security.md
7. Baseten Model APIs overview — https://docs.baseten.co/inference/model-apis/overview.md
8. Baseten docs index — https://docs.baseten.co/llms.txt
9. Baseten Gemma 4 — https://docs.baseten.co/examples/models/llm/gemma-4.md
10. Baseten streaming — https://docs.baseten.co/inference/streaming.md
11. Baseten cold starts — https://docs.baseten.co/deployment/autoscaling/cold-starts.md
12. Baseten Qwen3-ASR — https://docs.baseten.co/examples/models/transcription/qwen3-asr.md
13. Baseten streaming transcription API — https://docs.baseten.co/reference/inference-api/predict-endpoints/streaming-transcription-api.md
14. Baseten WebSockets — https://docs.baseten.co/development/model/websockets.md
15. Baseten, "The fastest Whisper — with streaming and diarization" — https://www.baseten.co/blog/the-fastest-whisper-transcription-with-streaming-and-diarization/ ; MOSS-Transcribe-Diarize — https://docs.baseten.co/examples/models/transcription/moss-transcribe-diarize.md
16. Baseten security practices — https://www.baseten.co/security-practices/ ; trust centre — https://trust.baseten.co/
17. Baseten hosting options — https://docs.baseten.co/hosting-options/overview.md
18. Baseten scheduled autoscaling — https://docs.baseten.co/deployment/autoscaling/schedules.md
19. Modal pricing — https://modal.com/pricing ; region selection — https://modal.com/docs/guide/region-selection
20. Modal cold starts — https://modal.com/docs/guide/cold-start
21. Modal security — https://modal.com/docs/guide/security
22. Workers AI Gemma 4 26B A4B — https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/ ; pricing — https://developers.cloudflare.com/workers-ai/platform/pricing/
23. Workers AI Whisper — https://developers.cloudflare.com/workers-ai/models/whisper/ ; model catalogue — https://developers.cloudflare.com/workers-ai/models/
24. Together pricing — https://www.together.ai/pricing ; deployment options — https://docs.together.ai/docs/deployment-options ; dedicated endpoints — https://www.together.ai/dedicated-endpoints
25. Together trust centre — https://trust.together.ai/ ; SOC 2 post — https://www.together.ai/blog/soc-2-compliance
26. Fireworks regions — https://docs.fireworks.ai/deployments/regions
27. Fireworks deployments — https://docs.fireworks.ai/guides/ondemand-deployments
28. Fireworks pricing — https://fireworks.ai/pricing
29. Fireworks data security — https://docs.fireworks.ai/guides/security_compliance/data_security ; trust centre — https://trust.fireworks.ai/
30. Qwen3-ASR — https://github.com/QwenLM/Qwen3-ASR
31. RunPod compliance — https://www.runpod.io/legal/compliance ; trust centre — https://trust.runpod.io/
32. RunPod pricing — https://www.runpod.io/pricing
33. Cloudflare to acquire Replicate — https://www.cloudflare.com/press/press-releases/2025/cloudflare-to-acquire-replicate-to-build-the-most-seamless-ai-cloud-for-developers/ ; closing date and price from Cloudflare 10-Q — https://www.sec.gov/Archives/edgar/data/0001477333/000147733326000054/cloud-20260630.htm
34. Replicate pricing — https://replicate.com/pricing
35. Workers AI partner models and WebSocket audio — https://developers.cloudflare.com/changelog/post/2025-08-27-partner-models/
36. Personal Data Protection Act 2010 (Act 709), consolidated text — https://www.pdp.gov.my/ppdpv1/wp-content/uploads/2024/07/UNDANG-UNDANG-MALAYSIA_AKTA_PERLINDUNGAN_DATA_PERIBADI_2010_709_MALAY_AND-ENG_V2022.pdf
37. Personal Data Protection (Amendment) Act 2024, Act A1727 — https://www.pdp.gov.my/ppdpv1/wp-content/uploads/2024/11/Act-A1727.pdf
38. Workers AI data usage — https://developers.cloudflare.com/workers-ai/platform/data-usage/
39. Cloudflare HIPAA FAQ — https://www.cloudflare.com/trust-hub/compliance-resources/hipaa/
40. GCP GPU regions — https://docs.cloud.google.com/compute/docs/gpus/gpu-regions-zones
41. AWS Malaysia region — https://aws.amazon.com/blogs/aws/now-open-aws-asia-pacific-malaysia-region/ ; EC2 instance types by region — https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-regions.html
42. Lambda on-demand cloud — https://docs.lambda.ai/public-cloud/on-demand/
43. CoreWeave regions — https://docs.coreweave.com/docs/platform/regions
44. Baseten scaling and wake — https://docs.baseten.co/deployment/manage/scaling.md ; Truss — https://github.com/basetenlabs/truss
45. MedGemma — https://developers.google.com/health-ai-developer-foundations/medgemma ; Hugging Face — https://huggingface.co/google/medgemma-27b-it
46. Baseten resources — https://docs.baseten.co/deployment/resources.md
47. Baseten regional environments — https://docs.baseten.co/deployment/regional-environments.md
48. Baseten Chains — https://docs.baseten.co/development/chain/overview.md
49. Workers limits — https://developers.cloudflare.com/workers/platform/limits/
50. R2 presigned URLs — https://developers.cloudflare.com/r2/api/s3/presigned-urls/
51. AI Gateway unified API (Baseten provider) — https://developers.cloudflare.com/ai-gateway/usage/chat-completion/
52. AI Gateway custom providers — https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/
53. AI Gateway logging — https://developers.cloudflare.com/ai-gateway/observability/logging/
54. P.U.(B) 522, commencement of Act A1727 — https://www.pdp.gov.my/ppdpv1/wp-content/uploads/2024/12/PENETAPAN-TARIKH-PERMULAAN-KUAT-KUASA-1.pdf
55. PDP Guideline 3/2025, Cross Border Personal Data Transfer — https://www.pdp.gov.my/ppdpv1/wp-content/uploads/2025/08/GP_CBPDT_EN-1.pdf
56. MDA guidance documents — https://www.mda.gov.my/index.php/doc-list/guidance-document
57. MOSTI, National Guidelines on AI Governance and Ethics — https://mastic.mosti.gov.my/storage/2024/09/THE-NATIONAL-GUIDELINES-ON-AI-GOVERNANCE-ETHICS.pdf

## Addendum: Baseten agents, training and regions (checked 2026-09-25)

- **No agent framework.** Baseten's product areas are Model APIs, Dedicated Inference, inference engines, Training Jobs, Loops, observability, autoscaling, environment management, Frontier Gateway and a distribution platform. "Agents" in the docs means pointing coding agents at Model APIs. The agent loop stays in our code. Source: https://docs.baseten.co/overview
- **Training Jobs.** Bring your own container on H100/H200, single or multi-node. Documented frameworks: Axolotl, TRL, VeRL, MS-Swift. Checkpoints sync automatically and deploy with `baseten train checkpoint deploy --job-id <id>`. Unsloth is **not** documented. It is a Python library, so it should run inside a custom container, but that is **unverified**. The ML Cookbook has no Unsloth or Gemma example. Sources: https://docs.baseten.co/training/overview, https://github.com/basetenlabs/ml-cookbook
- **Loops (early access, signup required).** Managed SFT and RL with trainer/sampler APIs. Supported bases include Gemma 4 26B and 31B, Qwen3.5/3.6/3.8, DeepSeek-V4-Flash, GLM-5.x, Kimi and Nemotron-3. It does **not** list MedGemma or Qwen3-ASR. Checkpoints deploy to the Baseten Inference Stack. Sources: https://docs.baseten.co/loops/overview, https://docs.baseten.co/loops/supported-models
- **Regional environments.** These pin inference traffic to workload planes in one region. US, EU, UK and Australia are named. Asia is not listed, so contact support. Source: https://docs.baseten.co/deployment/regional-environments

## Addendum: minimum GPU sizing (checked 2026-09-25)

- **Baseten instance catalogue and prices** (https://www.baseten.co/pricing/, https://docs.baseten.co/deployment/resources):
  - GPUs: T4 16 GiB $0.63/h · L4 24 GiB $0.85/h · A10G 24 GiB $1.21/h · A100 80 GiB $4.00/h · H100 MIG 40 GiB $3.75/h · H100 80 GiB $6.50/h · B200 180 GiB $9.98/h.
  - H200 (141 GiB) and RTX PRO 6000 (96 GiB) exist but are not priced publicly.
  - CPU instances run from $0.035/h (1x2) to $0.83/h (16x64).
- **Parameter counts** from the Hugging Face safetensors metadata:
  - Gemma 4 26B A4B: 25.8B (BF16)
  - MedGemma 1.5 4B: 4.30B
  - Qwen3-ASR-1.7B: 2.35B, including its audio encoder
  - Qwen3-ForcedAligner-0.6B: 0.92B
  - VoxCPM2: 2.29B
  - Nemotron-3-Diarization: 99M (F32)
  - laya-multilingual: 322M (F16)
  - OpenMed PII comes in 44M (SuperClinical-Small) through 434M (SuperClinical-Large).
- **Gemma 4 quantised checkpoints on Hugging Face:**
  - Google's official QAT Q4_0: `google/gemma-4-26B-A4B-it-qat-q4_0-unquantized` and a GGUF build
  - `cyankiwi/gemma-4-26B-A4B-it-qat-AWQ-INT4` (AWQ, for vLLM)
  - `RedHatAI/gemma-4-26B-A4B-it-FP8-dynamic`
  - NVFP4 builds, which need Blackwell
- **Working-memory estimates** (weights + KV cache + runtime; to measure on day 1):

  | Model | Precision | Estimate |
  |---|---|---|
  | Gemma INT4 (QAT-AWQ) | INT4 | ~18–20 GB |
  | Gemma FP8 | FP8 | ~30–32 GB |
  | MedGemma | FP8 | ~7–8 GB |
  | MedGemma | BF16 | ~11 GB |
  | Qwen3-ASR | BF16 | ~6–7 GB |
  | VoxCPM2 | BF16 | ~6–8 GB |
  | ForcedAligner | BF16 | ~2.5 GB |
  | Nemotron diarization | F32 | ~1 GB |
  | Laya | F16 | ~1 GB |
  | OpenMed Small | — | <0.5 GB |

- **Why not the T4:** Turing has no BF16 or FP8. Gemma-family models are prone to FP16 overflow, so the T4 is avoided for vLLM models.
- **Why the L4:** it is Ada Lovelace and supports FP8.

## Addendum: serving fine-tuned checkpoints (checked 2026-09-25)

- **One-click deploy** (`truss train deploy_checkpoints --job-id <id>`) "automatically recognizes checkpoints for full fine-tunes and LoRAs for LLMs and Whisper models". FSDP checkpoints need manual configuration. LoRA deployments set `base_model_id` and are served on vLLM. Source: https://docs.baseten.co/training/deployment, https://docs.baseten.co/llms-full.txt
- **Any other model** (Qwen3-ASR, VoxCPM2, Nemotron, Laya, a packed multi-model box) uses a custom Truss that mounts the checkpoint:

  ```yaml
  weights:
    - source: "bt://<project>@<job_id>/<checkpoint>"
      mount_location: "/models/..."
  ```

  - `bt://` defaults to the latest job and checkpoint.
  - Other supported sources: `hf://`, `s3://`, `gs://`, `r2://`.
- **Portability:** `baseten train checkpoint files` returns presigned URLs that expire after 7 days. Copy the weights to our own bucket (for example S3 in Malaysia) and load them with `s3://`. "For self-hosted deployments, training can use storage buckets in your own AWS or GCP account."
- **Endpoints:** OpenAI-compatible servers are called at `https://model-{model_id}.api.baseten.co/environments/production/sync/v1`.
- **Unverified:**
  - vLLM LoRA on top of the INT4 (AWQ) Gemma 4 MoE base. The fallback is to merge the LoRA into BF16 and then re-quantise.
  - Training region selection. Earlier finding: training "can't pick a region", so train only on synthetic or fictional data unless training runs self-hosted.

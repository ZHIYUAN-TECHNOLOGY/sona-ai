# Inference platforms for Southeast Asia

Researched 27 September 2026 from vendor docs, pricing pages, trust pages, GitHub and live vendor APIs. **Unverified** marks claims I could not confirm from a primary page. This extends [model hosting](model-hosting.md) for the production question: real patient data, hosted in Malaysia or Singapore. Where the two docs disagree, this one is newer. In particular, RunPod has no usable Southeast Asia capacity.

## Criteria

1. **Hosting.** Runs our own Docker images (Qwen3-ASR, VoxCPM2, a Gemma-class LLM) on an L4-class GPU, with WebSocket streaming.
2. **MCP.** An official MCP server that lets agents manage deployments. A docs-only MCP counts for less.
3. **Skills.** Official agent skills (SKILL.md), a Claude Code plugin, or llms.txt.
4. **Training.** Training jobs that run our own code.
5. **HIPAA.** A signed BAA, and on which plan.
6. **Southeast Asia region.** Malaysia or Singapore, self-serve or through sales.
7. **Quality.** SLA, maturity and known weaknesses.

Malaysia PDPA context: health data is sensitive personal data. Since 1 April 2025, a transfer abroad (including to Singapore) needs a Transfer Impact Assessment, reviewed every three years. Hosting in Malaysia avoids that assessment. ([Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2025/07/from-legislative-reform-to-practical-guidance-key-amendments-to-malaysias-pdpa-and-the-launch-of-cross-border-transfer-guidelines))

## Comparison

| Platform | Custom Docker on L4, WebSocket | MCP (manage deployments) | Agent skills | Training (own code) | HIPAA BAA | Southeast Asia region | Quality | L4-class price |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Baseten** (current) | Yes. L4, WebSocket, scale to zero | **Yes**, `api.baseten.co/mcp` | **Yes**, `basetenlabs/baseten-skills` | Yes, Training jobs | "Qualifying customers". SOC 2 II | **None self-serve.** Region set up by support; Self-hosted in our AWS or GCP account (Enterprise) | Best inference developer experience; 99.99% claimed, SLA on Enterprise only | L4 $0.85/h (US) |
| **AWS SageMaker AI** | Yes. `ml.g6` (L4). Bidirectional streaming (WebSocket to the container) | **Yes**, AWS MCP Server, `sagemaker-ai-mcp-server` | **Yes**, `awslabs/agent-plugins` sagemaker-ai | Yes. L4 in Malaysia | **Yes, self-serve** (AWS Artifact). SageMaker is eligible | **Malaysia `ap-southeast-5`: L4.** Singapore has no L4 (T4/A10G only). Bidirectional streaming was not on Malaysia's launch list (**unverified** now) | 99.95% SLA. More operations work ourselves (IAM, VPC, scaling) | Malaysia `ml.g6.xlarge` $1.42/h |
| **Google Cloud Run GPU / Vertex AI** | Cloud Run: L4, WebSocket, scale to zero. Vertex: custom containers; WebSocket **unverified** | **Yes**, remote MCP (Vertex, Cloud Run), `gcloud-mcp` | **Yes**, `google/skills` (deploy, endpoints, Cloud Run) | Yes. Vertex training on L4 in Singapore | **Yes**, covers Vertex and Cloud Run | **Singapore: L4.** No live Malaysia region (**unverified**) | Cloud Run 99.95% zonal; Vertex 99.5% | Cloud Run L4 ≈ $0.67/h base (Singapore tier **unverified**); Vertex g2 ≈ $1.21/h |
| **Alibaba PAI-EAS** | Custom image, WebSocket, gRPC. **No L4** (T4, A10, L20) | **Yes**, OpenAPI MCP (all APIs) | **Yes**, `aliyun/alibabacloud-aiops-skills` (EAS deploy, DLC) | Yes, PAI-DLC in Kuala Lumpur and Singapore | BAA "fully supported"; PAI scope **unverified** | **Self-serve: Kuala Lumpur, Johor, Singapore**, Jakarta, Bangkok | Mature, good English docs; EAS SLA **unverified** | A10 ≈ $2.39/h (Hong Kong, third-party) |
| **Northflank** | Yes. L4, WebSocket. **No scale to zero** | No (third-party only) | **Yes**, `northflank/skills` | Yes, GPU jobs | Enterprise only. SOC 2 II | Managed `asia-southeast` has L4 (city **unverified**). **Self-serve deploy into our own AWS/GCP account** | General-purpose platform, less inference tuning; SLA on Enterprise | L4 $0.80/h |
| **Modal** | Yes. L4, WebSocket, scale to zero | No (community only) | **Yes**, `modal skills install` | Yes | Enterprise only. **User code and Images are outside the BAA** | Self-serve `ap-southeast` at 1.75× (city and L4 **unverified**) | Strong developer experience; 284+ incidents in about 2 years (StatusGator) | L4 ≈ $1.40/h in `ap-southeast` |
| **Fireworks** | **No Docker**: weights only for supported LLMs. Cannot run our ASR or TTS | Docs MCP only | llms.txt | Training API on hosted models only | BAA on request (Business+) | **`AP_MALAYSIA_2`**; quota through sales | Fast LLM serving | H100 $8/h ×1.5 per region |
| **Together AI** | Containers through sales. No L4 (H100+) | Docs MCP only | **Yes**, 12 skills | Instant Clusters | Claims BAA; tier **unverified** | Asia only for large clusters, through sales | Good, H100-class | H100 $3.99/h (promo) |
| **Azure ML** | Custom containers. **No L4**, no scale to zero, **180 s request cap** | Azure MCP (no ML endpoint tools) | Azure skills plugin (no ML skill) | Yes | BAA by default; Azure ML scope **unverified** | Singapore, **Malaysia West** (T4, A10) | Weakest fit for streaming voice | T4 $0.63–0.74/h |

Ruled out:

- **Hugging Face Endpoints:** US and EU regions only. BAA on Enterprise only.
- **RunPod:** Singapore is unlisted with no stock; Asia has only H100s in Japan. BAA needs about $3k/month commitment (**unverified**).
- **BytePlus MLP:** in Johor, but no HIPAA, no MCP or skills, and thin docs. $5.21/h.
- **GMI Cloud:** H100-class only, no HIPAA found, and its MCP only calls models.
- **YTL AI Cloud:** GB200 capacity by contract only.
- **Nebius** (checked 3 Oct 2026): no Asian region, public or private, and none announced. Its 9 regions are in Europe, Israel and the US; APAC is a sales office in Singapore ([regions](https://docs.nebius.com/overview/regions), [APAC](https://nebius.com/newsroom/nebius-expands-into-asia-pacific-region-to-support-rapid-global-growth)). It is a GPU cloud, not an inference platform. It has no 24 GB GPU (L40S 48 GB from $1.55/h, H100 $4.50/h from 1 Oct [prices](https://nebius.com/prices)). Its serverless endpoints run custom containers but have no autoscaling until "Q4+ 2026" and are outside its BAA ([HIPAA](https://docs.nebius.com/legal/hipaa)). It has an official local MCP ([nebius/mcp-server](https://github.com/nebius/mcp-server), beta) and a Claude Code plugin with 13 skills ([nebius/skills](https://github.com/nebius/skills), v0.1.0). Possible use: cheaper H100 training on synthetic data.

## Cost by environment

GPU compute only, monthly, USD at list price. Excludes Agent, database, storage, egress, credits and Enterprise fees. Workload is the [delivery plan](../delivery-plan.md) box set: ① Brain, ② Voice, ③ X-ray, one L4-class GPU each, about 4 vCPU and 16 GB RAM.

| Environment | Hours assumed | L4-hours per month |
| --- | --- | --- |
| Development | ①② warm 8 h × 22 days; ③ about 20 h | 372 |
| Staging and demos | All three boxes, 40 h (about 10 demo sessions) | 120 |
| Production pilot, one hospital | All three warm in clinic hours, 12 h × 22 days | 792 |
| Production 24/7, one hospital | All three always on, 730 h | 2,190 |

Development and staging carry synthetic data only, so they may run in the cheapest region. Production must be in Malaysia or Singapore.

| Platform (production region) | Rate per L4 box-hour | Development | Staging | Pilot | 24/7 | Plan needed for a BAA |
| --- | --- | --- | --- | --- | --- | --- |
| **Baseten Cloud (US)** | $0.85 | **$316** | **$102** | Not allowed (US) | Not allowed (US) | Qualifying customers |
| **Baseten Self-hosted on AWS Malaysia** | EC2 `g6.xlarge` $1.01 (delivery plan) + Enterprise fee | — | — | $800 + fee | $2,212 + fee | Enterprise (quote) |
| **AWS SageMaker (Malaysia)** | `ml.g6.xlarge` $1.42 | $528 | $170 | $1,125 | $3,110 | Free, self-serve |
| **Google Cloud Run GPU (Singapore)** | ≈ $1.10 (L4 $0.67 + 4 vCPU + 16 GiB). Zonal redundancy ≈ $1.45 | $409 | $132 | $871 | $2,409 (zonal ≈ $3,180) | Free, BAA via console |
| **Northflank (Asia or our AWS)** | ≈ $1.00 (L4 $0.80 + CPU/RAM) | $372 | $120 | $792 | $2,190 | Enterprise |
| **Modal** (dev US, prod `ap-southeast` 1.75×) | $1.02 US, $1.79 `ap-southeast` | $379 | $122 | $1,418 | $3,920 | Enterprise (custom fee) |
| **Alibaba PAI-EAS (Kuala Lumpur)** | A10 ≈ $2.39 (Hong Kong, third-party; SEA **unverified**) | — | — | Quote | Quote | Supported; PAI scope **unverified** |

Discounts not modelled: SageMaker Savings Plans (1 or 3 year) for always-on production; Cloud Run 1-year CUD (−17%) applies to CPU and memory only, not the GPU. Modal Team plan is $250/month with $100 credit; Starter gives $30/month.

Rates:
- [Baseten pricing](https://www.baseten.co/pricing/): L4 $0.01414/min.
- [AWS SageMaker Malaysia price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSageMaker/current/ap-southeast-5/index.json): hosting `ml.g6.xlarge` $1.4193/h, `ml.g6.2xlarge` $1.5393/h, training `ml.g6.xlarge` $1.419/h.
- [Cloud Run pricing](https://cloud.google.com/run/pricing): L4 $0.0001867/s non-zonal, $0.0002909/s zonal; CPU $0.000018/vCPU-s; memory $0.000002/GiB-s. L4 needs at least 4 vCPU and 16 GiB. Singapore is Tier 2, and its CPU/memory uplift is **unverified**.
- [Northflank pricing](https://northflank.com/pricing): L4 $0.80/h, $0.01667/vCPU-h, $0.00833/GB-h.
- [Modal pricing](https://modal.com/pricing): L4 $0.000222/s, $0.0000131/core-s (1 core = 2 vCPU), $0.00000222/GiB-s.

## Cloudflare

Cloudflare has no Baseten equivalent for our models today.

- **Workers AI** runs a fixed catalogue. It includes `gemma-4-26b-a4b-it` ($0.10/M input, $0.30/M output tokens), Whisper ($0.0005 per audio minute), Deepgram Nova-3 and Flux for speech-to-text, and Aura-2 and MeloTTS for speech. It has no MedGemma, Qwen3-ASR or VoxCPM2. Bring-your-own-model is at the design-partner stage; Enterprise custom models go through sales ([blog](https://blog.cloudflare.com/ai-platform/), [models](https://developers.cloudflare.com/workers-ai/models/), [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)).
- **Workers AI location.** It is not compatible with Regional Services, and inference can run in any of 180+ cities. So inference **cannot be pinned** to Malaysia or Singapore ([compatibility](https://developers.cloudflare.com/data-localization/compatibility/)).
- **Replicate** (a Cloudflare company) runs custom Cog containers with a training API and an official MCP server. It offers T4 at $0.81/h and L40S at $3.51/h, with **no L4**. I found no BAA and no region control for it ([pricing](https://replicate.com/pricing), [MCP](https://replicate.com/docs/reference/mcp)).
- **Containers** are CPU only (up to 4 vCPU and 12 GiB). GPUs are "coming soon" ([limits](https://developers.cloudflare.com/containers/platform-details/limits/)).
- **BAA.** Cloudflare signs a BAA with Enterprise customers only. The two research passes disagree on whether Workers AI is in scope ([HIPAA](https://www.cloudflare.com/trust-hub/compliance-resources/hipaa/)).
- **Effect on our own app layer.** Durable Objects and R2 can be regionalised to Singapore, but **not Malaysia** ([region support](https://developers.cloudflare.com/data-localization/region-support/)). If real data must stay in Malaysia, the Agent layer has a residency gap too.

## Healthcare adoption

| Platform | Named healthcare users | HITRUST | Southeast Asia healthcare use | Fit (1–5) |
| --- | --- | --- | --- | --- |
| AWS | HealthScribe with 3M HIS and Netsmart | **Yes** (SageMaker, Bedrock, Transcribe) | Singapore Healthcare Commercial Cloud (Synapxe) is built on AWS | 5 |
| Azure | Mass General Brigham, UW-Madison; chest X-ray model CXRReportGen | **Yes** (162 services) | Synapxe Secure GPT runs on Azure OpenAI | 5 |
| Google Cloud | HCA Healthcare, Manipal; MedGemma in Model Garden | Yes (Vertex AI scope **unverified**) | Synapxe HEALIX and Tandem use Vertex AI | 4 |
| Baseten | **OpenEvidence** (inference and training), Abridge, Latent Health | Not found | None found | 4 |
| Fireworks | RADPAIR (radiology) | Not found | None | 3 |
| Together | Latent Health, Slingshot AI | Not found | None | 3 |
| Modal | Chai Discovery (biotech only) | Not found | None | 3 |
| Northflank | Versaia (voice agents) | Not found | None | 3 |
| Alibaba | PuraPharm (Hong Kong); has ISO 27799 | Not listed | No Southeast Asian hospital found | 2 |
| Cloudflare AI | None for AI | Not found | None | 1 |

Malaysian procurement:
- **Government cloud panel.** Malaysia's MyGovCloud framework (2022) names AWS, Google Cloud, Microsoft and Telekom Malaysia ([report](https://themalaysianreserve.com/2022/05/09/govt-inks-cfa-with-4-cloud-service-providers/)).
- **Confidential data.** The National Cloud Computing Policy (August 2025) requires confidential data to stay in a sovereign cloud inside Malaysia ([MyDigital](https://www.digital.gov.my/en-GB/siaran/National-Cloud-Computing-Policy-(NCCP)-Driving-Malaysia's-Digital-Transformation-In-A-Secure,-Inclusive,-And-Sustainable-Manner)).
- **Consequence.** A specialist platform would need to run inside our own AWS account in Malaysia to sell to public hospitals.

Healthcare sources:
- Baseten: [OpenEvidence](https://www.baseten.co/resources/customers/openevidence-delivers-instant-medical-information-with-baseten/)
- AWS: [HITRUST scope](https://aws.amazon.com/compliance/services-in-scope/HITRUST-CSF/), [Synapxe](https://www.synapxe.sg/media-releases/collaboration/synapxe-launches-first-healthtech-co-innovation-lab-with-aws-boost-public-healthcare-innovation)
- Azure: [HITRUST](https://learn.microsoft.com/en-us/azure/compliance/offerings/offering-hitrust), [Synapxe](https://www.synapxe.sg/news/collaboration/ihis-microsoft-to-develop-ai-tool-help-healthcare-workers-singapore)
- Google Cloud: [Synapxe](https://technode.global/2025/06/17/synapxe-partners-google-cloud-to-boost-ai-capabilities-and-transform-healthtech-in-singapore/)
- Fireworks: [RADPAIR](https://fireworks.ai/blog/radpair)

## Side by side

Production means one hospital, 24/7, GPU only. Development and staging run in the cheapest region because they carry synthetic data only.

| | Baseten | AWS SageMaker | Google Cloud Run | Northflank | Modal | Alibaba PAI-EAS | Cloudflare |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Production region | Own AWS in Malaysia (Enterprise) | **Malaysia** | Singapore | Own AWS in Malaysia, or its Asia region | `ap-southeast` | **Kuala Lumpur, Johor** | Not pinnable |
| Our Docker on L4 + WebSocket | Yes | Yes (streaming in Malaysia **unverified**) | Yes | Yes, no scale to zero | Yes | Yes, but A10, no L4 | Replicate only (T4/L40S) |
| MCP / skills | Yes / yes | Yes / yes | Yes / yes | No / yes | No / yes | Yes / yes | Replicate MCP / Cloudflare skills |
| Training | Yes | Yes | Yes (Vertex) | Yes | Yes | Yes | Replicate API |
| BAA | Qualifying customers | **Free, self-serve** | **Free** | Enterprise | Enterprise | Supported | Enterprise |
| HITRUST | — | **Yes** | Yes | — | — | — | — |
| Healthcare fit | 4 | **5** | 4 | 3 | 3 | 2 | 1 |
| On Malaysia government panel | Only via our AWS | **Yes** | Yes | Only via our AWS | No | No | No |
| Dev / staging per month | **$316 / $102** | $528 / $170 | $409 / $132 | $372 / $120 | $379 / $122 | Quote | ≈ $301 / $97 (Replicate T4) |
| Production 24/7 per month | $2,212 + fee | $3,110 | $2,409 | $2,190 (+ Enterprise) | $3,920 | Quote | Not possible |

## Verdict

1. **AWS SageMaker in `ap-southeast-5` (Malaysia)** is the only option that meets every criterion self-serve: L4 in-country, a self-serve BAA, official MCP and skills, training, and a 99.95% SLA. It also has the strongest healthcare evidence (HITRUST, Synapxe) and is on Malaysia's government cloud panel. The risks are that bidirectional streaming in Malaysia is unconfirmed, and that we'd do more operations work than on Baseten.
2. **Baseten Self-hosted on AWS Malaysia** keeps today's Truss images, MCP and skills while keeping data in Malaysia. It needs an Enterprise quote.
3. **Google Cloud Run GPU in Singapore** is closest to Baseten in feel (L4, WebSocket, scale to zero, BAA). But Singapore means a PDPA Transfer Impact Assessment.
4. **Alibaba PAI-EAS in Kuala Lumpur or Johor** has self-serve Malaysia hosting and good agent tooling, but no L4 and an unverified BAA scope.
5. **Cloudflare** stays the app layer, not the model host. It cannot pin inference or run our custom models, and it regionalises only to Singapore.

## Sources

- Baseten: [custom server](https://docs.baseten.co/development/model/custom-server), [WebSockets](https://docs.baseten.co/development/model/websockets), [MCP and skill](https://www.baseten.co/blog/new-mcp-and-skill-for-coding-agents-to-use-baseten/), [skills repo](https://github.com/basetenlabs/baseten-skills), [training](https://docs.baseten.co/training/concepts/basics), [security](https://docs.baseten.co/observability/security), [regional environments](https://docs.baseten.co/deployment/regional-environments), [pricing](https://www.baseten.co/pricing/)
- AWS: [bidirectional streaming](https://aws.amazon.com/blogs/machine-learning/introducing-bidirectional-streaming-for-real-time-inference-on-amazon-sagemaker-ai/), [launch regions](https://aws.amazon.com/about-aws/whats-new/2025/11/sagemaker-ai-inference-bidirectional-streaming), [scale to zero](https://docs.aws.amazon.com/sagemaker/latest/dg/endpoint-auto-scaling-zero-instances.html), [sagemaker-ai MCP](https://github.com/awslabs/mcp/tree/main/src/sagemaker-ai-mcp-server), [Agent Toolkit](https://github.com/aws/agent-toolkit-for-aws), [sagemaker-ai plugin](https://github.com/awslabs/agent-plugins/tree/main/plugins/sagemaker-ai), [HIPAA services](https://aws.amazon.com/compliance/hipaa-eligible-services-reference/), [Malaysia price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSageMaker/current/ap-southeast-5/index.json), [SLA](https://aws.amazon.com/sagemaker/sla/)
- Google Cloud: [Cloud Run GPU](https://docs.cloud.google.com/run/docs/configuring/services/gpu), [Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets), [Vertex dedicated endpoints](https://docs.cloud.google.com/vertex-ai/docs/predictions/using-dedicated-endpoints), [locations](https://docs.cloud.google.com/vertex-ai/docs/general/locations), [MCP servers](https://docs.cloud.google.com/mcp/supported-products), [gcloud-mcp](https://github.com/googleapis/gcloud-mcp), [skills](https://github.com/google/skills), [HIPAA](https://cloud.google.com/security/compliance/hipaa), [Vertex SLA](https://cloud.google.com/vertex-ai/sla), [Cloud Run SLA](https://cloud.google.com/run/sla), [Cloud Run pricing](https://cloud.google.com/run/pricing)
- Alibaba: [custom image](https://www.alibabacloud.com/help/en/pai/user-guide/deploy-a-model-service-by-using-a-custom-image), [EAS billing](https://www.alibabacloud.com/help/en/pai/product-overview/billing-of-eas), [regions](https://www.alibabacloud.com/help/en/pai/product-overview/regions-and-zones), [OpenAPI MCP](https://github.com/aliyun/alibabacloud-api-mcp-server), [aiops skills](https://github.com/aliyun/alibabacloud-aiops-skills), [HIPAA](https://www.alibabacloud.com/trust-center/hipaa), [Johor launch](https://www.alibabacloud.com/en/press-room/alibaba-cloud-amplifies-malaysia-infrastructure?_p_lc=1)
- Northflank: [pricing](https://northflank.com/pricing), [asia-southeast](https://northflank.com/cloud/northflank/regions/asia-southeast), [skills](https://github.com/northflank/skills), [autoscaling](https://northflank.com/docs/v1/application/scale/autoscale-deployments)
- Modal: [region selection](https://modal.com/docs/guide/region-selection), [security and BAA](https://modal.com/docs/guide/security), [skills CLI](https://modal.com/docs/reference/cli/skills), [pricing](https://modal.com/pricing)
- Fireworks: [regions](https://docs.fireworks.ai/deployments/regions), [custom models](https://docs.fireworks.ai/models/uploading-custom-models), [trust FAQ](https://trust.fireworks.ai/faq), [pricing](https://fireworks.ai/pricing)
- Together: [container inference](https://docs.together.ai/docs/dedicated-container-inference), [agent skills](https://docs.together.ai/docs/agent-skills), [endpoint pricing](https://docs.together.ai/docs/dedicated-endpoints/pricing)
- Azure: [endpoint VM SKUs](https://learn.microsoft.com/en-us/azure/machine-learning/reference-managed-online-endpoints-vm-sku-list), [quotas](https://learn.microsoft.com/en-us/azure/machine-learning/how-to-manage-quotas), [Azure MCP tools](https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/tools/), [Azure skills](https://github.com/microsoft/azure-skills), [Malaysia West](https://news.microsoft.com/source/asia/features/microsoft-announces-its-first-cloud-region-in-malaysia-empowering-more-malaysian-organizations-to-accelerate-ai-innovation/)
- Ruled out: [HF endpoints FAQ](https://huggingface.co/docs/inference-endpoints/en/faq), [RunPod compliance](https://www.runpod.io/legal/compliance), [BytePlus compliance](https://www.byteplus.com/en/trust-center/compliance), [GMI GPUs](https://www.gmicloud.ai/en/gpus), [YTL AI Cloud](https://www.ytlaicloud.com/)

# Medical model selection for Sona

Researched 2026-09-24. Primary sources only, except where marked **(secondary)** or **(unverified)**. Benchmarks are vendor-reported unless stated otherwise. None of them shows that a model is safe for clinical use.

## Question

Which open-weight models that can be hosted on Baseten should power Sona's five medical capabilities: patient briefing, note generation, clinical reasoning, chest X-ray interpretation, and grounded medication checks? Can one model handle several of them? Which drug datasets can a prototype legally use?

## Were there new releases this month or today?

- **No new MedGemma or medical-specific Google release was found in September 2026.** The Hugging Face (HF) listing still shows MedGemma 1.5 4B (repo created 2026-01-07) as the newest MedGemma. [HF API: google/medgemma](https://huggingface.co/api/models?author=google&search=medgemma), [HF MedGemma collection](https://huggingface.co/collections/google/medgemma-release). Google's newest HF model is `gnm-v3` (2026-09-01), which is not medical. [HF API: google, newest first](https://huggingface.co/api/models?author=google&sort=createdAt&direction=-1). Google Research's blog has no MedGemma post up to 2026-09-18. [Google Research blog](https://research.google/blog/)
- Some web-search summaries say MedGemma was updated in "September 2026". The primary pages do not support this, and the claim appears to be a summariser error. **Treat it as false.**
- **Today (2026-09-24):** an aggregator lists Claude Opus 5.5 and GPT-6 Luna/Sol (both closed) plus Xiaomi MiMo-V2.6 Flash/Pro **(secondary)**. [llm-stats](https://llm-stats.com/ai-news). MiMo-V2.6 weights are on HF under MIT (repos created 2026-09-21). The Flash model is 309B MoE with 15B active, has tool calling and publishes no medical benchmarks. [MiMo-V2.6-Flash-RL](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Flash-RL)
- Other recent open releases that are relevant but publish no medical benchmarks: DeepSeek-V4.1-Flash (2026-09-10, MIT, 552B MoE, on Baseten Model APIs) [card](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash), [Baseten library](https://www.baseten.co/library/); Qwen3.8-27B (Aug 2026, Apache 2.0) [card](https://huggingface.co/Qwen/Qwen3.8-27B).
- The medical models created on HF today are community fine-tunes and ONNX conversions, for example OpenMed MedPsy ONNX. None is a notable new base model. [HF API search "med", newest first](https://huggingface.co/api/models?search=med&sort=createdAt&direction=-1)
- **Open item:** if the user has specific models from today in mind, get their names. Gated or private repos may not appear in the HF listings.

## TL;DR recommendations

| # | Capability | Pick | Runner-up | Notes |
|---|---|---|---|---|
| 1 | Patient briefing with citations | **Gemma 4 31B-it** | MedGemma 1.5 4B | Gemma 4 has native JSON output and tool calling, which suit citation IDs, plus 256K context. MedGemma 1.5 4B scores EHRQA 89.6 but has no documented structured output. |
| 2 | SOAP note from transcript | **Gemma 4 31B-it** | gpt-oss-120b | No open note-generation benchmark exists, so evaluate on synthetic Malaysian transcripts. Gemma 4 is trained on 140+ languages; Malay is not listed separately. |
| 3 | Differential with evidence and gaps | **Gemma 4 31B-it** | gpt-oss-120b | Gemma 4 31B scores MedXpertQA MM 61.3%. gpt-oss-120b scores HealthBench 57.6 and is already a Baseten Model API, so it needs no deployment of its own. |
| 4 | Chest X-ray findings and localisation | **MedGemma 1.5 4B** | CheXagent-2-3b (MIT) | MedGemma 1.5 has a CXR bounding-box IoU of 38.0 and MIMIC-CXR RadGraph F1 of 27.2. It is the only candidate with published localisation numbers and a licence that allows commercial use. |
| 5 | Drug checks and prescribing via tools | **Gemma 4 31B-it** | gpt-oss-120b | Both have native function calling and structured output. The model extracts and calls tools; the data lives in the drug dataset. |

**Two deployments cover everything:** Gemma 4 31B-it for routing and capabilities 1, 2, 3 and 5, and MedGemma 1.5 4B for capability 4, with 1 as a fallback. This matches the PRD's current pair. The only change is a firm size choice for Gemma 4: 31B, or 26B-A4B if cost or latency matters more. Google itself describes MedGemma as a tool inside an agent, with a different model handling function calling. [MedGemma page](https://developers.google.com/health-ai-developer-foundations/medgemma)

If evaluation shows gaps in reasoning, call **gpt-oss-120b through Baseten's Model API** instead of adding a third dedicated deployment. [Baseten gpt-oss-120b](https://www.baseten.co/library/gpt-oss-120b/)

## Candidate facts

| Model | Released | Size | Licence | Input | Context | Tool calling | Runtimes | On Baseten |
|---|---|---|---|---|---|---|---|---|
| MedGemma 1.5 4B-it | 2026-01-13 | 4B | HAI-DEF terms | text + image (CXR, CT/MRI, pathology) | ≥128K in, 8K out | Not documented | vLLM (card) | No library entry; deploy as a custom vLLM model **(unverified that it works out of the box)** |
| MedGemma 27B text-it | 2025-05-20 | 27B | HAI-DEF terms | text | ≥128K | Not documented | vLLM | No library entry |
| Gemma 4 31B-it | 2026-04-02 | 31B dense (26B-A4B MoE, 12B, E4B, E2B also exist) | Apache 2.0 | text + image; audio only on E2B/E4B/12B | 256K (31B/26B), 128K (small) | Native | vLLM, SGLang | Yes: presets for every size, tool calling and reasoning parser on, 31B on 2×H100 or RTX-PRO-6000 |
| gpt-oss-120b | 2025-08 | 117B MoE, 5.1B active | Apache 2.0 | text | 128K **(unverified here)** | Native, plus structured outputs | vLLM, SGLang | Yes: Model API at $0.10/$0.50 per 1M input/output tokens, or dedicated H100 |
| Baichuan-M2-32B | 2025-09 | 32B (Qwen2.5 base) | Apache 2.0 | text | not stated | Not documented | vLLM, SGLang | No |
| Baichuan-M3-235B | 2026-01/02 | 235B MoE (Qwen3-235B-A22B base) | Apache 2.0 | text | not stated | Not documented | vLLM, SGLang | No |
| Hulu-Med-Flash-Preview-27B | 2026-04-01 (preview) | ~30B (Qwen3.5 base) | Apache 2.0 | text, 2D/3D images, video | not stated | Not documented | vLLM, SGLang | No |
| CheXOne | 2026-04-01 | 4B (Qwen2.5-VL-3B base) | **CC BY-NC 4.0** | CXR + text | — | No | — | No |
| CheXagent-2-3b | 2024-04 | 3B | MIT | CXR + text | — | No | vLLM, SGLang (HF widget) | No |
| MAIRA-2 | 2024-06 | 7B | **MSRLA, research only** | CXR + text | — | No | — | No |

Sources: [MedGemma 1.5 HF card](https://huggingface.co/google/medgemma-1.5-4b-it), [MedGemma model card](https://developers.google.com/health-ai-developer-foundations/medgemma/model-card), [MedGemma 27B text card](https://huggingface.co/google/medgemma-27b-text-it), [Gemma 4 blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/), [Gemma 4 31B card](https://huggingface.co/google/gemma-4-31B-it), [Baseten Gemma 4](https://docs.baseten.co/examples/models/llm/gemma-4), [gpt-oss-120b card](https://huggingface.co/openai/gpt-oss-120b), [Baichuan-M2](https://huggingface.co/baichuan-inc/Baichuan-M2-32B), [Baichuan-M3](https://huggingface.co/baichuan-inc/Baichuan-M3-235B), [Hulu-Med-Flash](https://huggingface.co/ZJU-AI4H/Hulu-Med-Flash-Preview-27B), [CheXOne](https://huggingface.co/StanfordAIMI/CheXOne), [CheXagent-2-3b](https://huggingface.co/StanfordAIMI/CheXagent-2-3b), [MAIRA-2](https://huggingface.co/microsoft/maira-2).

### What the licences mean for Sona

- **HAI-DEF terms (MedGemma):** commercial use and hosted-service distribution are allowed. You must pass the terms on to users and include a notice file. Diagnostic or treatment use needs regulatory authorisation before distribution, and the Prohibited Use Policy applies. A demo on synthetic data fits these terms, but a hospital pilot would trigger the regulatory clause. [HAI-DEF terms](https://developers.google.com/health-ai-developer-foundations/terms)
- **Apache 2.0 or MIT (Gemma 4, gpt-oss, Baichuan, Hulu-Med, CheXagent):** no restrictions that matter for Sona.
- **CheXOne (CC BY-NC) and MAIRA-2 (research only):** acceptable for a non-commercial competition. They conflict with the PRD's proposed per-clinician pricing, so do not build on them.

## Findings by capability

### 1. Patient briefing and timeline

- MedGemma 1.5 4B: EHRQA 89.6 (MedGemma 1 27B: 90.5; Gemma 3 4B: 70.9) and EHRNoteQA 80.4. This is the best records score at 4B. [model card](https://developers.google.com/health-ai-developer-foundations/medgemma/model-card)
- Gemma 4 31B: no published EHR benchmark. It does have native structured JSON output and 256K context. [Gemma 4 blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/)
- Citations are an output-format problem more than a knowledge problem. Pass the source records with IDs and require a JSON schema of `{claim, source_ids[]}`. Gemma 4 supports this natively. MedGemma does not document it, and Google warns that MedGemma "has not been evaluated or optimized for multi-turn applications". [HF card](https://huggingface.co/google/medgemma-1.5-4b-it)
- **Pick Gemma 4 31B, with MedGemma 1.5 4B as runner-up.** Run both against 10–20 synthetic records and check how many cited sources are correct.

### 2. Clinical note from a transcript

- No open model publishes a SOAP-note benchmark. Choose on instruction following, long context and structured output.
- Gemma 4 has 256K context, JSON output and training on 140+ languages. Malay is not named in the 31B card, so code-switching quality is **unverified**. [Gemma 4 blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/), [E4B card](https://huggingface.co/google/gemma-4-E4B-it)
- gpt-oss-120b has structured outputs and scores HealthBench 57.6. [gpt-oss model card PDF, Table 3](https://cdn.openai.com/pdf/419b6906-9da6-406c-a19d-1bb078ac7637/oai_gpt-oss_model_card.pdf)
- **Pick Gemma 4 31B, with gpt-oss-120b as runner-up.** The PRD's rule stands: the scribe must not invent prescribing decisions. Enforce it in the schema and the prompt, not through model choice.

### 3. Clinical reasoning: differentials with evidence and gaps

| Model | MedQA | MedXpertQA | HealthBench (Hard) | Source |
|---|---|---|---|---|
| Gemma 4 31B-it | — | MM 61.3% | — | [card](https://huggingface.co/google/gemma-4-31B-it) |
| Gemma 4 26B-A4B | — | MM 58.1% | — | [card](https://huggingface.co/google/gemma-4-31B-it) |
| MedGemma 27B text | 87.7 (0-shot) | text 26.7 | — | [card](https://huggingface.co/google/medgemma-27b-text-it) |
| MedGemma 1.5 4B | 69.1 | text 16.4 | — | [model card](https://developers.google.com/health-ai-developer-foundations/medgemma/model-card) |
| gpt-oss-120b (high) | — | — | 57.6 (30.0) | [model card PDF](https://cdn.openai.com/pdf/419b6906-9da6-406c-a19d-1bb078ac7637/oai_gpt-oss_model_card.pdf) |
| gpt-oss-20b (high) | — | — | 42.5 (10.8) | same |
| Baichuan-M2-32B | — | — | 60.1 (34.7) | [card](https://huggingface.co/baichuan-inc/Baichuan-M2-32B) |
| Baichuan-M3-235B | — | — | 65.1 (44.4) **(the 65.1 figure comes from search-result summaries of [arXiv 2602.06570](https://arxiv.org/pdf/2602.06570) and is unverified; the HF card states only "ranks first")** | [card](https://huggingface.co/baichuan-inc/Baichuan-M3-235B) |
| Hulu-Med-Flash-Preview-27B | — | — | 64.5 (43.7) | [card](https://huggingface.co/ZJU-AI4H/Hulu-Med-Flash-Preview-27B) |

- MedXpertQA MM and MedXpertQA text are different subsets, so the Gemma 4 and MedGemma figures cannot be compared directly.
- Among the models Sona would realistically deploy, Gemma 4 31B has the strongest hard-medical score on its own card and the best tooling support.
- The medical-specialist models (Baichuan, Hulu-Med) lead on HealthBench but document no tool calling and have no Baseten preset. That means an extra custom deployment.
- **Pick Gemma 4 31B, with gpt-oss-120b (Baseten Model API) as runner-up.** Retrieval and citations should come from the patient record and the chosen clinical references, not from what the model remembers.

### 4. Chest X-ray interpretation

| Model | MIMIC-CXR RadGraph F1 | CXR 5-condition macro F1 | Localisation (Chest ImaGenome IoU) | Source |
|---|---|---|---|---|
| MedGemma 1.5 4B | 27.2 | 89.5 | **38.0** | [model card](https://developers.google.com/health-ai-developer-foundations/medgemma/model-card) |
| MedGemma 1 4B | 30.3 (tuned) | 88.9 | 3.1 | same |
| MedGemma 1 27B | 27.0 | 90.0 | 16.0 | same |
| Lingshu-32B (MIT) | ROUGE-L 28.8, CIDEr 96.4 (not RadGraph) | — | — | [card](https://huggingface.co/lingshu-medical-mllm/Lingshu-32B) |
| CheXOne (NC) | Not on card; paper says drafts matched or beat residents in 55% of cases | — | Grounding supported | [arXiv 2604.00493](https://arxiv.org/abs/2604.00493) |
| MAIRA-2 (research only) | Paper claims state of the art; no numbers on the card | — | Grounded reports | [arXiv 2406.04449](https://arxiv.org/abs/2406.04449) |
| CheXagent-2-3b (MIT) | No numbers on the card | — | — | [card](https://huggingface.co/StanfordAIMI/CheXagent-2-3b) |

- MedGemma 1.5 4B is the only model here with a published bounding-box score and a licence that allows commercial use. Its IoU of 38.0 is modest, so present boxes as approximate regions, not exact boundaries. It also supports longitudinal CXR comparison. [arXiv 2604.05081](https://arxiv.org/abs/2604.05081)
- StanfordAIMI `chexanatomy-paligemma-3b/10b` (June 2026, Gemma licence) outputs anatomy boxes and segmentation. It is research-oriented and has no benchmark numbers on its card. [card](https://huggingface.co/StanfordAIMI/chexanatomy-paligemma-3b-224)
- **Pick MedGemma 1.5 4B, with CheXagent-2-3b as runner-up.** Gemma 4 accepts images but publishes no CXR results; use it only as a last-resort fallback.

### 5. Medication checks and synthetic prescribing

- The model's job here is to pull out drug names and doses and call tools over the bounded dataset. It needs reliable function calling and schema-valid JSON. Gemma 4 has both natively, and Baseten's preset enables tool calling. [Baseten Gemma 4](https://docs.baseten.co/examples/models/llm/gemma-4). gpt-oss-120b has both too. [card](https://huggingface.co/openai/gpt-oss-120b)
- MedGemma documents no tool calling. Google suggests pairing it with a separate function-calling model. [MedGemma page](https://developers.google.com/health-ai-developer-foundations/medgemma)
- **Pick Gemma 4 31B, with gpt-oss-120b as runner-up.** Drug-name normalisation and interaction lookup should be deterministic code, not model output.

## Drug data sources

| Source | What it gives | Licence and access | OK for a prototype? |
|---|---|---|---|
| **MOH Malaysia Drug Formulary (FUKKM / MOHMF)** | ~1,700 entries (57 pages × 30) with generic name, MDC code, category (A*/A/B/C+), indications, restrictions and dosage | Web portal and MyFormulary app. No bulk download found. "Copyright © 1999–2026 … All Rights Reserved". Contact: cpfor@moh.gov.my. [portal](https://pharmacy.moh.gov.my/en/apps/fukkm), [MOHMF page](https://pharmacy.moh.gov.my/en/documents/ministry-health-medicines-formulary-mohmf.html), [FUKKM guideline 4th ed. 2025](https://pharmacy.moh.gov.my/en/documents/guideline-ministry-health-malaysia-drug-formulary-fukkm-fourth-edition-2025.html) | For local relevance, hand-copy a small cited subset of 10–30 drugs. **Redistribution rights are unclear:** ask the secretariat before publishing |
| **NPRA QUEST3+ product search** | Malaysian registered products, registration number, holder, active ingredient | Search only. No stated export or reuse terms. [QUEST3+](https://quest3plus.bpfk.gov.my/pmo2/index.php) | Use for reference and citation only |
| **openFDA drug label API** | US label sections including `drug_interactions`, `contraindications`, `dosage_and_administration`, `boxed_warning` | CC0 / public domain. 240 req/min; 1,000/day without a key, 120,000/day with one. [license](https://open.fda.gov/license/), [fields](https://open.fda.gov/apis/drug/label/searchable-fields/), [auth](https://open.fda.gov/apis/authentication/) | **Yes. This is the best cited source for interaction text.** Snapshot it; do not call it live |
| **DailyMed** | Same SPL labels as zip or JSON, with RxCUI mappings | NLM REST API v2. No explicit licence on the services page. [web services](https://dailymed.nlm.nih.gov/dailymed/app-support-web-services.cfm) | Yes, as an alternative to openFDA |
| **RxNorm Current Prescribable Content** | Normalised drug names and RxCUIs | "Without any licensing restrictions", no UMLS login needed. The full RxNorm needs a free UMLS licence. [CPC](https://www.nlm.nih.gov/research/umls/rxnorm/docs/prescribe.html), [ToS](https://www.nlm.nih.gov/research/umls/rxnorm/docs/termsofservice.html) | Yes, for name normalisation. US-centric, so map Malaysian generics by hand |
| **RxNav Drug Interaction API** | Was: ONCHigh + DrugBank interactions | **Discontinued around 2024-01-02** **(secondary)**. [DrugBank blog](https://blog.drugbank.com/nih-discontinues-their-drug-interaction-api/) | No |
| **DDInter 2.0** | 302,516 interactions across 2,290 drugs, with risk levels and management advice. CSV download by ATC code | **CC BY-NC-SA 4.0.** [site](https://ddinter2.scbdd.com/), [download](https://ddinter2.scbdd.com/download/), [terms](https://ddinter2.scbdd.com/terms/), [NAR 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC11701621/) | For the competition, yes (non-commercial, attribution). Not for a paid pilot |
| **DrugBank** | Full interaction data | Academic downloads are **paused**. Most datasets are CC BY-NC 4.0, commercial use needs a paid licence, and only Vocabulary and Structures are CC0. [releases](https://go.drugbank.com/releases/latest) | Only the CC0 vocabulary is usable, for ID cross-reference |

**Suggested dataset:** a hand-curated JSON of 10–30 drugs in scope for the demo.
- Each drug gets its FUKKM category and dosing, with a link to the FUKKM page.
- Each interaction pair uses openFDA label text as the primary citation. DDInter severity can be added as a secondary attribute during the competition phase.
- Version the snapshot so each prescription can record which data version it used, as the PRD requires.

## Open questions

1. Which models does the user mean by "dropped today"? None of the vendor HF listings checked shows a notable medical release on 2026-09-24.
2. Does MedGemma 1.5 4B run on Baseten's stock vLLM image without changes? Custom deployment needs testing. There is no library preset.
3. How well does Gemma 4 handle Malay/English code-switching in transcripts? Malay is not listed explicitly.
4. Gemma 4 31B (2×H100) or 26B-A4B for the routing tier? Decide after measuring latency on the demo script.
5. Can FUKKM content be redistributed? Email cpfor@moh.gov.my.
6. Do the competition rules count a pitch with a pricing model as commercial use? This decides whether CheXOne and DDInter are acceptable.
7. The HealthBench figures for Baichuan-M3 and Hulu-Med are self-reported and were not independently checked.

## Sources

- MedGemma: [HF 1.5 4B](https://huggingface.co/google/medgemma-1.5-4b-it) · [model card](https://developers.google.com/health-ai-developer-foundations/medgemma/model-card) · [HAI-DEF page](https://developers.google.com/health-ai-developer-foundations/medgemma) · [HAI-DEF terms](https://developers.google.com/health-ai-developer-foundations/terms) · [27B text](https://huggingface.co/google/medgemma-27b-text-it) · [collection](https://huggingface.co/collections/google/medgemma-release) · [1.5 tech report](https://arxiv.org/abs/2604.05081) · [GitHub](https://github.com/Google-Health/medgemma)
- Gemma 4: [blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/) · [31B card](https://huggingface.co/google/gemma-4-31B-it) · [E4B card](https://huggingface.co/google/gemma-4-E4B-it) · [Baseten docs](https://docs.baseten.co/examples/models/llm/gemma-4)
- gpt-oss: [HF card](https://huggingface.co/openai/gpt-oss-120b) · [model card PDF](https://cdn.openai.com/pdf/419b6906-9da6-406c-a19d-1bb078ac7637/oai_gpt-oss_model_card.pdf) · [Baseten](https://www.baseten.co/library/gpt-oss-120b/)
- Medical LLMs: [Baichuan-M2](https://huggingface.co/baichuan-inc/Baichuan-M2-32B) · [Baichuan-M3](https://huggingface.co/baichuan-inc/Baichuan-M3-235B) · [Hulu-Med-Flash](https://huggingface.co/ZJU-AI4H/Hulu-Med-Flash-Preview-27B) · [Lingshu-32B](https://huggingface.co/lingshu-medical-mllm/Lingshu-32B)
- CXR: [CheXOne](https://huggingface.co/StanfordAIMI/CheXOne) · [CheXOne paper](https://arxiv.org/abs/2604.00493) · [CheXagent-2-3b](https://huggingface.co/StanfordAIMI/CheXagent-2-3b) · [MAIRA-2](https://huggingface.co/microsoft/maira-2) · [MAIRA-2 paper](https://arxiv.org/abs/2406.04449) · [CheXanatomy](https://huggingface.co/StanfordAIMI/chexanatomy-paligemma-3b-224)
- Recent releases: [MiMo-V2.6-Flash](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Flash-RL) · [DeepSeek-V4.1-Flash](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash) · [Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B) · [Baseten library](https://www.baseten.co/library/) · [llm-stats (secondary)](https://llm-stats.com/ai-news)
- Drug data: listed in the drug data sources table above.

## Addendum: OpenMed and OpenEvidence (checked 2026-09-25)

- **OpenMed** is an open-source set of small medical **extraction** models, not LLMs. It covers clinical named-entity recognition (diseases, drugs, anatomy, genes) and PII de-identification.
  - Scale: 2,200+ models, 109M–434M parameters. SDK v2.5.0 is Apache-2.0, but "model and dataset terms vary", so check each model card.
  - Runtimes: Python (CPU/CUDA), MLX, ONNX Runtime Mobile, Transformers.js and REST.
  - Languages: PII models cover 35 languages, including Chinese. Malay national IDs are handled by a validator, not a model.
  - Sources: https://github.com/maziyarpanahi/openmed, https://huggingface.co/blog/MaziyarPanahi/openmed-year-in-review-2025
- **OpenEvidence** is a closed, commercial clinical search product for literature-grounded answers. It is not open-weight.
  - Access: free to verified **US** physicians, funded by advertising. It has content licensing with NEJM, JAMA, NCCN and the AMA.
  - No public developer API is documented. The claim that none exists comes from a competitor's blog, so treat it as **unverified**. Enterprise EHR integrations are built per institution.
  - Role for Sona: a benchmark for the reasoning-with-evidence experience and a positioning reference, not a component.
  - Sources: https://en.wikipedia.org/wiki/OpenEvidence, https://evidencemd.ai/blogs/openevidence-api

# Orchestrator model choice (open-weight)

Researched 2026-09-24. Every claim links to a source in [Sources](#sources). Claims I couldn't confirm from a primary source are marked **(unverified)**.

## Question

Which open-weight, self-hostable model should be Sona's orchestrator? It has to:

- route each clinician message to one of seven capabilities
- call backend tools with strict JSON arguments
- stream a json-render UI spec quickly enough for a live demo
- handle mixed English, Malay and Mandarin
- run on Baseten

Related questions: should routing and reasoning be split across two models, and can the orchestrator model also handle the medical tasks?

## TL;DR

**Pick: Gemma 4 26B A4B-it.** **Runner-up: Qwen3.6-35B-A3B.** Use a single model, not a separate router plus reasoner. Add MedGemma only for the chest X-ray capability.

| Model | Released | Params (total / active) | License | Context | Tool-use score (vendor-reported) | Malay / Mandarin evidence | Baseten |
|---|---|---|---|---|---|---|---|
| **Gemma 4 26B A4B-it** (pick) | 2026-03-31 [1] | 25.2B / 3.8B MoE [2] | Apache 2.0 | 256K | Tau2 68.2% [2] | Gemma 4 31B is #1 overall on SEA-HELM [9]; MMMLU 86.3% [2] | Library + vLLM config doc, H100 ×2 [10][11] |
| Gemma 4 31B-it (fallback if 26B misses) | 2026-03-31 [1] | 30.7B dense [2] | Apache 2.0 | 256K | Tau2 76.9% [2] | SEA-HELM #1 overall [9]; MMMLU 88.4% [2] | Library [10][11] |
| **Qwen3.6-35B-A3B** (runner-up) | 2026-04 [4] | 35B / 3B MoE [4] | Apache 2.0 | 262K | TAU3 67.2 vs Gemma4-26BA4B 59.0; MCP-Atlas 62.8 vs 50.0 (Qwen's own table) [4] | Qwen3.6 27B is #3 on SEA-HELM [9]; the 3.5 base covers 201 languages [5] | Qwen3.5-35B-A3B listed; 3.6 **(unverified)** [12] |
| Qwen3.5-35B-A3B | 2026-02 [4] | 35B / 3B MoE [5] | Apache 2.0 | 262K | BFCL-V4 67.3, TAU2 81.2 [5] | MMMLU 85.2, INCLUDE 79.7 [5] | Library [12] |
| gpt-oss-120b | 2025-08 [8] | 117B / 5.1B MoE [8] | Apache 2.0 | 131K | Tau-Bench Retail 67.8% [7] | MMMLU 81.3% avg [7]; SEA-HELM #6 [9] | Model APIs (pay per token) [13] |

Tool-use scores come from different harnesses and benchmark versions (Tau2, TAU3, Tau-Bench), so compare them only within a single row or a single vendor's table. The official BFCL leaderboard was last updated 2026-04-12 and has no entries for Gemma 4, Qwen3.5 or later, or gpt-oss [14]. No independent, like-for-like tool-calling ranking of these models exists.

## Findings

### 1. Nothing open-weight dropped today (2026-09-24), as far as I could verify

- I sorted the Hugging Face model API by creation date (about 1,000 most recent repos, up to ~11:30 UTC today). No major-lab LLM was created today [15].
- Release trackers show no open-weight LLM on 2026-09-24 [16][17].
- The 2026-09-22 launches were all closed-weight: GPT-6 Luna/Sol and Claude Opus 5.5 [16].
- **Ask the user which "today" model they mean.** It may be a closed model, or an announcement whose weights aren't on Hugging Face yet.

Open-weight releases this month that are relevant here:

| Model | Date | Size | License | Fit for Sona |
|---|---|---|---|---|
| Xiaomi MiMo-V2.6 Flash / Pro / Distill-Qwen-9B | 2026-09-21 [18][19] | Flash is 309B / 15B active [19] | MIT | Too big for a router. The cards publish no Tau2 or BFCL scores [18]. |
| AI Singapore Nemotron-SEA-LION-v4.8, 30B-A3B and 120B-A12B | Sep 2026 [20] | Nemotron 3 Nano base, 262K context | MIT | Native Malay, but **no Chinese**. Tool calling isn't documented, and the card says the model is "not aligned for safety" [20]. Useful only as a Malay-quality reference. |
| DeepSeek-V4.1-Flash | 2026-09-10 [21] | 552B / 8B (prefill) to 16B (decode) active | MIT | Large memory footprint. No Tau2 or BFCL on the card. Available on Baseten Model APIs [13][21]. |
| Xing4.0-29B-A4B (China Telecom) | 2026-09-16 [15] | 29B / 4B | Apache 2.0 | Tau3 64.63 (self-reported) [22]. New and unproven. |
| GLM-5.3-Flash | weights 2026-08-26 [23] | 320B / 18B | MIT | Strong at agentic work but large. On Baseten Model APIs [13]. |

### 2. Why Gemma 4 26B A4B

- **Speed.** With 3.8B active parameters it decodes like a ~4B model [2]. Baseten's config runs it with EAGLE-3 speculative decoding and prefix caching, which suits a long, fixed system prompt holding the json-render catalogue [11]. Google has also shipped MTP drafters for the 26B A4B [1].
- **Tool calling and JSON.** Tool use and JSON-Schema structured output are native [2][3]. vLLM has dedicated `--tool-call-parser gemma4` and `--reasoning-parser gemma4` flags [11][24].
  - Caveat: under constrained decoding the model does not see schema field descriptions, so the output instructions have to go in the system prompt [24].
- **Languages.** Out-of-the-box support for 35+ languages, pre-trained on 140+ [2]. On SEA-HELM, updated 2026-09-18, Gemma 4 31B ranks first overall among 75 open models, ahead of Qwen3.5-122B and Qwen3.6-27B [9]. I found no per-language Malay score for the 26B A4B **(unverified)**.
- **Fit with the PRD.** It is the PRD's candidate model, it is Apache 2.0, and Baseten publishes a ready vLLM config for it [11].
- **Weak spot.** Tool-use scores are lower than Qwen's: 68.2 Tau2 [2], and 59.0 on TAU3 when Qwen ran the test itself [4]. If the routing and tool-argument eval fails, move up to Gemma 4 31B (Tau2 76.9) [2] or switch to Qwen3.6-35B-A3B.

### 3. Why Qwen3.6-35B-A3B is the runner-up

- It scores best on agentic benchmarks at the same ~3B-active cost: TAU3 67.2, MCP-Atlas 62.8, Tool Decathlon 26.9 [4].
- Mandarin should be its strength, since it comes from a Chinese lab, but I found no primary Mandarin or Malay score for 3.6 **(unverified)**.
- Thinking mode is on by default. Turn it off for routing to keep the first token fast (`enable_thinking: False`) [4].
- The vLLM tool parser is `qwen3_coder` [4]. With reasoning enabled, structured output can silently stop working unless the server is started with `--structured-outputs-config.enable_in_reasoning=True` [24].
- Baseten's library lists Qwen3.5-35B-A3B [12]. I couldn't confirm a listing for 3.6.

### 4. Structured output in vLLM and SGLang

- **vLLM** supports xgrammar, guidance, outlines and lm-format-enforcer, with `auto` backend selection, and accepts `response_format: json_schema` [24].
- **vLLM tool calls:**
  - `tool_choice: "required"` or a named function uses constrained decoding, which guarantees parseable arguments (not necessarily correct ones) [25].
  - `auto` tool choice parses tool calls out of free text, so arguments can come back malformed unless strict mode is on (`strict: true` on a tool) [25].
  - The first call with a new schema adds "several seconds" of grammar compile time [25]. Warm the grammar before going on stage.
- **SGLang** uses xgrammar by default and supports JSON schema, regex and EBNF [26].
- **Suggested design:** make the orchestrator's first output a small constrained JSON object, `{capability, tool_args}`, then stream the UI spec under its own schema. Every candidate here works with this through vLLM.

### 5. One model or a router plus a reasoner?

**Use one model.**

- The 26B A4B already runs with only ~4B active parameters [2], so a smaller router would barely speed up the first token. It would add a network hop and a second deployment to keep warm.
- Choosing one of seven capabilities under constrained decoding is an easy classification task. The hard parts are tool arguments and UI-spec quality, and those need the larger model anyway.
- If a bigger reasoner is ever needed, for example deep clinical reasoning, call it as a *tool*: Gemma 4 31B, or a pay-per-token Baseten model such as DeepSeek-V4.1-Flash or GLM-5.3 [13]. That avoids a routing layer in front of everything.

### 6. Can the same model handle the medical capabilities?

- **Briefing, scribe/note, clinical reasoning, follow-up tasks, synthetic prescribing:** yes, with Gemma 4 on its own, grounded by tools. Gemma 4 26B A4B scores 58.1% on MedXPertQA MM (31B: 61.3%) [2]. Medication interactions should come from a deterministic lookup tool, not from model recall. That is a design principle, not a sourced claim.
- **Chest X-ray:** add **MedGemma 1.5 4B-it**. It reports MIMIC-CXR macro-F1 89.5 on the top 5 conditions, CheXpert 48.2, and RadGraph F1 27.2 for report generation [27].
  - It is built on Gemma 3, not 4 [27][28], and ships under the **Health AI Developer Foundations terms, not Apache**. Check whether the competition's "open-weight" rule accepts that.
  - No Gemma 4-based MedGemma has been announced [29].
- **Net result: two deployments.** Gemma 4 26B A4B does orchestration, tools, UI and text-side medicine. MedGemma 1.5 4B handles chest X-ray.

## Open questions

1. Which model does the user mean by "dropped today"? None was verifiable on Hugging Face or in the trackers for 2026-09-24.
2. I found no primary benchmark for code-mixed English, Malay and Mandarin input for any candidate. Build a ~50-prompt routing and tool-argument eval (mixed-language messages → expected capability plus expected args) and run it against Gemma 4 26B A4B, Gemma 4 31B and Qwen3.6-35B-A3B before committing.
3. The Baseten Model APIs pricing page doesn't list Gemma 4 [13], while its library page shows a "Model API" tab [10]. Confirm with Baseten whether Gemma 4 is pay-per-token or dedicated-only. The docs describe a dedicated deployment on H100 ×2 [11].
4. Does the competition accept MedGemma's HAI-DEF terms as "open-weight"?
5. I found no published first-token latency for Gemma 4 on Baseten. One data point from a similar ~3B-active hybrid MoE: the SEA-LION 30B-A3B FP8 card reports 35 ms TTFT and ~365 tok/s on one H200 [20]. Measure Gemma 4 directly.

## Sources

1. Gemma releases (dates for 4, MTP, 12B, MedGemma 1.5) — https://ai.google.dev/gemma/docs/releases
2. Gemma 4 26B A4B-it model card (params, benchmark table, languages, license) — https://huggingface.co/google/gemma-4-26B-A4B-it ; also https://ai.google.dev/gemma/docs/core/model_card_4
3. Gemma 4 function calling guide — https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4
4. Qwen3.6-35B-A3B model card (params, TAU3/MCP table vs Gemma 4, parsers, thinking default) — https://huggingface.co/Qwen/Qwen3.6-35B-A3B
5. Qwen3.5-35B-A3B model card (BFCL-V4, TAU2, multilingual, medical VQA, 201 languages) — https://huggingface.co/Qwen/Qwen3.5-35B-A3B
6. Qwen3.8 repo (27B and 2.4T-A95B only, Aug 2026) — https://github.com/QwenLM/Qwen3.8
7. gpt-oss model card paper (Tau-Bench Retail, MMMLU, HealthBench, context) — https://arxiv.org/html/2508.10925
8. gpt-oss-120b Hugging Face card (117B / 5.1B, harmony format) — https://huggingface.co/openai/gpt-oss-120b
9. SEA-HELM leaderboard (updated 2026-09-18) — https://leaderboard.sea-lion.ai/
10. Baseten library: Gemma 4 26B A4B — https://www.baseten.co/library/gemma-4-26b-a4b-it/
11. Baseten docs: Gemma 4 deployment (GPUs, vLLM flags, EAGLE-3) — https://docs.baseten.co/examples/models/llm/gemma-4
12. Baseten model library (Qwen3.5 35B-A3B, DeepSeek, GLM, Kimi) — https://www.baseten.co/library/
13. Baseten Model APIs (pay-per-token list) — https://www.baseten.co/products/model-apis/
14. BFCL V4 leaderboard (last updated 2026-04-12) and data — https://gorilla.cs.berkeley.edu/leaderboard.html , https://gorilla.cs.berkeley.edu/data_overall.csv
15. Hugging Face models API, sorted by creation date and trending — https://huggingface.co/api/models?sort=createdAt&direction=-1&limit=1000
16. llm-stats release tracker — https://llm-stats.com/llm-updates ; PromptZone timeline — https://www.promptzone.com/ai-model-releases
17. LLM Releases tracker — https://www.llm-releases.com/
18. Xiaomi MiMo-V2.6 announcement — https://mimo.mi.com/docs/en-US/news/latest/v2-6
19. MiMo-V2.6-Flash-RL card (309B / 15B, MIT) — https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Flash-RL
20. Nemotron-SEA-LION-v4.8-30B-A3B cards (languages, license, safety note; FP8 TTFT) — https://huggingface.co/aisingapore/Nemotron-SEA-LION-v4.8-30B-A3B , https://huggingface.co/aisingapore/Nemotron-SEA-LION-v4.8-30B-A3B-FP8
21. DeepSeek-V4.1-Flash card — https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash
22. Xing4.0-29B-A4B card — https://huggingface.co/XingChen-AGI/Xing4.0-29B-A4B
23. GLM-5.3-Flash card — https://huggingface.co/zai-org/GLM-5.3-Flash
24. vLLM structured outputs — https://docs.vllm.ai/en/latest/features/structured_outputs.html ; vLLM Gemma 4 recipe — https://docs.vllm.ai/projects/recipes/en/latest/Google/Gemma4.html
25. vLLM tool calling — https://docs.vllm.ai/en/latest/features/tool_calling.html
26. SGLang structured outputs — https://docs.sglang.io/advanced_features/structured_outputs.html
27. MedGemma 1.5 4B-it card — https://huggingface.co/google/medgemma-1.5-4b-it
28. MedGemma overview (Gemma 3 base, HAI-DEF terms) — https://developers.google.com/health-ai-developer-foundations/medgemma
29. "MedGemma based on Gemma 4?" discussion — https://github.com/google-deepmind/gemma/discussions/630

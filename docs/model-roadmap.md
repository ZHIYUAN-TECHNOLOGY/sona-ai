# Note-model roadmap (July 2026)

Current shipped model: **Qwen3-1.7B** (bundled `QWEN3_1_7B_QUANTIZED`, device-proven).
Runtime: react-native-executorch 0.9.x — ExecuTorch `.pte`, XNNPACK, 8da4w 4-bit.
Constraints: ≤4B params (~3GB @4-bit), classic transformer attention (hybrid linear
attention is NOT quantizable yet), English + Malay + Chinese, STRICT-format extraction
(reasoning-RL models repeatedly fail this).

## The two rules (learned the hard way)

1. **Trial before swap** — Mac harness (`scratchpad note-eval/`) on the exact app
   prompts. Benchmarks/brand never decide.
2. **Mac bf16 pass is NOT enough** — the device-quantized runtime must pass the same
   eval. Qwen3-4B won on Mac (90.9%/0 inventions) then degraded catastrophically on
   device (spaceless text, invented `48.2°C` vital) and was reverted same day.

## Ranked candidates (research: Jul 14 2026)

| # | Model | Size / RAM@4bit | License | Status |
|---|---|---|---|---|
| 1 | ~~Gemma-SEA-LION-v4-4B~~ | 4B / ~2.6GB | Gemma | **TRIALED Jul 14, LOST**: 82.2% recall vs Qwen3-1.7B's 93.5% on identical cases (both 0 inventions, 6/6 format). Drops stated facts — missed NSAID allergy, FBC order, review intervals. Malay pretraining didn't translate to extraction completeness. Results: `tools/note-eval/out_sealion.json`. |
| 2 | **Ministral-3-3B-Instruct-2512** | 3B / ~2.1GB | Apache 2.0 | Dark horse. Instruct kept separate from reasoning ckpt. Malay UNLISTED — gate on Malay trial. |
| 3 | **Qwen3-4B-Instruct-2507** | 4B / ~2.7GB | Apache 2.0 | Our best Mac score (92.8% recall / 0 inventions). Needs own export + hosting + device eval. |
| 4 | Gemma 4 E4B-it | ~4.5B eff | Apache 2.0 | BLOCKED: RN-executorch #1062 (per-layer embeddings) — lands v0.10. |
| 5 | MedGemma-1.5-4B-it | 4B / ~2.6GB | HAI-DEF | Only medical ≤4B. License obligations, mediocre Malay. |
| 6 | Granite-4.0-Micro 3B | 3B | Apache 2.0 | No Malay. |
| 7 | Qwen3.5-4B | 4B | Apache 2.0 | BLOCKED: DeltaNet attention, ExecuTorch export fp32-only. Best on paper (IFEval 89.8, 201 langs) — presumptive winner when unblocked. Watch `pytorch/executorch examples/models/qwen3_5`. |

## Rejected (with reasons — do not re-litigate)

- **Qwen3-4B (bundled 8da4w)** — device output degraded + intermittent jetsam (Jul 14).
- **Qwen3.5-2B** — 51% recall, invented amoxicillin for penicillin-allergic case; also DeltaNet-blocked. Re-trialed Jul 15 (transformers 5.13.1, `tools/note-eval/out_q35_2b_retrial.json`): 36.7% recall, invented "antibiotic"+"steroid", format 3/6 — third independent failure (Mac old, Mac new, device screenshot #149). Shipped briefly as a user-insisted override (Jul 15 pm), failed on device a FOURTH time (wordy hallucinated ramble, inline "## Summary", invented referral/imaging) → reverted to Qwen3-1.7B same evening after systematic diagnosis confirmed the model as root cause. **Do not retry.**
- **DeepSeek** (all small) — only R1 reasoning-distills exist ≤4B; reasoning-RL fails strict format.
- **GLM-Edge-4B** — chatglm arch (no export path), no Malay, stale (Nov 2024), custom license.
- **Hunyuan-4B** — baked-in reasoning modes, custom arch, restrictive license.
- **Llama-3.2-3B / SmolLM3-3B** — no Malay/Chinese.
- **MedPsy-1.7B** — reasoning-in-prose, speculates drug names.
- **Med42 / OpenBioLLM / HuatuoGPT / II-Medical** — all ≥7B or reasoning-trained.

## Upgrade pipeline (post-demo)

1. Mac harness: SEA-LION-v4-4B vs Qwen3-4B-Instruct-2507 head-to-head on real
   code-switch transcripts.
2. Winner → official ExecuTorch export (8da4w) → **device-quantized eval** (build a
   device-side harness first; until then quantized models count as untrialed).
3. Hosting: HF repo (needs org token) or LAN server for testing; bundling 2.6GB into
   the app is the offline fallback.
4. Memory ceiling: `increased-memory-limit` entitlement is now provisioned (org team
   signing); whisper unload is awaited before LLM load.

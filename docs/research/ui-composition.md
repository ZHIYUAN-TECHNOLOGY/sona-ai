# UI composition: JEV, Laya and json-render

Checked 2026-09-25.

## Question

Can Sona get JEV-style UI composition (the model chooses from app-owned candidates instead of writing UI) without sending prompts to a closed model? Can Laya do it with json-render?

## Findings

- **json-render's composition engine is pluggable.** `experimental_composeSpec({ catalog, candidates, prompt, evaluate, ... })` takes any `evaluate` function of type `({ state, questions, signal }) => Promise<{ answers: { [name]: { choice, confidence? } }, usage? }>`. Its source comment reads: "Custom adapters must return one of each question's offered criteria keys." `experimental_createEvaluator` is only the built-in adapter for Vercel AI Gateway (`https://ai-gateway.vercel.sh/v4/ai/evaluation-model`, model `typesafe-ai/jev`). Source: `packages/core/src/experimental-compose.ts:73`, `experimental-evaluator.ts:36-66` in https://github.com/vercel-labs/json-render (commit of 2026-09-23).
- **It is already in the installed package.** The docs call the APIs "unreleased", but the published `@json-render/core@0.21.0` tarball already exports `experimental_composeSpec`. The app depends on `^0.21.0`. Pin the exact version, because `experimental_` names may change.
- **Candidates own their props.** "The evaluator cannot modify its props or bindings." Content therefore reaches the page through state and bindings, never through the evaluator. This matches Sona's rule that props carry only IDs. Limits: 32 evaluations, 32 elements, depth 8. V1 supports literals, `$state`, `$bindState` and state-based visibility only. Source: https://json-render.dev/docs/jev
- **Laya** (https://github.com/NandhaKishorM/laya, Apache 2.0, PyPI `laya` 0.3.20) is an open, non-autoregressive decision model. It is a ModernBERT-large encoder (421M, English) or an mmBERT-base encoder (322M, 100+ languages) with `choice`/`score`/`noul` heads, running in about 33 ms per question on a T4.
  - `laya-serve` exposes `POST /v1/systemone`, the same wire protocol as TypeSafe's hosted Jev API.
  - Runtimes: Python, ONNX and `laya-ts` (Node or browser via ONNX).
  - Its own "honest limits":
    - The base checkpoints are near chance zero-shot on typed decisions (0.362 vs a 0.318 random baseline). They need fine-tuning; the fine-tuned checkpoint reaches 0.766 against Jev's published 0.727.
    - Accuracy drops beyond about 20 options per question (Banking77: 0.425 vs Jev 0.870).
    - It fails on negation examples.
    - `laya-multilingual` ships without fitted confidence temperatures.
- **The integration is a roughly 30-line adapter.** Call Laya's `/v1/systemone` from a custom `evaluate` and map the response to `{ choice, confidence }`. The response schema is Jev-shaped, but Laya's `confidence` is 1 minus normalised entropy, so use `answer_confidence` instead. Laya's endpoint differs from the Gateway v4 endpoint that `experimental_createEvaluator` calls, so the built-in adapter cannot simply be repointed.

## Options for the `evaluate` function

| Evaluator | Hosting | Latency per decision | Zero-shot quality | Extra work |
|---|---|---|---|---|
| Gemma 4 26B, constrained to the offered keys (vLLM guided choice) | Already deployed | ~150–400 ms (estimate) | Strong; understands clinical context and Manglish | Adapter only |
| Laya (`laya-multilingual`) | Extra small deployment (Baseten CPU/L4, alongside OpenMed) | ~33 ms | Near chance until fine-tuned | Adapter + a fine-tune on our own composition decisions + calibration |
| TypeSafe Jev (built-in adapter) | Vercel AI Gateway, closed | Unmeasured | Strong | Excluded: patient prompts leave our stack |

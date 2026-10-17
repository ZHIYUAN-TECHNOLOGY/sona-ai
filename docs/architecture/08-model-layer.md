# 08 · Model seam and fallbacks

[Diagram](08-model-layer.html) · [SVG](08-model-layer.svg) · [PNG](08-model-layer.png) · [source](08-model-layer.archify.json)

**Answers (new engineer):** how a route reaches a model, what happens when a model is down, and what the screens call each model.

## What it shows

- Routes and agents call `context.models ?? stubModels`. `Models` (`packages/api/src/models.ts`) is the one seam: 23 methods (one optional, `streamEvidence`). Every answer carries its origin: `{ source: "model", model }` or `{ source: "fixture", waking? }`.
- **No `BASETEN_API_KEY`:** `context.models` is undefined and every method answers from `stubModels` (rules and authored text, labelled fixture).
- **Key set:** `basetenModels` (`packages/api/src/baseten-models.ts`) maps methods to boxes. A call that fails answers from the stub, labelled fixture.
- **`sagemakerFetcher`** (`packages/api/src/sagemaker.ts`) is a `fetch` wrapper inside that adapter: when `SAGEMAKER_ENDPOINTS` and the AWS keys are set, it rewrites a listed box's Baseten URL to `runtime.sagemaker.ap-southeast-5.amazonaws.com/endpoints/<name>/invocations` (or `invocations-response-stream` for streamed chat), signs it with SigV4 on WebCrypto, and sends `lambda:` entries to Lambda Invoke. A box not listed falls through to Baseten.

## Method → box

| Box | Methods |
| --- | --- |
| `sona-brain` (Sona Med) | briefing, reasoning, synthesiseEvidence, streamEvidence, huddleBrief, draftReply, suggestCodes, draftAppeal, draftVisitSummary, draftDischarge, classifyReply, triageMessage, answerFromPlan, explainResult, draftNote |
| `sona-voice` (Sona Speech, Sona Voice) | transcribe (with diarization), speak; the reranker |
| `sona-xray` (Sona Vision) | xrayRead, incidentalFindings, readHandwrittenNote, readDocumentPage, readMedicinePhoto |
| `sona-pii` (Sona Privacy) | deidentify |

Outside the seam: `ask.route` calls Laya (`sona-laya`) directly; the library embedder is `sona-embed` when named, else Workers AI `@cf/google/embeddinggemma-300m`, else a hashed stub; the X-ray image embedder exists only on `sona-embed`.

## Names on screen (`packages/domain/src/model-names.ts`)

First match wins: `pii|deident` → Sona Privacy; `asr|whisper|speech` → Sona Speech; `voxcpm|tts|voice` → Sona Voice; `medgemma…-4b|cxr|xray` → Sona Vision; `gemma|sea-lion|laya|brain|sona-med` → Sona Med; anything else → "Sona".

## Timeouts

30 s default; 60 s evidence; 90 s scribe draft; 8 s reranker; 5 s Laya; 2.5 s health; 5 s wake; embedder 3 s per query, 60 s per document batch.

## Known limits

- **A Baseten key is required even when every box is on SageMaker** (the SageMaker path lives inside the Baseten adapter).
- On SageMaker, `wake` and `health` are answered locally with 200; a deleted endpoint fails the real call and the stub answers without a `waking` estimate. Only on Baseten (and Laya) does a cold box report minutes until ready.
- `workersModels` (Whisper, SEA-LION) is written and tested but never wired.

Checked against code at `cd76571b` on 8 Oct 2026.

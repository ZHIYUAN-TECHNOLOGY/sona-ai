# Laya baseline

Held-out test set for the UI-composition evaluator (Laya, with Gemma as backup). Never train on `baseline.jsonl`; training data comes from a separate generator.

- **`baseline.jsonl`**: 50 fictional clinician requests (Manglish, Malay, English, Mandarin mixes) against the two demo patients. Each has the correct capability (one of the eight clinical results in `apps/native/features/presentation/catalog.ts`, or `not-covered`) and the catalogue medicine it names, if any. The six `not-covered` requests (discharge, guarantee letter, coding, referral, handover, beds) test that the evaluator leaves out what the catalogue can't answer.
- **`python check.py`**: validates the set against the catalogue, medicine list and patients. `--requests` prints one json-render evaluator request (`{state, questions}`) per line, with `gold` answers to score against.
- **`python score.py laya|gemma`**: runs an evaluator over the set and prints accuracy per question, time per request and every miss. Laya runs locally (`pip install laya`; CPU or Apple MPS). Gemma takes any OpenAI-compatible endpoint via `GEMMA_URL`, `GEMMA_MODEL` and `GEMMA_KEY`.

Pass bar (suggested): capability ≥ 90% and medicine ≥ 95% correct. Under that, train Laya on synthetic decisions; above it, calibrate only.

## Results

| Date | Evaluator | Capability | Medicine | Median time |
| --- | --- | --- | --- | --- |
| 29 Sep 2026 | Laya multilingual 0.3.21, untrained, local Mac | 17/50 (34%) | 48/50 (96%) | 59 ms |

Untrained Laya fails the capability bar. It is not the "None of the above" option: with that option removed, it still scores 16/44 (36%) on the covered requests. It sends most briefing, medication and follow-up requests to the wrong card. Picking a named medicine already passes.

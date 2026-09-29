# Laya baseline

Held-out test set for the UI-composition evaluator (Laya, with Gemma as backup). Never train on `baseline.jsonl`; training data comes from a separate generator.

- **`baseline.jsonl`**: 50 fictional clinician requests (Manglish, Malay, English, Mandarin mixes) against the two demo patients. Each has the correct capability (one of the eight clinical results in `apps/native/features/presentation/catalog.ts`, or `not-covered`) and the catalogue medicine it names, if any. The six `not-covered` requests (discharge, guarantee letter, coding, referral, handover, beds) test that the evaluator leaves out what the catalogue can't answer.
- **`python check.py`**: validates the set against the catalogue, medicine list and patients. `--requests` prints one json-render evaluator request (`{state, questions}`) per line, with `gold` answers to score against.
- **`python generate.py`**: Gemini (`gemini-3.8-flash`, key in `~/.config/gemini_key`) writes fictional requests for every capability × 6 language styles × 2 patients into `requests.jsonl` (committed; only missing combinations call the API). It drops duplicates, anything close to the baseline, and requests naming several or off-card medicines, then writes `train.jsonl` in Laya's typed-decisions format. The offered cards vary per row: 15% leave out the right card (answer becomes `not-covered`), options are shuffled.
- **`finetune_kaggle.ipynb`**: Laya's official Kaggle notebook (Apache-2.0) switched to the multilingual checkpoint and this data, scoring the baseline at the end. Upload `train.jsonl` and `baseline_requests.jsonl` (`python check.py --requests > baseline_requests.jsonl`) as one Kaggle dataset, attach it, pick GPU T4 x2 with Internet on, and run all.
- **`python score.py laya|gemma`**: runs an evaluator over the set and prints accuracy per question, time per request and every miss. Laya runs locally (`pip install laya`; CPU or Apple MPS). Gemma takes any OpenAI-compatible endpoint via `GEMMA_URL`, `GEMMA_MODEL` and `GEMMA_KEY`.

Pass bar (suggested): capability ≥ 90% and medicine ≥ 95% correct. Under that, train Laya on synthetic decisions; above it, calibrate only.

## Results

| Date | Evaluator | Capability | Medicine | Median time |
| --- | --- | --- | --- | --- |
| 29 Sep 2026 | Laya multilingual 0.3.21, untrained, local Mac | 17/50 (34%) | 48/50 (96%) | 59 ms |
| 29 Sep 2026 | Gemma 4 26B A4B-it, Google AI Studio API (thinking forced on) | 45/50 (90%) | 50/50 (100%) | 9.9 s |
| 29 Sep 2026 | Laya multilingual, fine-tuned v1 (Kaggle T4 x2, 4 epochs, ~4 min) | 44/50 (88%) | 50/50 (100%) | 40 ms |

Untrained Laya fails the capability bar. It is not the "None of the above" option: with that option removed, it still scores 16/44 (36%) on the covered requests. It sends most briefing, medication and follow-up requests to the wrong card. Picking a named medicine already passes.

Gemma just meets the capability bar but misses four of the six `not-covered` requests (discharge, guarantee letter, referral, handover): it forces them onto a card, usually follow-up. Its time is from Google's endpoint, which always thinks first; self-hosted INT4 without thinking on the L4 has not been measured.

## Training data (29 Sep 2026)

1,144 requests kept of 1,296 (149 dropped for medicine ambiguity, 3 duplicates, 0 near the baseline); 2,288 training items, all tokenise, longest 169 tokens. Capability labels after augmentation: not-covered 283, prescription 127, briefing 124, xray 120, evidence 118, followup 116, reasoning 108, note 79, medication 69. Medication and note are thinnest because their requests often name two medicines; top them up if the trained model still misses them.

## Fine-tune v1 (29 Sep 2026)

Kaggle notebook `zhiyuantech/sona-laya-finetune` (private), data `zhiyuantech/sona-laya-composition` (private). Model saved outside the repo at `~/zyt/data/sona-laya/v1` (650 MB); load with `LAYA_MODEL=~/zyt/data/sona-laya/v1 python score.py laya`. Same score on Kaggle and locally. Choice calibration temperature fitted to 4.29.

34% to 88%, two short of the bar. Misses: briefing to not-covered (L01, L05), note to briefing/followup (L38, L39), medication to followup (L21), ICD-10 coding to followup (L47). Note and medication were the thinnest classes in the training data.

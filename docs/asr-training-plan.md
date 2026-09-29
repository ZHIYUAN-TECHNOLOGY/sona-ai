# Manglish speech-to-text training plan

Status: agreed with the user on 27 September 2026 after a grilling session. It replaces the Qwen3-ASR row of the [delivery plan's fine-tuning section](delivery-plan.md#fine-tuning). Facts behind each decision are in [ASR training data](research/asr-training-data.md), the [dataset catalogue](research/datasets.md) ([CSV](research/datasets.csv)) and [TTS models](research/tts-models.md).

## Why

A quick test on the public Qwen3-ASR Space showed the base model handles Malay with English, but misses a switch into Mandarin mid-sentence (咳到睡不着 came out as "Ketau sih pucau") and confuses homophones (咳 → 课, batuk → patuk). Manglish is the main selling point, so this model is trained.

## Scope

- Only **Qwen3-ASR-1.7B** is trained in this plan. VoxCPM2, Laya, Gemma and Nemotron get their own plan later, and only if they fail their baseline.
- No real people record anything. Training audio is synthetic plus licensed public speech.

## Pass bar

Measured on the test sets below, as a mixed error rate: word error for English and Malay, character error for Mandarin.

| Check | Passes when |
| --- | --- |
| Manglish | ≤ 15% mixed error rate |
| Drug names | ≥ 90% correct |
| English only | No worse than the base model |
| Reporting | Error rate shown per language as well as overall |

## Deadline

- **Go/no-go around 3 October:** if the fine-tune does not beat the base model, freeze the base model.
- **Freeze around 6 October.** The base model stays deployable as the fallback, because Manglish STT is never cut.

## Licences

- Commercial-clean data (CC0, CC BY, MIT, Apache 2.0, Singapore Open Data Licence) may be used for any model.
- Non-commercial or unlicensed data (SEAME, Scicom, mesolitica test sets) may be used for the **competition model only**. It is tagged in the catalogue, and the model is retrained on clean data before any hospital use.
- Audio scraped from YouTube or online consultations is never used: it may hold real people's health details.
- Generators are used offline, once, on fictional scripts only, to make training data. That is separate from the delivery plan's serving exclusions: no patient data ever reaches them, and the shipped model is the self-hosted Qwen3-ASR.
- **Gemini TTS is the synthetic audio engine** (decided 27 Sep after Stage 0). Its output is used for the competition model only, like other restricted data; check Google's API terms and regenerate or retrain clean before any hospital use.
- Closed Qwen TTS is used only if Alibaba grants written permission: its terms forbid using outputs "to train or develop products or services that compete with" Alibaba.

## Scripts

- **Sources:** ACI-Bench, MTS-Dialog and PriMock57 transcripts for conversation flow; nisten opus5-5 and Synth-DoPaCo for disease and drug vocabulary. Start with the demo conditions (pneumonia, asthma, URTI, gastroenteritis, diabetes, hypertension), then widen.
- **Writer:** Claude rewrites them into Manglish in batches against one fixed rule sheet. Target about 300–500 conversations.
- **Language mix per turn:**

| Share | Pattern |
| --- | --- |
| 30% | One language only |
| 50% | One main language with 1–3 words from another (medical terms, numbers, days) |
| 20% | Heavy mixing |
| ≤ 5% | All three languages in one sentence |

- **Personas:** Malay-dominant, Chinese-dominant and English-dominant patients; an English-leaning doctor who switches to the patient's language. Particles (lah, lor, meh, ah) sparingly, more from patients.
- **Review:** the user and one friend read a sample of 30 scripts and reject anything that sounds unnatural or overly code-switched.

## Audio

| Set | Source | Size |
| --- | --- | --- |
| Train, synthetic | Gemini 3.8 Flash TTS reading the scripts, with most of its voices | ~30 h |
| Train, real | SEAME training split (competition only), IMDA National Speech Corpus Part 4, FLEURS Malay and Mandarin, ~10 h of Fareez OSCE | ~30 h |
| Test, real | SEAME dev sets, Revolab benchmark, mesolitica manglish-ms, FLEURS test | as available |
| Test, synthetic | Gemini TTS with voices held out from training, reading held-out scripts | ~1–2 h |

- **Voices:** Gemini's prebuilt voices, steered by a text description (age, gender, Malaysian accent, pace). A few voices are kept out of training for the test set. Because every clip comes from one engine, the real public test sets are the main check against the model learning the engine's sound.
- **Variety:** many voices, plus background noise, room echo, phone-microphone quality and ±10% speed. Speaker variety is what the literature says matters most.
- **Known limit:** drug-name accuracy is only ever measured on synthetic audio. Demo claims stay within what was measured.

## Stage 0: engine check (done 27 Sep)

Result: VoxCPM2 (whole sentence and stitched), Scicom and MOSS-TTS failed; Gemini 3.8 Flash TTS passed. Details in the [Stage 0 sheet](asr-stage0-lines.md).

Twenty Manglish lines, each mixing English, Malay and Mandarin, through VoxCPM2, MOSS-TTS and Scicom. An engine is kept only if all three hold:

1. The user rates it natural (average ≥ 3/5, no line overly code-switched).
2. Mandarin inside a Malay or English sentence is spoken as Mandarin, either from the whole sentence or stitched per language. Stage 0 picks the method.
3. Base Qwen3-ASR makes the same kinds of mistakes on it as on real speech (missed switches, homophones). Audio it transcribes perfectly teaches nothing.

If every engine fails, train on the real licensed audio only.

## Pilot and scale-up (28 Sep)

- **Pilot:** 10 conversations, 145 turn clips, 34 minutes, about $0.60. The user approved the scripts, the audio and the background scenes.
- **Scale:** about 540 conversations in six areas (respiratory and ENT; cardiovascular and metabolic; gut, kidney and urology; infections and skin; bones, nerves and mental health; women, children, elderly and hospital workflows), 90 each, 1 in 20 held out for testing. About 30 h at roughly $16–20.
- **Pipeline:** [tools/asr-data](../tools/asr-data/README.md). Every turn is its own clip with an exact transcript. Clips where Gemini read the instruction aloud (23% in the pilot) or repeated the line are caught automatically and redone as plain text.
- **Scenes:** waiting room chatter, AC or fan room, phone call and quiet room, mixed in at random during training so the voice stays 12–22 dB above the background.

## Training

- Baseten's official recipe, `ml-cookbook/examples/qwen3-asr-transformers`, full fine-tune on 1×H100 ($6.50/h, billed per minute; about $13–39 per run).
- Two runs, compared with the base model on the real test sets:

| Version | Training data |
| --- | --- |
| Base | None |
| Synthetic only | ~30 h synthetic |
| Mixed | ~30 h synthetic + ~30 h real licensed |

- The winner ships as a new box ② version through `bt://<project>@<job>/<checkpoint>`. Rollback means promoting the previous version.

## Estimated cost

| Item | Estimate (USD) |
| --- | --- |
| Script writing | ~$20–60 |
| Synthetic audio | Gemini TTS API; measured on the pilot batch |
| Training, 2 runs | ~$26–78 |
| Evaluation | ~$5 |

## Status and next steps (28 Sep 2026)

Start here when continuing this work.

**Done**
- 540 scripts in `tools/asr-data/scripts/`; the user approved a sample.
- 8,000 of 8,480 turns voiced (29.2 h) in `~/zyt/data/sona-asr/audio/`. The last 480 were never voiced because the Gemini monthly spend cap (RM130) was reached; the user chose to train without them.
- The Baseten secret `hf_access_token` holds a Hugging Face write token for user `zyt-ngchwanlii`; the same token is at `~/.cache/huggingface/token_write`.

- Instruction leak fixed: 7,968 of 8,000 clips had the voicing instruction read aloud. `tools/asr-data/trim.py` cut it off in 7,964; the 4 it could not fix are in `~/zyt/data/sona-asr/bad.txt`. The user listened to three trimmed clips and confirmed them clean. (`trim.py` now empties the MPS cache per batch; without that it held 30+ GB and swapped.)
- Dataset rebuilt (`~/zyt/data/sona-asr/dataset/`): 15,102 train rows (7,551 clips, each clean and with one background scene), 445 test, 445 test_noisy. Uploaded by `upload.py` to the private dataset `zhiyuantechnology/sona-manglish-asr`.
- **Base model baseline** (synthetic held-out test sets):

| Set | Mixed error | Mandarin char error | Drug names |
| --- | --- | --- | --- |
| test | 14.4% | 16.1% | 20/31 (65%) |
| test_noisy | 14.9% | 16.2% | 22/31 (71%) |

The base model already meets the ≤ 15% mixed error bar on synthetic audio; drug names (≥ 90%) are the gap the fine-tune must close. The real test sets (SEAME, Revolab, FLEURS) are not scored yet.

- **Synthetic-only run done** (Baseten project `qzk97kq`, job `q9z26xw`, 2 epochs, 234 steps, 35 min, ~$3.80). Checkpoints downloaded to `~/zyt/data/sona-asr/ckpt/`. Real-speech sets: `real_test.py` builds FLEURS Malay, Mandarin and English tests (300 clips each).

| Set | Base | Epoch 1 (`checkpoint-117`) | Epoch 2 (`checkpoint-234`) |
| --- | --- | --- | --- |
| Synthetic test, mixed error | 14.4% | 3.9% | 3.7% |
| Synthetic test, drug names | 20/31 | 30/31 | 30/31 |
| Synthetic noisy, mixed error | 14.9% | 4.3% | 4.4% |
| FLEURS Malay | 10.9% | 11.9% | 12.6% |
| FLEURS Mandarin | 4.6% | 4.2% | 4.1% |
| FLEURS English | 4.7% | 5.4% | 5.5% |

Synthetic-only training fixes Manglish and drug names but drifts on real Malay and English, more with the second epoch; it fails the "English no worse than base" bar. Epoch 1 is the better candidate. Per-clip transcripts (`baseline.py` now writes `~/zyt/data/sona-asr/scores/`) show whether the drift is mishearing or formatting.

- **Mixed run done and it is the candidate** (job `qkg4vdw`, 1 epoch over synthetic + FLEURS train, config `mixed` of the HF dataset, built by `mixed_data.py`; 183 steps, ~52 min, ~$5.60; checkpoint at `~/zyt/data/sona-asr/ckpt/mixed-final`, on Baseten as `final`, and published as the private model `zhiyuantechnology/sona-qwen3-asr-manglish`, which box ② loads). Extra real tests from `real_test.py`: Revolab public split without its FLEURS clips (667 clips, real Malaysian speech, eval only) and `real_voice` (the user reading the 15 fictional lines in `real_voice_lines.json`, recorded on a phone, test only).

| Set | Base | Synthetic only, epoch 1 | Mixed |
| --- | --- | --- | --- |
| Synthetic test, mixed error | 14.4% | 3.9% | 4.1% |
| Synthetic test, drug names | 20/31 | 30/31 | 30/31 |
| FLEURS Malay | 10.9% | 11.9% | 9.8% |
| FLEURS Mandarin | 4.6% | 4.2% | 3.1% |
| FLEURS English | 4.7% | 5.4% | 4.6% |
| Revolab | 19.6% | 19.5% | 17.7% |
| User's voice, medical Manglish | 21.3% | 11.4% | 10.0% |
| User's voice, drug names | 8/10 | 10/10 | 10/10 |

The Mixed model passes every bar. FLEURS scores flatter it (it trained on FLEURS train, same read style); Revolab and the user's voice are the fairer checks. Still weak: 咳 heard as 渴, and the HbA1c line fails for every model. The user's voice is one speaker and 15 lines.

**Next:** deploy the Mixed checkpoint as the new box ② version (paid, needs the user's approval), keeping the base model as rollback.

**Earlier steps (kept for the record)**
1. With the user's manual approval, submit a smoke test on Baseten (`MAX_SAMPLES=200 MAX_STEPS=5`, ~$2), then the full run. The job goes through the Baseten MCP `create_training_job`: image `pytorch/pytorch:2.7.0-cuda12.8-cudnn9-runtime`, weights `hf://Qwen/Qwen3-ASR-1.7B` at `/app/models/Qwen/Qwen3-ASR-1.7B`, start command downloads `basetenlabs/ml-cookbook` at `afe9b86` and runs `examples/qwen3-asr-transformers/training/run.sh`. Set `DATASET_REPO`, `DATASET_SPLIT=train`, `DATASET_CONFIG=default`, `LANGUAGE=None`, `MAX_SAMPLES=100000`, `EVAL_SAMPLES=200` and `HF_TOKEN` (secret `hf_access_token`) directly on the job: the recipe's `config.py` does not forward dataset variables, so `baseten train push` would silently train on LibriSpeech. Never pass an empty value: Baseten drops empty variables and `run.sh` then falls back to its LibriSpeech defaults (`clean`, `English`, 800 samples). The first smoke test (job `wp7g19w`, project `qzk97kq`) failed on exactly this.
2. Score the fine-tuned checkpoint with `python baseline.py <checkpoint>` against the pass bar, and score base and fine-tuned on the real test sets.

**Tidy up afterwards:** delete the chat-shared Hugging Face and Gemini tokens and create fresh ones; delete the Cloudflare `sona-stage0-review` Worker and R2 bucket.

## Side actions

- Email Alibaba asking for written permission to use Qwen TTS output for ASR training. A bonus, not a dependency.
- Email the Scicom authors about a licence. Not blocking.

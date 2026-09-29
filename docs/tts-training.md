# VoxCPM2 Malaysian voice fine-tune

Status (29 Sep 2026): **done and passing.** The full fine-tune scores Malay 5, English 5, Chinese 4 from a Malaysian listener (bar: ≥ 4 in every language, [delivery plan](delivery-plan.md#fine-tuning)). The model is the private `zhiyuantechnology/sona-voxcpm2-malaysian`; box ② loads it instead of `openbmb/VoxCPM2`.

## What it is for

Sona speaks its own replies: voice conversation answers and the optional spoken discharge leaflet. Speech-to-text (what people say, shown on screen) is the [ASR model](asr-training-plan.md); this is the other direction.

Each reply is spoken in **one language**, the one the user selected. Gemma writes the reply in that language and VoxCPM2 reads it. This avoids mixing languages inside a sentence, which VoxCPM2 failed in [Stage 0](asr-stage0-lines.md). In Malay replies, drug names stay in English as Malaysian doctors say them (paracetamol, amoxicillin); the training lines follow that rule.

## Why VoxCPM2

It is the best open model with a commercial licence for this job (Apache 2.0, Malay, Mandarin and English, official fine-tuning scripts, fits box ②). See [TTS models](research/tts-models.md). No open, licensed model was trained on Malaysian speech, so the Malaysian accent comes from the fine-tune.

## Rounds

Scores are the user's 1–5 rating on 20 hospital replies (7 Malay, 7 Chinese, 6 English), collected on a private listening page. Pronunciation is the share of 150 medical terms (50 terms × 3 languages, `tools/tts-eval/terms.json`) that the fine-tuned ASR hears back intact; most Malay misses are spelling only (parasetamol heard as "paracetamol").

| Round | Version | Malay | Chinese | English | Pronunciation (en / zh / ms) |
| --- | --- | --- | --- | --- | --- |
| 1 | VoxCPM2 as-is, voice designed from a text description | 4 | 3 | 3 | 98% / 96% / 70% |
| 2 | LoRA, 1.15 h of Kore, 1,000 steps | 3 | 3 | 3 | 98% / 96% / 74% |
| 3 | Voice cloning from a 7 s Kore clip (± LoRA) | not rated | | | 19/20 lines, but cloning swapped drug names |
| **4** | **Full fine-tune, 4.35 h of Kore, 1,000 steps** | **5** | **4** | **5** | **100% / 96% / 72%**; 20/20 listening lines |

Round 1 and 2 listeners heard a robotic voice and Indonesian-sounding Malay. The LoRA barely changed the voice; cloning added drug-name errors (氯吡格雷 heard as "liraglutide"). What worked was more, purpose-written data and training all weights.

## Data

One voice, Gemini TTS "Kore" (female), steered with "Say this as a calm Malaysian nurse, with a natural Malaysian accent…". `tools/asr-data/trim.py` cut the instruction off where Gemini read it aloud (1,797 of 1,800 new lines).

| Part | Clips | Hours |
| --- | --- | --- |
| Kore clips from the ASR training set | 563 | 1.15 |
| New nurse lines, Malay (`tools/tts-eval/scripts/ms.json`) | 600 | 1.11 |
| New nurse lines, English | 600 | 1.11 |
| New nurse lines, Chinese | 599 | 0.98 |
| **Total** | **2,362** | **4.35** |

The new lines are fictional replies: medication (30%), home care (20%), red flags (15%), reassurance (15%), appointments (10%) and ward operations (10%). Private dataset: `zhiyuantechnology/sona-voxcpm2-kore`.

## Recipe

`tools/tts-eval/train/run.sh` on a Baseten 1×H100 (project `qvv00xq`, job `qrn45vw`), started through the Baseten MCP like the ASR jobs:

- VoxCPM's own `scripts/train_voxcpm_finetune.py` at commit `f772e49`, config `voxcpm_finetune_all.yaml` (`MODE=all`).
- 1,000 steps, effective batch 16 (about 7 passes over the data), learning rate 1e-5, ~1.2 s per step, 48 GB of GPU memory.
- `run.sh` patches the script so a save writes only the weights (~9.6 GB) at `SAVE_EVERY` steps and at the end. The stock script also saves at step 0, twice at the end, with 18 GB of optimizer state and a `latest/` copy; one such save idled the H100 for 8 minutes.
- The tarball install needs `SETUPTOOLS_SCM_PRETEND_VERSION_FOR_VOXCPM` (no `.git` for setuptools-scm).

Cost: about $10 of H100 time across all TTS runs (two smoke tests, the LoRA, the full fine-tune) plus about $1–2 of Gemini batch voicing.

## Checks and tools

- `tts_test.py [checkpoint]`: reads all 150 glossary sentences (base, LoRA or full checkpoint).
- `score.py`: pronunciation through the fine-tuned ASR, per language and kind, and picks 20 clips to listen to.
- `clone_test.py`: voice-cloning variant.
- Ratings are stored per round (`ratings/tts-round1` … `round4`) on the private listening page.

## Known weak spots

- Some rare drug names still slip: gliklazid, budesonid, 西替利嗪 (heard as "citalopram"), 培哚普利.
- "pening kepala" is sometimes heard as the Indonesian "pusing kepala".
- One listener, 20 lines. A second Malaysian listener, especially for Chinese (scored 4), would firm up the result.

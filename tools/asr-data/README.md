# ASR training data

Builds the synthetic Manglish consultation audio for the [ASR training plan](../../docs/asr-training-plan.md). Scripts (text) live in `scripts/`; audio goes to `$ASR_DATA_DIR` (default `~/zyt/data/sona-asr`), outside the repo.

1. **Scripts:** `scripts/<area>/batch_NN.json`, written to [SCRIPT_RULES.md](SCRIPT_RULES.md). About 1 in 20 conversations is the test split, voiced with held-out voices.
2. **Voice:** `python voice.py submit`, then `python voice.py poll` (Gemini Batch API; key in `~/.config/gemini_key`).
3. **Check:** `python check.py --delete` removes clips where Gemini read the instruction aloud, repeated the line, or ran long. Then `python voice.py submit --plain` and `poll` again. Repeat until check reports 0 bad.
4. **Scenes:** `augment.scene(audio, kind, babble_pool)` adds a waiting room, AC room, phone call or quiet room at training time. Noise and room echo come from OpenSLR 28 RIRS_NOISES (Apache 2.0) at `$RIRS_NOISES`.

Python needs `qwen-asr`, `torch`, `librosa`, `soundfile` and `scipy`.

Pilot findings (27–28 Sep 2026): 23% of instruction-prompted clips leaked the instruction and a few repeated the line; plain text never leaked. The standard API allows 100 TTS requests a day; the Batch API has no such limit and costs half. About 1,900 output tokens per minute of audio, so 30 h costs roughly $16 at the batch rate.

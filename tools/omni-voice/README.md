# Sona-voice training audio for MiniCPM-o's talker

Builds `voice/` of the private dataset `zhiyuantechnology/sona-minicpmo-data`: Sona's voice saying short replies in Malay, English and Mandarin (one language per sentence, as Sona speaks), plus Manglish mixed inside the sentence. It is stage 3 data of the [fine-tune run sheet](../../docs/minicpm-o-finetune.md). Local data lives in `~/zyt/data/sona-omni/voice/`.

| Step | Command | What it does |
|---|---|---|
| 1 | `python3 lines.py` | Gemma (box ①) writes Sona-style lines on 26 topics, covering the glossary terms; adds the 1,800 nurse lines; drops any sentence of the Sona eval set. Resumable (`gemma_raw.jsonl`) |
| 2 | `python src.py` | Uploads `run.sh`, `speak.py`, `hear.py` and the ms/en/zh lines (shuffled) to `voice/src/` |
| 3 | Baseten Training Job, 1×H100, image `vllm/vllm-openai:v0.29.0-cu129`, weights `/app/models/tts` and `/app/models/asr` (box ② revisions), start command: download `voice/src/*.sh,*.py`, run `run.sh` | `speak.py` reads every line with Nano-vLLM-VoxCPM (10 steps, cfg 2.0, 24 kHz FLAC, stops starting new lines after `SPEAK_MINUTES`). `hear.py` reads each clip back with qwen-asr and keeps ≤ 5% word errors (`kept.jsonl`); it moves nothing if the ASR is broken. `RESUME=1` re-reads an earlier job's clips instead of speaking |
| 4 | `python manglish.py submit`, then `poll` | Gemini TTS voice Kore (the voice Sona's VoxCPM2 voice was trained from) reads the Manglish lines that really mix languages, as plain text, through the Batch API of `tools/asr-data/voice.py` |
| 5 | `python ../omni-eval/score.py ~/zyt/data/sona-omni/voice/manglish` | Our ASR reads the Manglish clips back; `build.py` keeps ≤ 5% |
| 6 | `python build.py` (`--dry-run` prints hours only) | Joins the VoxCPM2 and Manglish clips with the 4.35 h Kore set. Publishes three files with `~/.cache/huggingface/token_write`: `voice/audio.tar` (`audio/<id>.wav`, 24 kHz mono 16-bit), `voice/train.jsonl` (`id, audio, text, lang, source, seconds`) and `voice/README.md`. Never one upload per clip: the account allows 1,000 Hugging Face requests per 5 minutes |

The job's clips come back as Baseten checkpoint files: fetch them with `baseten train checkpoint files --job-id <id>` and `curl --parallel`. Python for steps 2–6 is the `venv-asr` from `tools/omni-eval` (qwen-asr, datasets, huggingface_hub); step 1 needs only the standard library.

Data rights: Gemini, and VoxCPM2 fine-tuned on Gemini's Kore, made every clip. That makes this data for the competition and demo model only, under the [ASR plan's licence rules](../../docs/asr-training-plan.md#licences).

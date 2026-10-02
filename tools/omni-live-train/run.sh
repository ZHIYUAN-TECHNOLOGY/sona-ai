#!/bin/bash
# MiniCPM-o live-format LoRA on a Baseten Training Job, 1×H100 (docs/minicpm-o-finetune.md, live format).
# Job setup:
#   env:   HF_TOKEN (hf_access_token secret: the data and model repos are private), HF_WRITE_TOKEN (hf_write_token: saves
#          the result); BRAIN (model repo revision to start from, default stage1), PUSH_BRANCH (default live1),
#          EPOCHS (2), LR (1e-4), RELANG (share of single-language questions briefed with another
#          fallback language, default 0)
#   start: hf download zhiyuantechnology/sona-minicpmo-data --repo-type dataset --include "live/*" --local-dir /workspace
#          && bash /workspace/live/run.sh
#   live/ holds this folder (run.sh, train.py, layout.py) and tools/omni-train/push.py.
# Data: sft/hear_answer.json and its audio in packs/sft-audio.tar (one tar: Hugging Face allows 1000 requests / 5 min).
# No checkpoint volume (it fails to mount for these jobs): the merged model and its live test go to the model repo.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); W=/workspace
pip install -q "minicpmo-utils[tts]==1.0.6" "transformers==4.51.3" "accelerate<1.8" "setuptools<80" peft safetensors huggingface_hub hf_xet
hf download zhiyuantechnology/sona-minicpmo-data --repo-type dataset --include "sft/hear_answer.json" "sft/hear_answer_spoken.json" "packs/sft-audio.tar" "code/sona_voice.wav" --local-dir $W/data > /dev/null
tar -xf $W/data/packs/sft-audio.tar -C $W/data/sft
hf download zhiyuantechnology/sona-minicpmo --revision "${BRAIN:-stage1}" --local-dir $W/brain \
  --exclude "lora-adapter/*" "assets/*.mp4" "assets/*.mp3" "assets/*.png" > /dev/null
python "$HERE/train.py" --brain $W/brain --data $W/data/sft/hear_answer.json --voice $W/data/code/sona_voice.wav \
  --out $W/ckpt/live --epochs "${EPOCHS:-2}" --lr "${LR:-1e-4}" --relang "${RELANG:-0}"
python "$HERE/push.py" $W/ckpt/live zhiyuantechnology/sona-minicpmo "${PUSH_BRANCH:-live1}"

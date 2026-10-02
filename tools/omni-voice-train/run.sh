#!/bin/bash
# MiniCPM-o 4.5 talker fine-tune on a Baseten Training Job, 1×H100 (docs/minicpm-o-finetune.md, stage 3).
# Job setup:
#   weights: hf://openbmb/MiniCPM-o-4_5@503e754207c94da6bb26850b4469f367c9ea3582 at /app/models/MiniCPM-o-4_5
#   env:     HF_TOKEN (hf_access_token secret, the dataset is private), HF_WRITE_TOKEN (hf_write_token, to save results)
#   start:   hf download zhiyuantechnology/sona-minicpmo-data --repo-type dataset --include "code/*" --local-dir /workspace
#            && bash /workspace/code/run.sh
#   code/ holds this folder (run.sh, train.py, talker.py, push.py) plus sona_voice.wav, the voice prompt the evals use
#   (~/zyt/data/sona-tts/eval-full1000/audio/en_22.wav).
# Data: voice/audio.tar + voice/train.jsonl (tools/omni-voice), one tar because per-file downloads hit Hugging Face's
#   1000 requests / 5 min. No checkpoint volume (it fails to mount for these jobs): results go to the model repo.
# Env: STEPS (default 8000), LR (3e-5), DUPLEX (share of live-layout steps, 0.5), BRAIN (model repo revision whose LLM
#   states the talker learns from, e.g. stage1; default the mounted base), PUSH_BRANCH (default voice-v0),
#   LAYOUT=live (states from live calls, tools/omni-live-train/layout.py, which code/ must hold too; sets each clip in
#   one of sft/hear_answer.json's spoken questions), INIT (a model repo branch whose talker.safetensors to start from).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); W=/workspace
pip install -q "minicpmo-utils[tts]==1.0.6" "setuptools<80" safetensors huggingface_hub hf_xet
hf download zhiyuantechnology/sona-minicpmo-data --repo-type dataset --include "voice/audio.tar" "voice/train.jsonl" --local-dir $W/data > /dev/null
tar -xf $W/data/voice/audio.tar -C $W/data/voice
python - $W/data/voice <<'PY'  # absolute audio paths for train.py's jsonl mode
import json, sys
from pathlib import Path
d = Path(sys.argv[1])
rows = [json.loads(l) for l in (d / "train.jsonl").read_text().splitlines()]
(d / "train_abs.jsonl").write_text("\n".join(json.dumps({**r, "audio": str(d / r["audio"])}, ensure_ascii=False) for r in rows))
print("clips", len(rows))
PY
REPO=/app/models/MiniCPM-o-4_5
if [ -n "${BRAIN:-}" ]; then
  REPO=$W/brain
  hf download zhiyuantechnology/sona-minicpmo --revision "$BRAIN" --local-dir "$REPO" --exclude "lora-adapter/*" > /dev/null
fi
LIVE=()
if [ "${LAYOUT:-chat}" = live ]; then
  hf download zhiyuantechnology/sona-minicpmo-data --repo-type dataset --include "sft/hear_answer.json" "packs/sft-audio.tar" --local-dir $W/data > /dev/null
  tar -xf $W/data/packs/sft-audio.tar -C $W/data/sft
  LIVE=(--layout live --contexts $W/data/sft/hear_answer.json)
fi
if [ -n "${INIT:-}" ]; then
  hf download zhiyuantechnology/sona-minicpmo talker.safetensors --revision "$INIT" --local-dir $W/init > /dev/null
  LIVE+=(--init $W/init/talker.safetensors)
fi
VOICE=()
[ -f "$HERE/sona_voice.wav" ] && VOICE=(--voice "$HERE/sona_voice.wav")
OUT=$W/ckpt/talker
python "$HERE/train.py" --data $W/data/voice/train_abs.jsonl --repo "$REPO" \
  --device cuda --dtype bf16 --steps "${STEPS:-8000}" --lr "${LR:-3e-5}" --duplex "${DUPLEX:-0.5}" "${VOICE[@]}" "${LIVE[@]}" --out "$OUT"
python "$HERE/push.py" "$OUT" zhiyuantechnology/sona-minicpmo "${PUSH_BRANCH:-voice-v0}"

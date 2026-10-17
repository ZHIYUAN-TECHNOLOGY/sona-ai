#!/bin/bash
# Held-out scores for MiniCPM-o versions on Baseten 1×H100, on the model's own transformers (4.51), not training's 4.56.
# Env: MODELS "name=source ..." (source: a local dir, e.g. the mounted base /app/models/MiniCPM-o-4_5, or repo@revision).
set -euo pipefail
R=$(cd "$(dirname "$0")" && pwd)
apt-get update -qq && apt-get install -y -qq ffmpeg > /dev/null
pip install -q "transformers==4.51.3" "accelerate<1.8" librosa soundfile "datasets<=4.0.0" pyarrow pillow huggingface_hub
python "$R/eval.py" $MODELS

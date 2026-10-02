#!/bin/bash
# Medical benchmarks (bench.py) for MiniCPM-o versions on a Baseten Training Job, 1×H100, on the model's own transformers.
# Env: MODELS "name=source ..." (a local dir such as the mounted base /app/models/MiniCPM-o-4_5, or repo@revision);
#      HF_TOKEN (hf_access_token: the model repo is private), HF_WRITE_TOKEN (hf_write_token: saves eval/bench-<name>.json).
set -euo pipefail
R=$(cd "$(dirname "$0")" && pwd)
pip install -q "transformers==4.51.3" "accelerate<1.8" pyarrow librosa soundfile pillow huggingface_hub hf_xet
python "$R/bench.py" $MODELS

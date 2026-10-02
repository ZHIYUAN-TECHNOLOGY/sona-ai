#!/bin/bash
# Sona-voice batch on a Baseten Training Job (1x H100, image vllm/vllm-openai:v0.29.0-cu129, the image box ② builds on).
# Weights mounted by the job: /app/models/tts (zhiyuantechnology/sona-voxcpm2-malaysian), /app/models/asr
# (zhiyuantechnology/sona-qwen3-asr-manglish). The start command downloads voice/src/ of the HF dataset to /workspace/src.
# Kept clips land in $BT_CHECKPOINT_DIR/voice, which Baseten syncs back.
# RESUME=1 skips speaking: it fetches an earlier job's clips by the signed URLs in voice/src/urls.jsonl
# (from `baseten train checkpoint files`) and only reads them back.
set -euo pipefail
SRC=/workspace/src/voice/src; OUT="${BT_CHECKPOINT_DIR:-/workspace/ckpt}/voice"; mkdir -p "$OUT"

if [ "${RESUME:-}" = 1 ]; then
  python3 - "$OUT" <<'EOF'
import json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from huggingface_hub import hf_hub_download
out = sys.argv[1]
rows = [json.loads(l) for l in open(hf_hub_download("zhiyuantechnology/sona-minicpmo-data", "voice/src/urls.jsonl", repo_type="dataset", token=os.environ["HF_TOKEN"]))]
def get(r):
    path = os.path.join(out, r["name"].removeprefix("voice/")); os.makedirs(os.path.dirname(path), exist_ok=True)
    for attempt in range(6):  # S3 answers 503 (slow down) now and then
        try: return urllib.request.urlretrieve(r["url"], path)
        except Exception:
            if attempt == 5: raise
            time.sleep(2 ** attempt)
with ThreadPoolExecutor(16) as pool: list(pool.map(get, rows))
print("fetched", len(rows), flush=True)
EOF
else
  # The voice venv exactly as packages/infra/baseten/voice/config.yaml builds it: Nano-vLLM-VoxCPM needs flash-attn,
  # whose prebuilt wheels stop at torch 2.9, so it gets its own torch 2.8.
  python3 -m pip install -q virtualenv
  python3 -m virtualenv -q /opt/tts && /opt/tts/bin/pip install -q torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128
  ABI=$(/opt/tts/bin/python -c "import torch; print(str(torch._C._GLIBCXX_USE_CXX11_ABI).upper())")
  /opt/tts/bin/pip install -q "https://github.com/Dao-AILab/flash-attention/releases/download/v2.8.3.post1/flash_attn-2.8.3.post1+cu12torch2.8cxx11abi${ABI}-cp312-cp312-linux_x86_64.whl"
  printf 'torch==2.8.0\ntorchaudio==2.8.0\ntorchcodec==0.7.0\n' > /tmp/tts-pins.txt
  /opt/tts/bin/pip install -q -c /tmp/tts-pins.txt nano-vllm-voxcpm==2.0.4 soundfile
  # The lines may still be being written when the job starts (setup overlaps lines.py): wait for them.
  until python3 -c "import os; from huggingface_hub import hf_hub_download; hf_hub_download('zhiyuantechnology/sona-minicpmo-data', 'voice/src/lines.jsonl', repo_type='dataset', local_dir='/workspace/src', token=os.environ['HF_TOKEN'])" 2>/dev/null; do sleep 60; done
  /opt/tts/bin/python "$SRC/speak.py" "$SRC/lines.jsonl" "$OUT"
fi

# Read every clip back with the Manglish ASR through qwen-asr, the code tools/omni-eval/score.py scores with (vLLM's
# transcription route in this image would not load audio: "Please install vllm[audio]", even with librosa and soundfile).
python3 -m pip install -q virtualenv
python3 -m virtualenv -q /opt/asr && /opt/asr/bin/pip install -q torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128
/opt/asr/bin/pip install -q qwen-asr==0.0.6
/opt/asr/bin/python "$SRC/hear.py" "$OUT"

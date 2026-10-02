#!/bin/bash
# MiniCPM-o 4.5 LoRA (brain + ear + eyes) on Baseten H100s with LLaMA-Factory (docs/minicpm-o-finetune.md). On several
# GPUs llamafactory-cli runs DDP by itself; the effective batch stays 16.
# The job's start command downloads this recipe from the private HF dataset zhiyuantechnology/sona-minicpmo-data (recipe/)
# and runs it. Base weights are mounted at /app/models/MiniCPM-o-4_5 (hf://openbmb/MiniCPM-o-4_5@503e754).
# Env: MODE smoke|full|stage2 (smoke: 20 steps on 200 sona-manglish-asr clips, to prove the setup end to end; stage2: new
#      sets plus a replay of stage 1's, data.py), FROM (a sona-minicpmo branch to continue from, e.g. stage1),
#      EAR 1|0 (1 also trains the ear: freeze_vision_tower false), EPOCHS (default 1), TRANSFORMERS (pin, default 4.56.2),
#      LORA_TARGET (default q_proj,v_proj; stage3 adds k/o and the MLP, where facts live), LORA_RANK (default 32).
set -euo pipefail
MODE="${MODE:-smoke}"; EAR="${EAR:-1}"; EPOCHS="${EPOCHS:-1}"; TF="${TRANSFORMERS:-4.56.2}"
BASE=/app/models/MiniCPM-o-4_5; W=/workspace; OUT="${BT_CHECKPOINT_DIR:-$W/ckpt}/$MODE"; R=$(cd "$(dirname "$0")" && pwd)
# repo revision dir ignore...: not the hf CLI, whose --exclude takes one pattern from huggingface_hub 1.0 (the rest
# became file names, so only those downloaded)
fetch() { python -c 'import sys; from huggingface_hub import snapshot_download as d
d(sys.argv[1], revision=sys.argv[2], local_dir=sys.argv[3], ignore_patterns=sys.argv[4:])' "$@" > /dev/null; }
if [ -n "${FROM:-}" ]; then  # continue from one of our stages (MODE=stage2 FROM=stage1): its merged weights are the base
  BASE=$W/from
  fetch zhiyuantechnology/sona-minicpmo "$FROM" "$BASE" "lora-adapter/*" "assets/*.mp4" "assets/*.mp3" "assets/*.png" ".*"
  test -f "$BASE/config.json"  # never fall back to the base model below
fi
if [ ! -f "$BASE/config.json" ]; then  # no Baseten weight mount: fetch the same pinned revision ourselves
  BASE=$W/base
  fetch openbmb/MiniCPM-o-4_5 503e754207c94da6bb26850b4469f367c9ea3582 "$BASE" "*.mp4" "*.mp3" "*.png" "assets/audio_cases/*"
fi
# Training reads a symlinked copy whose one Whisper line works on both transformers APIs: up to 4.53 self_attn returns
# (out, weights, cache), from 4.55 (out, weights), and LLaMA-Factory needs >= 4.55. restore.py puts the original code back.
ORIG=$BASE; BASE=$W/base-train; mkdir -p "$BASE"
for f in "$ORIG"/*; do ln -sfn "$f" "$BASE/$(basename "$f")"; done
rm "$BASE/modeling_minicpmo.py"; cp "$ORIG/modeling_minicpmo.py" "$BASE/"
python - "$BASE/modeling_minicpmo.py" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
for old, new in [
    ("hidden_states, attn_weights, past_key_values = self.self_attn(", "hidden_states, attn_weights, *_ = self.self_attn("),
    # PEFT's wrapper passes input_ids, inputs_embeds (and may pass position_ids) as None beside data; forward sets
    # those three itself when it calls the LLM, so the copies would arrive twice.
    ("    def forward(self, data, **kwargs):\n", "    def forward(self, data, **kwargs):\n        for k in (\"input_ids\", \"inputs_embeds\", \"position_ids\"): kwargs.pop(k, None)\n"),
]:
    assert s.count(old) == 1, (old, s.count(old))
    s = s.replace(old, new)
open(p, "w").write(s)
PY
echo "base model at $ORIG (training copy $BASE); outputs to $OUT"

apt-get update -qq && apt-get install -y -qq git ffmpeg > /dev/null
git clone -q https://github.com/hiyouga/LlamaFactory.git $W/lf && git -C $W/lf checkout -q ce9dc9e072f80fa3abe0989d4ab90da25f083438
pip install -q -e "$W/lf" "transformers==$TF" librosa soundfile "datasets<=4.0.0" huggingface_hub
python -c "import transformers, torch; print('transformers', transformers.__version__, 'torch', torch.__version__)"

python "$R/data.py" "$MODE" "$W/data"   # writes $W/data/dataset_info.json, one JSON per set, audio/
NGPU=$(python -c "import torch; print(torch.cuda.device_count())")
cat > $W/train.yaml <<EOF
model_name_or_path: $BASE
trust_remote_code: true
stage: sft
do_train: true
finetuning_type: lora
lora_target: ${LORA_TARGET:-q_proj,v_proj}
lora_rank: ${LORA_RANK:-32}
lora_alpha: $((2 * ${LORA_RANK:-32}))
lora_dropout: 0.05
freeze_vision_tower: $([ "$EAR" = 1 ] && echo false || echo true)
dataset: $(python -c "import json; print(','.join(json.load(open('$W/data/dataset_info.json'))))")
dataset_dir: $W/data
template: minicpm_o
cutoff_len: 3072
preprocessing_num_workers: 8
# One batch per worker: a worker types each column from its first batch, so a worker whose first rows were text-only
# typed images null and failed on the image replay behind them (stage 2, 2 Oct).
preprocessing_batch_size: 100000
output_dir: $OUT/lora
logging_steps: 5
save_steps: 200
per_device_train_batch_size: 1
gradient_accumulation_steps: $((16 / NGPU))
# The collator decodes audio and images for every batch: in the main process (no workers) stage 1's H100 sat 69% idle.
dataloader_num_workers: 8
# DDP: a text-only batch never reaches the ear's LoRA weights, and the other ranks wait while rank 0 tokenizes.
ddp_find_unused_parameters: true
ddp_timeout: 7200
# MiniCPM-o writes image slots into the token embeddings in place (get_vllm_embedding, even a dummy image when there
# is none); gradient checkpointing makes those embeddings a leaf that requires grad, which PyTorch refuses. 9B LoRA fits
# an 80 GB H100 without it.
disable_gradient_checkpointing: true
learning_rate: 1.0e-4
num_train_epochs: $EPOCHS
$([ "$MODE" = smoke ] && echo "max_steps: 20")
lr_scheduler_type: cosine
warmup_ratio: 0.03
bf16: true
report_to: none
EOF
cat $W/train.yaml
# One thread per preprocessing worker: 16 workers each starting multi-threaded BLAS/OpenMP on a 16-core box ran the
# audio tokenizer at 2.2 examples/s (full set: ~85 min of an idle H100).
export OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 TOKENIZERS_PARALLELISM=false
cd $W/lf && llamafactory-cli train $W/train.yaml
# PUSH_BRANCH set: save the adapter first, on its own (0.1 GB). Stage 2's merged push hit HF's private storage limit
# (2 Oct) and the finished run went down with the container; FROM's weights plus this adapter rebuild the merged model.
P="${PUSH_REPO:-zhiyuantechnology/sona-minicpmo}"
if [ -n "${PUSH_BRANCH:-}" ]; then
  python "$R/push.py" "$OUT/lora" "$P" "$PUSH_BRANCH" lora-adapter || echo "adapter push failed; the merged push carries it too"
fi

# Merge the LoRA into full weights, then put back what LLaMA-Factory leaves out (it loads MiniCPM-o with init_tts=False).
cat > $W/export.yaml <<EOF
model_name_or_path: $BASE
adapter_name_or_path: $OUT/lora
template: minicpm_o
trust_remote_code: true
export_dir: $OUT/merged
export_size: 5
export_legacy_format: false
EOF
llamafactory-cli export $W/export.yaml
python "$R/restore.py" "$ORIG" "$OUT/merged"
ls -la "$OUT/merged"
# Then the merged model, which box ④ and the next stage's FROM load, with the adapter beside it again (deduplicated).
if [ -n "${PUSH_BRANCH:-}" ]; then
  cp -r "$OUT/lora" "$OUT/merged/lora-adapter"
  python "$R/push.py" "$OUT/merged" "$P" "$PUSH_BRANCH"
fi

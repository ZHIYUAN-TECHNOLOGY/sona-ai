#!/bin/bash
# VoxCPM2 LoRA on Baseten (1x H100). The job's start command downloads the dataset repo to /workspace/data and runs this.
# Env: MODE lora|all (default lora; all = full fine-tune), STEPS (default 1000), SAVE_EVERY (default 500).
# Weights are mounted at /app/models/VoxCPM2.
set -euo pipefail
MODE="${MODE:-lora}"; STEPS="${STEPS:-1000}"; SAVE_EVERY="${SAVE_EVERY:-500}"
DATA=/workspace/data; SRC=/workspace/voxcpm; OUT="${BT_CHECKPOINT_DIR:-/workspace/ckpt}/$MODE"

apt-get update -qq && apt-get install -y -qq ffmpeg > /dev/null   # torchcodec needs the ffmpeg libraries
python3 - <<'EOF'   # VoxCPM at a pinned commit (no git in the image)
import io, tarfile, urllib.request
sha = "f772e49"
tarfile.open(fileobj=io.BytesIO(urllib.request.urlopen(f"https://codeload.github.com/OpenBMB/VoxCPM/tar.gz/{sha}").read())).extractall("/workspace")
import glob, os; os.rename(glob.glob("/workspace/VoxCPM-*")[0], "/workspace/voxcpm")
EOF
# Checkpoints: a full fine-tune save is ~27 GB (9 GB weights + 18 GB optimizer) and the stock script also saves at
# step 0, at num_iters-1 and again at the end, and copies each save into latest/. Keep only interval saves after
# step 0 plus the final one, without optimizer state or latest/ copies (we never resume these runs).
sed -i -e 's/if (step % save_interval == 0 or step == num_iters - 1) and accelerator.rank == 0:/if step > 0 and step % save_interval == 0 and accelerator.rank == 0:/' \
       -e 's/^    torch.save(optimizer.state_dict(), folder \/ "optimizer.pth")/    pass  # optimizer state not saved/' \
       -e 's/^        shutil.copytree(folder, latest_link)/        pass  # no latest\/ copy/' "$SRC/scripts/train_voxcpm_finetune.py"
grep -n "step > 0 and step % save_interval\|optimizer state not saved\|no latest" "$SRC/scripts/train_voxcpm_finetune.py"
SETUPTOOLS_SCM_PRETEND_VERSION_FOR_VOXCPM=2.0.3 pip install -q -e "$SRC" tensorboardX   # tarball has no .git for setuptools-scm

python3 - "$DATA" <<'EOF'   # manifest with absolute audio paths
import json, sys
d = sys.argv[1]
rows = [json.loads(l) for l in open(f"{d}/train.jsonl")]
open(f"{d}/train_abs.jsonl", "w").write("\n".join(json.dumps({**r, "audio": f"{d}/{r['audio']}"}, ensure_ascii=False) for r in rows))
print("clips", len(rows))
EOF

sed -e "s#/path/to/VoxCPM2/#/app/models/VoxCPM2/#" -e "s#/path/to/train.jsonl#$DATA/train_abs.jsonl#" \
    -e "s#/path/to/checkpoints/finetune_$MODE#$OUT#" -e "s#/path/to/logs/finetune_$MODE#$OUT/tb#" \
    -e "s#^num_iters: .*#num_iters: $STEPS#" -e "s#^max_steps: .*#max_steps: $STEPS#" \
    -e "s#^save_interval: .*#save_interval: $SAVE_EVERY#" -e "s#^valid_interval: .*#valid_interval: $SAVE_EVERY#" \
    -e "s#^num_workers: .*#num_workers: 4#" -e "s#^warmup_steps: .*#warmup_steps: $(( STEPS < 100 ? STEPS / 5 : 100 ))#" \
    "$SRC/conf/voxcpm_v2/voxcpm_finetune_$MODE.yaml" > /workspace/train.yaml
cat /workspace/train.yaml
cd "$SRC" && python3 scripts/train_voxcpm_finetune.py --config_path /workspace/train.yaml
ls -la "$OUT"

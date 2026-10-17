"""After `llamafactory-cli export`: make the merged MiniCPM-o loadable with its voice, as the base model is.

LLaMA-Factory loads MiniCPM-o with init_tts=False, so the merged weights lack the talker (tts.*) and its config says
init_tts false. This copies the base model's tts.* tensors in as their own shard, turns init_tts back on, and copies the
remote code, processor files and assets (token2wav) that the export leaves behind.
Usage: python restore.py <base_dir> <merged_dir>
"""
import json, shutil, sys
from pathlib import Path

from safetensors import safe_open
from safetensors.torch import save_file

base, merged = Path(sys.argv[1]), Path(sys.argv[2])

index = json.loads((base / "model.safetensors.index.json").read_text())
tts = {}
for name, shard in index["weight_map"].items():
    if name.startswith("tts."):
        with safe_open(base / shard, "pt") as f:
            tts[name] = f.get_tensor(name)
assert tts, "no tts.* weights in the base model"
save_file(tts, merged / "model-tts.safetensors", metadata={"format": "pt"})

mi = merged / "model.safetensors.index.json"
m = json.loads(mi.read_text())
assert not any(k.startswith("tts.") for k in m["weight_map"]), "merged model already has tts.* weights"
m["weight_map"].update({k: "model-tts.safetensors" for k in tts})
mi.write_text(json.dumps(m, indent=2))

cfg = json.loads((merged / "config.json").read_text())
cfg["init_tts"] = True
(merged / "config.json").write_text(json.dumps(cfg, indent=2))

for f in base.iterdir():  # the original remote code (training ran a patched copy), and whatever the export did not write
    if f.suffix == ".py" or (f.suffix != ".safetensors" and f.name != "model.safetensors.index.json" and not (merged / f.name).exists()):
        if (merged / f.name).is_dir(): shutil.rmtree(merged / f.name)
        (shutil.copytree if f.is_dir() else shutil.copy2)(f, merged / f.name)
print(f"restored {len(tts)} tts tensors; init_tts on; files: {sorted(p.name for p in merged.iterdir())}")

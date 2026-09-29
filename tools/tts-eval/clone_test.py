"""VoxCPM2 voice cloning from a real Kore clip (same language as the line) for the 20 listening sentences.

refs: ~/zyt/data/sona-tts/clone_refs.json {lang: {audio, text}}. Writes <out>/<id>.wav.
~/zyt/venvs/voxcpm/bin/python clone_test.py <out dir> [LoRA checkpoint dir]
"""
import json, sys
from pathlib import Path
import soundfile as sf
from voxcpm import VoxCPM

DATA = Path.home() / "zyt/data/sona-tts"
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
lora = sys.argv[2] if len(sys.argv) > 2 else None
kw, base = {}, "openbmb/VoxCPM2"
if lora and (Path(lora) / "model.safetensors").exists(): base, lora = lora, None  # full fine-tune checkpoint
if lora:
    from voxcpm.model.voxcpm2 import LoRAConfig
    kw = {"lora_config": LoRAConfig(**json.load(open(Path(lora) / "lora_config.json"))["lora_config"]), "lora_weights_path": lora}
model = VoxCPM.from_pretrained(base, load_denoiser=False, optimize=False, device="mps", **kw)
refs = json.load(open(DATA / "clone_refs.json"))
for line in (DATA / "listen/lines.txt").read_text().splitlines():
    name, text = line.split("\t"); ref = refs[name[:2]]
    wav = model.generate(text=text, prompt_wav_path=ref["audio"], prompt_text=ref["text"], cfg_value=2.0, inference_timesteps=10)
    sf.write(out / name, wav, model.tts_model.sample_rate); print(name, flush=True)

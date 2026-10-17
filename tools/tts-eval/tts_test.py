"""VoxCPM2 as-is reads every glossary term (terms.json) in a short single-language reply, English, Malay and Chinese.

Writes $TTS_EVAL_DIR (default ~/zyt/data/sona-tts) /audio/<lang>_<nn>.wav and manifest.jsonl; score with score.py.
Run with the VoxCPM venv:  ~/zyt/venvs/voxcpm/bin/python tts_test.py [LoRA checkpoint dir]
With a LoRA checkpoint (a step_* dir holding lora_weights.safetensors + lora_config.json) the voice comes from the
LoRA, so no voice description is prepended; point TTS_EVAL_DIR at a separate folder for each checkpoint.
"""
import json, os, sys
from pathlib import Path
import soundfile as sf
from voxcpm import VoxCPM

OUT = Path(os.environ.get("TTS_EVAL_DIR", Path.home() / "zyt/data/sona-tts")); (OUT / "audio").mkdir(parents=True, exist_ok=True)
VOICE = "(A Malaysian woman in her thirties, warm and clear hospital nurse voice, moderate pace)"
g = json.load(open(Path(__file__).parent / "terms.json"))
lora = sys.argv[1] if len(sys.argv) > 1 else None
if lora and (Path(lora) / "model.safetensors").exists():  # full fine-tune checkpoint: load it as the model itself
    VOICE = ""
    model = VoxCPM.from_pretrained(lora, load_denoiser=False, optimize=False, device="mps")
elif lora:
    from voxcpm.model.voxcpm2 import LoRAConfig
    VOICE = ""
    cfg = LoRAConfig(**json.load(open(Path(lora) / "lora_config.json"))["lora_config"])
    model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="mps", lora_config=cfg, lora_weights_path=lora)
else:
    model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="mps")
rows = []
for i, term in enumerate(g["terms"]):
    for lang in ("en", "ms", "zh"):
        text = g["templates"][term["kind"]][lang][i % 3].format(t=term[lang])
        p = OUT / "audio" / f"{lang}_{i:02d}.wav"
        if not p.exists():
            sf.write(p, model.generate(text=VOICE + text, cfg_value=2.0, inference_timesteps=10), model.tts_model.sample_rate)
        rows.append({"id": p.stem, "lang": lang, "kind": term["kind"], "term": term[lang], "text": text, "audio": str(p)})
    print(i + 1, "/", len(g["terms"]), flush=True)
(OUT / "manifest.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows))

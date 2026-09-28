"""Package usable clips as a Hugging Face audio dataset: train (clean + one random scene each) and test (clean + noisy)."""
import glob, json, random
from pathlib import Path
import numpy as np, soundfile as sf, librosa
from voice import AUDIO, DATA
import augment

bad = set((DATA / "bad.txt").read_text().split()) if (DATA / "bad.txt").exists() else set()
split = {c["id"]: c["split"] for f in glob.glob(str(Path(__file__).parent / "scripts/*/*.json")) for c in json.load(open(f))}
clips = sorted(p for p in AUDIO.glob("*.wav") if p.stem not in bad)
out = DATA / "dataset"; (out / "audio").mkdir(parents=True, exist_ok=True)
pool = [str(p) for p in clips[::7]]
random.seed(1); np.random.seed(1)
rows = {"train": [], "test": [], "test_noisy": []}
for p in clips:
    conv = p.stem.rsplit("_", 1)[0]; text = p.with_suffix(".txt").read_text().strip()
    x = librosa.load(p, sr=16000)[0]
    s = split.get(conv, "train")
    clean = out / "audio" / f"{p.stem}.wav"; sf.write(clean, x, 16000)
    rows["train" if s == "train" else "test"].append({"id": p.stem, "audio": str(clean), "text": text, "scene": "clean"})
    kind = random.choice(["waiting_room", "ac_room", "phone", "quiet"])
    noisy = out / "audio" / f"{p.stem}_{kind}.wav"; sf.write(noisy, augment.scene(x, kind, pool), 16000)
    rows["train" if s == "train" else "test_noisy"].append({"id": f"{p.stem}_{kind}", "audio": str(noisy), "text": text, "scene": kind})
for k, v in rows.items():
    (out / f"{k}.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in v))
    print(k, len(v))

"""A second reading of speaker_gen.py's arms, with the two voiceprint models that told real strangers apart best
(tools/diar-eval/voiceprint.py: CAM++ zh-en and WeSpeaker ResNet34), and pitch over voiced frames only.

What a listener hears is one sentence against the next, so per arm: the cosine between every two sentences of the same
answer (mean, 5th percentile, lowest), the answers whose lowest pair falls under the level 2% of all arms' pairs fall
under, and the sentences whose pitch is more than 15% from the arm's median.

  ~/zyt/venvs/voiceprint/bin/python tools/tts-eval/speaker_prints.py
"""
import itertools, json, sys
from pathlib import Path

import librosa, numpy as np

sys.path.insert(0, str(Path(__file__).parents[1] / "diar-eval"))
from voiceprint import campplus, wespeaker

OUT = Path.home() / "zyt/data/sona-tts/speaker"
arms = sorted(d.name for d in OUT.iterdir() if d.is_dir())
models = {"campplus": campplus()[0], "wespeaker": wespeaker()[0]}


def pitch(x):
    f0, voiced, _ = librosa.pyin(x, fmin=80, fmax=400, sr=16000, frame_length=1024)
    return float(np.nanmedian(f0[voiced])) if voiced.any() else float("nan")


rows = {}
for arm in arms:
    for wav in sorted((OUT / arm).glob("*.wav")):
        x, _ = librosa.load(wav, sr=16000)
        x, _ = librosa.effects.trim(x, top_db=35)
        prints = {m: (e := np.asarray(f(x), dtype=np.float32).ravel()) / np.linalg.norm(e) for m, f in models.items()}
        rows[(arm, wav.stem)] = {"answer": wav.stem.rsplit("_", 1)[0], "pitch": pitch(x), **prints}
    print(arm, "read", flush=True)

pairs = {m: {arm: {} for arm in arms} for m in models}
for m in models:
    for arm in arms:
        by = {}
        for (a, stem), r in rows.items():
            if a == arm: by.setdefault(r["answer"], []).append((stem, r[m]))
        for answer, said in by.items():
            pairs[m][arm][answer] = [(float(u @ v), s, t) for (s, u), (t, v) in itertools.combinations(said, 2)]
report = {}
for m in models:
    floor = float(np.quantile([c for arm in arms for ps in pairs[m][arm].values() for c, *_ in ps], 0.02))
    print(f"\n{m}: a pair under {floor:.2f} is in the lowest 2% of all arms")
    for arm in arms:
        cs = np.array([c for ps in pairs[m][arm].values() for c, *_ in ps])
        low = sorted((min(ps)[0], a, min(ps)[1], min(ps)[2]) for a, ps in pairs[m][arm].items() if min(ps)[0] < floor)
        report.setdefault(arm, {})[m] = {"mean": round(float(cs.mean()), 3), "p5": round(float(np.quantile(cs, .05)), 3), "min": round(float(cs.min()), 3), "low_answers": [list(l) for l in low]}
        print(f"  {arm:12} mean {cs.mean():.3f}  p5 {np.quantile(cs, .05):.3f}  min {cs.min():.3f}  answers with a low pair: {len(low)} of {len(pairs[m][arm])}  {[l[1] for l in low]}")
print("\npitch over voiced frames")
for arm in arms:
    p = {stem: r["pitch"] for (a, stem), r in rows.items() if a == arm}
    med = float(np.nanmedian(list(p.values())))
    off = sorted(s for s, v in p.items() if abs(v - med) / med > 0.15)
    report[arm]["pitch"] = {"median": round(med, 1), "off": off}
    print(f"  {arm:12} median {med:.0f} Hz  p5-p95 {np.nanquantile(list(p.values()), .05):.0f}-{np.nanquantile(list(p.values()), .95):.0f}  more than 15% off: {len(off)}  {off}")
(OUT / "prints.json").write_text(json.dumps(report, indent=1))

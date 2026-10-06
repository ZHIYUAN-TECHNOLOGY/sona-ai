"""Scores speaker_gen.py's two arms: is every sentence of an answer the same speaker?

Per sentence: cosine of its WavLM voiceprint (microsoft/wavlm-base-plus-sv) to the anchor's and to its own arm's
centroid, and its median pitch (librosa.yin, 60-400 Hz). The voiceprint model rates some different synthetic voices
as similar, so a sentence is "off-speaker" when its cosine to the centroid is below 0.80 OR its pitch is more than
20% from the arm's median pitch. The centroid includes the sentence itself, which flatters every arm a little.
Seconds per sentence are kept too, so a reference that truncates or stretches the audio shows up.
Prints one row per arm and writes ~/zyt/data/sona-tts/speaker/scores.json with every off-speaker file to listen to.
Run with the diar venv:  ~/zyt/venvs/diar/bin/python speaker_score.py [anchor wav]
"""
import json, sys
from pathlib import Path
import librosa, numpy as np, torch
from transformers import AutoFeatureExtractor, WavLMForXVector

DATA = Path.home() / "zyt/data/sona-tts"
ANCHOR = Path(sys.argv[1]) if len(sys.argv) > 1 else DATA / "kore/audio/family_048_00.wav"
COS_MIN, PITCH_TOL = 0.80, 0.20
fe = AutoFeatureExtractor.from_pretrained("microsoft/wavlm-base-plus-sv")
sv = WavLMForXVector.from_pretrained("microsoft/wavlm-base-plus-sv").eval()


def measure(path):
    """Unit-length voiceprint, median pitch in Hz and length in seconds of one clip."""
    y, _ = librosa.load(path, sr=16000)
    with torch.no_grad():
        e = sv(**fe(y, sampling_rate=16000, return_tensors="pt")).embeddings[0].numpy()
    return e / np.linalg.norm(e), float(np.median(librosa.yin(y, fmin=60, fmax=400, sr=16000))), len(y) / 16000


anchor, anchor_pitch, _ = measure(ANCHOR)
report = {"anchor": str(ANCHOR), "anchor_pitch_hz": round(anchor_pitch, 1), "arms": {}}
print(f"anchor {ANCHOR.name} pitch {anchor_pitch:.0f} Hz")
print("arm   n  cos-centroid mean/min  cos-anchor mean  pitch median (p5-p95)  secs mean (min-max)  off sentences  off answers")
for arm in ("none", "ref"):
    files = sorted((DATA / "speaker" / arm).glob("*.wav"))
    if not files:
        continue
    embs, pitch, secs = map(np.array, zip(*(measure(f) for f in files)))
    centroid = embs.mean(0); centroid /= np.linalg.norm(centroid)
    cos_c, cos_a, med = embs @ centroid, embs @ anchor, float(np.median(pitch))
    off = (cos_c < COS_MIN) | (np.abs(pitch / med - 1) > PITCH_TOL)
    rows = [{"file": str(f), "cos_centroid": round(float(c), 3), "cos_anchor": round(float(a), 3), "pitch_hz": round(float(p), 1),
             "secs": round(float(s), 2), "off": bool(o)} for f, c, a, p, s, o in zip(files, cos_c, cos_a, pitch, secs, off)]
    off_answers = sorted({Path(r["file"]).stem.rsplit("_", 1)[0] for r in rows if r["off"]})
    report["arms"][arm] = {"n": len(rows), "cos_centroid_mean": round(float(cos_c.mean()), 3), "cos_centroid_min": round(float(cos_c.min()), 3),
                           "cos_anchor_mean": round(float(cos_a.mean()), 3), "pitch_median_hz": round(med, 1),
                           "pitch_p5_p95_hz": [round(float(np.percentile(pitch, q)), 1) for q in (5, 95)],
                           "secs_mean_min_max": [round(float(x), 2) for x in (secs.mean(), secs.min(), secs.max())],
                           "off_sentences": int(off.sum()), "off_answers": off_answers, "answers": len({Path(r["file"]).stem.rsplit("_", 1)[0] for r in rows}),
                           "off_files": [r for r in rows if r["off"]], "sentences": rows}
    a = report["arms"][arm]
    print(f"{arm:5} {a['n']:2}  {a['cos_centroid_mean']:.3f} / {a['cos_centroid_min']:.3f}        {a['cos_anchor_mean']:.3f}            "
          f"{med:.0f} Hz ({a['pitch_p5_p95_hz'][0]:.0f}-{a['pitch_p5_p95_hz'][1]:.0f})       {secs.mean():.1f} ({secs.min():.1f}-{secs.max():.1f})        "
          f"{a['off_sentences']:2}             {len(off_answers)} / {a['answers']}")
    for r in a["off_files"]:
        print(f"   off: {Path(r['file']).name}  cos {r['cos_centroid']:.2f}  pitch {r['pitch_hz']:.0f} Hz  {r['secs']:.1f} s")
(DATA / "speaker/scores.json").write_text(json.dumps(report, indent=1))

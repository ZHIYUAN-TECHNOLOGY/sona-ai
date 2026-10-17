"""Which three clips of the training voice, one per language, sound most like one woman? Her voice is spoken from a
reference clip in the line's language (packages/infra/baseten/voice/data/anchors), and the first three were picked
without listening for that. Over clips of 6-10 s in one language only: how alike her own clips are within a language
and across two (is the source voice itself one woman?), the three in use, and the three with the highest lowest
likeness between any two, by two voiceprint models together (tools/diar-eval/voiceprint.py).

  ~/zyt/venvs/voiceprint/bin/python tools/tts-eval/anchors.py [clips per language]
"""
import itertools, json, random, re, sys
from pathlib import Path

import librosa, numpy as np, soundfile as sf

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "diar-eval")); sys.path.insert(0, str(HERE.parents[1] / "packages/infra/baseten/voice/data"))
from spoken import lang_of
from voiceprint import campplus, wespeaker

KORE = Path.home() / "zyt/data/sona-tts/kore"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 120
models = [campplus()[0], wespeaker()[0]]


def one_language(text):
    """The language of a line written in one language only (a Manglish line is no use as a reference)."""
    han, latin = len(re.findall(r"[一-鿿]", text)), len(re.findall(r"[A-Za-z]", text))
    return "zh" if han and not latin else None if han else lang_of(text)


def prints(path):
    x, _ = librosa.load(path, sr=16000)
    x, _ = librosa.effects.trim(x, top_db=35)
    return [(e := np.asarray(m(x), dtype=np.float32).ravel()) / np.linalg.norm(e) for m in models]


rng, by = random.Random(5), {"en": [], "ms": [], "zh": []}
rows = [json.loads(l) for l in (KORE / "train.jsonl").read_text().splitlines()]
rng.shuffle(rows)
for r in rows:
    lang = one_language(r["text"])
    if lang and len(by[lang]) < N and 6 <= sf.info(KORE / r["audio"]).duration <= 10: by[lang].append(r)
E = {lang: [np.array(e) for e in zip(*(prints(KORE / r["audio"]) for r in clips))] for lang, clips in by.items()}  # per model: clips x dim
print({lang: len(c) for lang, c in by.items()}, "clips")
like = lambda a, b: np.mean([x @ y.T for x, y in zip(E[a], E[b])], axis=0)  # the two models' cosines, averaged
for a, b in (("en", "en"), ("ms", "ms"), ("zh", "zh"), ("en", "ms"), ("en", "zh"), ("ms", "zh")):
    c = like(a, b); c = c[np.triu_indices(len(c), 1)] if a == b else c.ravel()
    print(f"her own clips, {a} with {b}: mean {c.mean():.3f}  5th percentile {np.quantile(c, .05):.3f}")
now = {lang: prints(HERE.parents[1] / f"packages/infra/baseten/voice/data/anchors/{lang}.wav") for lang in by}
print("in use now:", {f"{a}-{b}": round(float(np.mean([x @ y for x, y in zip(now[a], now[b])])), 3) for a, b in itertools.combinations(by, 2)})
em, ez, mz = like("en", "ms"), like("en", "zh"), like("ms", "zh")
low = np.minimum(np.minimum(em[:, :, None], ez[:, None, :]), mz[None, :, :])
i, j, k = np.unravel_index(low.argmax(), low.shape)
print(f"best three: lowest likeness {low.max():.3f} (en-ms {em[i, j]:.3f}, en-zh {ez[i, k]:.3f}, ms-zh {mz[j, k]:.3f})")
for lang, n in (("en", i), ("ms", j), ("zh", k)): print(" ", lang, by[lang][n]["audio"], "|", by[lang][n]["text"])

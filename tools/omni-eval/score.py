"""Our Manglish ASR (mixed-final) reads the clips a test made and counts word errors against each row's text.

roundtrip.py rows: the clip before (`orig`) and after (`resynth`) MiniCPM-o's speech tokens, against the reference text.
speak.py rows: only what MiniCPM-o said (`resynth`), against the text it wrote.
Pass rule for the token check, fixed before any result: Malay passes when, for Sona's voice and for FLEURS, the error
rate rises by no more than 5 points or 1.5 times the English rise, whichever is larger.
Needs `qwen-asr==0.0.6`. Usage: python score.py <out_dir>
"""
import json, re, sys
from pathlib import Path

import librosa, torch
from qwen_asr import Qwen3ASRModel

DATA = Path.home() / "zyt/data"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else DATA / "sona-omni/malay-check"


def toks(s):  # as tools/asr-data/baseline.py: Chinese characters and words
    return re.findall(r"[一-鿿]|[a-z0-9]+(?:[-'][a-z0-9]+)*", s.lower())


def ed(a, b):
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, y in enumerate(b, 1): p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (x != y))
    return d[-1]


m = Qwen3ASRModel.from_pretrained(str(DATA / "sona-asr/ckpt/mixed-final"), dtype=torch.float32, device_map="mps")
hear = lambda p: m.transcribe((librosa.load(p, sr=16000)[0], 16000))[0].text
rows, sets = [], {}
for line in (OUT / "manifest.jsonl").read_text().splitlines():
    r = json.loads(line)
    ref = toks(r["text"])
    r["hyp_resynth"] = hear(r["resynth"])
    r["err_resynth"], r["words"] = ed(ref, toks(r["hyp_resynth"])), len(ref)
    if r.get("orig"):
        r["hyp_orig"] = hear(r["orig"])
        r["err_orig"] = ed(ref, toks(r["hyp_orig"]))
    torch.mps.empty_cache()
    rows.append(r)
    s = sets.setdefault(r["set"], [0, 0, 0])
    s[0] += r.get("err_orig", 0); s[1] += r["err_resynth"]; s[2] += r["words"]
(OUT / "scored.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows))

rate = {k: (o / n, x / n) for k, (o, x, n) in sets.items()}
for k, (o, x) in rate.items():
    clips = sum(r["set"] == k for r in rows)
    if any(r["set"] == k and r.get("orig") for r in rows):
        print(f"{k:14} original {o:6.1%}  after tokens {x:6.1%}  rise {x - o:+6.1%}  ({clips} clips)")
    else:
        print(f"{k:14} spoken vs its own text: {x:6.1%} word errors  ({clips} clips)")
verdict = {}
for src in ("sona", "fleurs"):
    if f"ms_{src}" not in rate or f"en_{src}" not in rate: continue  # a partial or speak run has no pair here
    rise_ms = rate[f"ms_{src}"][1] - rate[f"ms_{src}"][0]
    rise_en = rate[f"en_{src}"][1] - rate[f"en_{src}"][0]
    verdict[src] = rise_ms <= max(0.05, 1.5 * rise_en)
    print(f"Malay vs English ({src}): rise {rise_ms:+.1%} against limit {max(0.05, 1.5 * rise_en):.1%}: {'PASS' if verdict[src] else 'FAIL'}")
if verdict: print("MALAY TOKEN CHECK:", "PASS" if all(verdict.values()) else "FAIL")
(OUT / "summary.json").write_text(json.dumps({"rates": rate, "verdict": verdict}, indent=2))

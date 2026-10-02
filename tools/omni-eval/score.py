"""Our Manglish ASR (mixed-final) reads the clips a test made and counts word errors against each row's text.

roundtrip.py rows: the clip before (`orig`) and after (`resynth`) MiniCPM-o's speech tokens, against the reference text.
speak.py rows: only what MiniCPM-o said (`resynth`), against the text it wrote.
Pass rule for the token check, fixed before any result: Malay passes when, for Sona's voice and for FLEURS, the error
rate rises by no more than 5 points or 1.5 times the English rise, whichever is larger.
Needs `qwen-asr==0.0.6`. Usage: python score.py <out_dir>   (env BATCH: clips per ASR call, default 8)
scored.jsonl grows a row per clip as it goes, and a rerun skips rows already there: a stopped run resumes (2 Oct, a
2,000-clip run stopped at 2 h lost everything when it only wrote at the end).
"""
import json, os, re, sys
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
def hear(paths):
    return [t.text for t in m.transcribe([(librosa.load(p, sr=16000)[0], 16000) for p in paths])]


BATCH, scored = int(os.environ.get("BATCH", 8)), OUT / "scored.jsonl"
done = {json.loads(l)["key"] for l in scored.read_text().splitlines() if l.strip()} if scored.exists() else set()
if scored.exists() and not scored.read_text().endswith("\n"): scored.write_text(scored.read_text() + "\n")  # a whole-file write
todo = [r for r in map(json.loads, (OUT / "manifest.jsonl").read_text().splitlines()) if r["key"] not in done]
with open(scored, "a") as log:
    for i in range(0, len(todo), BATCH):
        batch = todo[i:i + BATCH]
        for r, hyp in zip(batch, hear([r["resynth"] for r in batch])):
            ref = toks(r["text"])
            r["hyp_resynth"], r["err_resynth"], r["words"] = hyp, ed(ref, toks(hyp)), len(ref)
        origs = [r for r in batch if r.get("orig")]
        for r, hyp in zip(origs, hear([r["orig"] for r in origs]) if origs else []):
            r["hyp_orig"], r["err_orig"] = hyp, ed(toks(r["text"]), toks(hyp))
        torch.mps.empty_cache()
        log.write("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in batch)); log.flush()
rows, sets = [json.loads(l) for l in scored.read_text().splitlines() if l.strip()], {}
for r in rows:
    s = sets.setdefault(r["set"], [0, 0, 0])
    s[0] += r.get("err_orig", 0); s[1] += r["err_resynth"]; s[2] += r["words"]

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

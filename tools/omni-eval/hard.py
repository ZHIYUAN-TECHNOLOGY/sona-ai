"""Hard speaking test report (docs/minicpm-o-finetune.md, voice v3 plan): word errors of Sona's speech against the text she
wrote, per category of voice3/test.jsonl, with numbers compared as spoken words (the ASR writes "38" for "thirty-eight").
Run speak.py with SPEAK_LINES=<voice3 test.jsonl> into <dir>, then score.py <dir>, then: python hard.py <dir> [<dir> ...]
"""
import json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "omni-voice"))
from spoken import spoken  # noqa: E402

LANG = {"num_ms": "ms", "num_en": "en", "num_zh": "zh", "num_manglish": "en", "zh_in_latin": "en", "latin_in_zh": "zh", "manglish": "en"}
toks = lambda s: re.findall(r"[一-鿿]|[a-z0-9]+(?:[-'][a-z0-9]+)*", s.lower())


def ed(a, b):
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, y in enumerate(b, 1): p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (x != y))
    return d[-1]


for out in sys.argv[1:]:
    per = {}
    for r in map(json.loads, (Path(out) / "scored.jsonl").read_text().splitlines()):
        lang = LANG.get(r["set"], "en")
        ref, hyp = toks(spoken(r["text"], lang)), toks(spoken(r["hyp_resynth"], lang))
        s = per.setdefault(r["set"], [0, 0, 0, 0]); s[0] += ed(ref, hyp); s[1] += len(ref); s[2] += 1; s[3] += ed(ref, hyp) == 0
    print(out)
    for k, (e, n, clips, exact) in sorted(per.items()):
        print(f"  {k:14} {e / max(n, 1):6.1%} word errors, {exact}/{clips} lines exact")

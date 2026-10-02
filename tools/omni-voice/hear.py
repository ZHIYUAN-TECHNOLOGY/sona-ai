"""Our Manglish ASR (/app/models/asr, the same qwen-asr code tools/omni-eval/score.py uses) reads back every clip
speak.py made. A clip is kept when its word errors against its text are at most 5%; rejected clips move to /workspace,
outside the synced dir. Writes <out>/kept.jsonl and <out>/rejected.jsonl. Usage: python hear.py <out_dir>
"""
import json, re, shutil, sys
from pathlib import Path

import torch
from qwen_asr import Qwen3ASRModel

out = Path(sys.argv[1])


def toks(s):  # as tools/omni-eval/score.py: Chinese characters and words
    return re.findall(r"[一-鿿]|[a-z0-9]+(?:[-'][a-z0-9]+)*", s.lower())


def ed(a, b):
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, y in enumerate(b, 1): p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (x != y))
    return d[-1]


asr = Qwen3ASRModel.from_pretrained("/app/models/asr", dtype=torch.bfloat16, device_map="cuda", max_inference_batch_size=64)
rows = [json.loads(l) for l in (out / "spoken.jsonl").read_text().splitlines()]
checked = []
for i in range(0, len(rows), 512):
    batch = rows[i:i + 512]
    try:
        heard = [t.text.strip() for t in asr.transcribe([str(out / "audio" / r["audio"]) for r in batch])]
    except Exception as e:  # one unreadable clip: read this batch one by one
        print("batch failed, one by one:", e, flush=True)
        heard = []
        for r in batch:
            try: heard.append(asr.transcribe(str(out / "audio" / r["audio"]))[0].text.strip())
            except Exception: heard.append("")
    for r, h in zip(batch, heard):
        ref = toks(r["text"])
        checked.append({**r, "heard": h, "errors": ed(ref, toks(h)), "words": len(ref)})
    print("heard", len(checked), flush=True)

if sum(not r["heard"] for r in checked) > len(checked) / 2:  # a broken ASR, not bad clips: move nothing
    raise SystemExit("most clips got no transcript; check the ASR")
kept, rejected = [], []
for r in checked: (kept if r["errors"] <= 0.05 * max(r["words"], 1) else rejected).append(r)
Path("/workspace/rejected-audio").mkdir(parents=True, exist_ok=True)  # outside the synced checkpoint dir
for r in rejected:
    shutil.move(str(out / "audio" / r["audio"]), f"/workspace/rejected-audio/{r['audio']}")
(out / "kept.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in kept) + "\n")
(out / "rejected.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rejected) + "\n")
for lang in sorted({r["lang"] for r in checked}):
    k = [r for r in kept if r["lang"] == lang]
    print(f"{lang}: kept {len(k)}/{sum(r['lang'] == lang for r in checked)}, {sum(r['seconds'] for r in k) / 3600:.2f} h", flush=True)

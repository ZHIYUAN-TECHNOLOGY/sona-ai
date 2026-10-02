"""How well MiniCPM-o hears real Malaysian speech: the user's recorded medical Manglish lines and real Revolab speech
(tools/asr-data/real_test.py), scored as eval.py and tools/asr-data/baseline.py count (mixed error: words, and Chinese
characters one by one). Runs on the Mac (MPS, fp16). Usage: python hear.py <model dir> [revolab clips, default 100]
"""
import json, random, re, sys
from pathlib import Path

import librosa, torch
from transformers import AutoModel, AutoTokenizer

SETS = Path.home() / "zyt/data/sona-asr/dataset"
repo, n = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 100
model = AutoModel.from_pretrained(repo, trust_remote_code=True, attn_implementation="sdpa", torch_dtype=torch.float16,
                                  init_vision=False, init_audio=True, init_tts=False).eval().to("mps")
tok = AutoTokenizer.from_pretrained(repo, trust_remote_code=True)
toks = lambda s: re.findall(r"[一-鿿]|[a-z0-9]+(?:[-'][a-z0-9]+)*", s.lower())


def ed(a, b):
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, y in enumerate(b, 1): p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (x != y))
    return d[-1]


rows = {"user's voice": [json.loads(l) for l in (SETS / "real_voice.jsonl").read_text().splitlines()],
        "Revolab": random.Random(1).sample([json.loads(l) for l in (SETS / "revolab.jsonl").read_text().splitlines()], n)}
out = {}
for name, rs in rows.items():
    e = w = 0
    for r in rs:
        x = librosa.load(r["audio"], sr=16000)[0]
        hyp = model.chat(msgs=[{"role": "user", "content": [x, "Write down exactly what was said."]}], tokenizer=tok,
                         do_sample=False, max_new_tokens=200)
        e += ed(toks(r["text"]), toks(hyp)); w += len(toks(r["text"]))
        out.setdefault(name, []).append({"ref": r["text"], "hyp": hyp})
    print(f"{name}: {len(rs)} clips, mixed error {100 * e / w:.1f}%", flush=True)
Path(f"hear-{Path(repo).name}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))

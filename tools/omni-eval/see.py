"""Label reading on the Mac: eval.py's 100 held-out label photos, scored per question type (docs/minicpm-o-finetune.md,
run log), optionally with another model's eyes put back (EYES: its vpm.* weights replace the brain's).
  BRAIN=<model dir> [EYES=<model dir>] python see.py out.json
Types: read and what (name and strength said), how (the printed instruction, or that the box has none), plan (judge by
hand: the reply is printed), unreadable (asks for another photo). A readable label called unreadable always fails.
"""
import json, os, random, re, sys
from pathlib import Path

import torch
from PIL import Image
from safetensors import safe_open
from transformers import AutoModel, AutoTokenizer

SEE_DIR = Path.home() / "zyt/data/sona-omni/eyes/see"
brain, eyes = os.environ["BRAIN"], os.environ.get("EYES")
device = "mps" if torch.backends.mps.is_available() else "cpu"
model = AutoModel.from_pretrained(brain, trust_remote_code=True, attn_implementation="sdpa", torch_dtype=torch.float16,
                                  init_vision=True, init_audio=False, init_tts=False).eval().to(device)
if eyes:
    shards = set(json.loads((Path(eyes) / "model.safetensors.index.json").read_text())["weight_map"].items())
    vpm = {}
    for key, shard in shards:
        if key.startswith("vpm."):
            with safe_open(str(Path(eyes) / shard), "pt") as f:
                vpm[key] = f.get_tensor(key).to(torch.float16)
    missing, _ = model.load_state_dict(vpm, strict=False)
    print(f"eyes from {eyes}: {len(vpm)} tensors", flush=True)
tok = AutoTokenizer.from_pretrained(brain, trust_remote_code=True)

CANT = re.compile(r"can't read|cannot read|unable to read|tak dapat|tidak dapat|看不清|无法|读不清|another photo|gambar lain|再拍", re.I)
NONE = re.compile(r"not show|doesn't show|does not show|tidak menunjukkan|tiada arahan|没有|没写|not say|tidak dinyatakan|tidak memberikan", re.I)
norm = lambda t: t.lower().replace(" ", "")


def kind(q):
    if re.search(r"plan|pelan|计划", q, re.I): return "plan"
    if re.search(r"how|macam mana|怎么用|makan ah", q, re.I): return "how"
    if re.search(r"what medicine|ubat apa|什么药", q, re.I): return "what"
    return "read"


rows, score = [], {}
for r in random.Random(1).sample(json.loads((SEE_DIR / "test.json").read_text()), 100):  # eval.py's sample
    q = r["messages"][0]["content"].replace("<image>", "")
    reply = model.chat(msgs=[{"role": "user", "content": [Image.open(SEE_DIR / r["images"][0]).convert("RGB"), q]}],
                       tokenizer=tok, do_sample=False, max_new_tokens=200)
    e = r["expected"]
    k = "unreadable" if e["unreadable"] else kind(q)
    if k == "unreadable": ok = bool(CANT.search(reply))
    elif CANT.search(reply): ok = False
    elif k in ("read", "what"): ok = norm(e["name"]) in norm(reply) and norm(e["strength"]) in norm(reply)
    elif k == "how": ok = norm(e["instruction"])[:25] in norm(reply) if e["instruction"] else bool(NONE.search(reply))
    else: ok = None
    if ok is not None:
        s = score.setdefault(k, [0, 0]); s[0] += ok; s[1] += 1
    rows.append({"question": q, "expected": e, "kind": k, "ok": ok, "reply": reply})
    print(k, ok, "|", reply[:100].replace("\n", " "), flush=True)
Path(sys.argv[1]).write_text(json.dumps({"brain": brain, "eyes": eyes, "score": score, "rows": rows}, ensure_ascii=False, indent=1))
print("score", {k: f"{a}/{n}" for k, (a, n) in score.items()})

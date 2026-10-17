"""Score a Qwen3-ASR checkpoint on the test manifests: mixed error rate, Mandarin character error rate, drug names."""
import json, re, sys, torch, librosa
from pathlib import Path
from qwen_asr import Qwen3ASRModel
from voice import DATA
DRUGS = re.compile(r"\b(paracetamol|panadol|amoxicillin|azithromycin|metformin|amlodipine|salbutamol|ventolin|cetirizine|prednisolone|insulin|warfarin|omeprazole|losartan|atorvastatin|ibuprofen|doxycycline|augmentin|perindopril|gliclazide)\b", re.I)
def toks(s): return re.findall(r"[一-鿿]|[a-z0-9]+(?:[-'][a-z0-9]+)*", s.lower())
def ed(a, b):
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, y in enumerate(b, 1): p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (x != y))
    return d[-1]
model = sys.argv[1] if len(sys.argv) > 1 else "Qwen/Qwen3-ASR-1.7B"
m = Qwen3ASRModel.from_pretrained(model, dtype=torch.float32, device_map="mps")
for name in sys.argv[2:] or ("test", "test_noisy"):
    E = N = zE = zN = hit = tot = 0; dump = []
    for line in (DATA / "dataset" / f"{name}.jsonl").read_text().splitlines():
        r = json.loads(line); h = m.transcribe((librosa.load(r["audio"], sr=16000)[0], 16000))[0].text
        R, H = toks(r["text"]), toks(h); E += ed(R, H); N += len(R)
        dump.append({"id": r["id"], "ref": r["text"], "hyp": h, "errors": ed(R, H), "words": len(R)})
        torch.mps.empty_cache()  # same MPS cache growth as trim.py
        zr = [t for t in R if "一" <= t <= "鿿"]; zh = [t for t in H if "一" <= t <= "鿿"]; zE += ed(zr, zh); zN += len(zr)
        for d in DRUGS.findall(r["text"]): tot += 1; hit += d.lower() in h.lower()
    (DATA / "scores").mkdir(exist_ok=True); (DATA / "scores" / f"{Path(model).name}_{name}.jsonl").write_text("\n".join(json.dumps(d, ensure_ascii=False) for d in dump))
    print(f"{model} {name}: mixed error rate {E/N:.1%} | Mandarin char error {zE/max(zN,1):.1%} | drug names {hit}/{tot}", flush=True)

"""Score VoxCPM2 clips from tts_test.py: our fine-tuned ASR transcribes each one; a term passes if it comes back intact.

Also picks 20 clips (7 ms, 7 zh, 6 en) into listen/ for a human rating. Run with the ASR venv:  python score.py [asr model]
"""
import json, os, re, random, shutil, sys
from collections import defaultdict
from pathlib import Path
import torch, librosa
from qwen_asr import Qwen3ASRModel

OUT = Path(os.environ.get("TTS_EVAL_DIR", Path.home() / "zyt/data/sona-tts"))
asr = sys.argv[1] if len(sys.argv) > 1 else "zhiyuantechnology/sona-qwen3-asr-manglish"
def norm(s): return re.sub(r"[\W_]+", "", s.lower())

m = Qwen3ASRModel.from_pretrained(asr, dtype=torch.float32, device_map="mps")
rows = [json.loads(l) for l in (OUT / "manifest.jsonl").read_text().splitlines()]
tally = defaultdict(lambda: [0, 0]); misses = []
for r in rows:
    r["heard"] = m.transcribe((librosa.load(r["audio"], sr=16000)[0], 16000))[0].text; torch.mps.empty_cache()
    ok = norm(r["term"]) in norm(r["heard"]); r["ok"] = ok
    for k in (r["lang"], f"{r['lang']}/{r['kind']}", "all"): tally[k][0] += ok; tally[k][1] += 1
    if not ok: misses.append(r)
(OUT / "scored.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
for k in sorted(tally): print(f"{k:12s} {tally[k][0]}/{tally[k][1]} = {tally[k][0] / tally[k][1]:.0%}")
print("\nmisses:"); [print(f"  {r['id']} [{r['term']}] heard: {r['heard']}") for r in misses]

random.seed(0); listen = OUT / "listen"; listen.mkdir(exist_ok=True)
pick = [r for lang, n in (("ms", 7), ("zh", 7), ("en", 6)) for r in random.sample([x for x in rows if x["lang"] == lang], n)]
for r in pick: shutil.copy(r["audio"], listen / Path(r["audio"]).name)
(listen / "lines.txt").write_text("\n".join(f"{Path(r['audio']).name}\t{r['text']}" for r in pick))

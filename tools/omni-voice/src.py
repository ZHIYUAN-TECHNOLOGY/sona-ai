"""Uploads the job's inputs to voice/src/ of zhiyuantechnology/sona-minicpmo-data: run.sh, speak.py, hear.py and
lines.jsonl, the ms, en and zh lines of lines.py shuffled, so a cut at SPEAK_MINUTES keeps each language's share.
Needs huggingface_hub; uses ~/.cache/huggingface/token_write. Usage: python src.py [--scripts-only]
"""
import json, random, sys
from pathlib import Path

from huggingface_hub import HfApi

HERE = Path(__file__).resolve().parent
OUT = Path.home() / "zyt/data/sona-omni/voice"
api = HfApi(token=(Path.home() / ".cache/huggingface/token_write").read_text().strip())
up = lambda path, name: api.upload_file(path_or_fileobj=str(path), path_in_repo=f"voice/src/{name}", repo_type="dataset",
                                        repo_id="zhiyuantechnology/sona-minicpmo-data", commit_message=f"voice: {name}")
for f in ("run.sh", "speak.py", "hear.py"): up(HERE / f, f)
if "--scripts-only" not in sys.argv:
    rows = [r for r in map(json.loads, (OUT / "lines.jsonl").read_text().splitlines()) if r["lang"] in ("ms", "en", "zh")]
    random.Random(1).shuffle(rows)
    (OUT / "voxcpm_lines.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")
    up(OUT / "voxcpm_lines.jsonl", "lines.jsonl")
    print({l: sum(r["lang"] == l for r in rows) for l in ("ms", "en", "zh")}, "lines uploaded", flush=True)

"""Push the built dataset to a private Hugging Face dataset (columns id, audio, text, scene) for Baseten training."""
import json, sys
from pathlib import Path
from datasets import Audio, Dataset, DatasetDict
from voice import DATA

repo = sys.argv[1] if len(sys.argv) > 1 else "zhiyuantechnology/sona-manglish-asr"
token = (Path.home() / ".cache/huggingface/token_write").read_text().strip()
d = DatasetDict({k: Dataset.from_list([json.loads(l) for l in (DATA / "dataset" / f"{k}.jsonl").read_text().splitlines()])
                 .cast_column("audio", Audio(sampling_rate=16000)) for k in ("train", "test", "test_noisy")})
print(d)
d.push_to_hub(repo, private=True, token=token)

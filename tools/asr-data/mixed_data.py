"""Real licensed speech for the "mixed" run: FLEURS train (CC BY 4.0) in Malay, Mandarin and English.

Pushes it as split `fleurs_train` of the private dataset, then adds a `mixed` config whose train split is the
synthetic train plus FLEURS train, so Baseten trains on both with DATASET_CONFIG=mixed. FLEURS train and test
sentences are disjoint, so the FLEURS test sets stay held out.
"""
import io, sys
from pathlib import Path
import librosa, soundfile as sf, pyarrow.parquet as pq, yaml
from datasets import Audio, Dataset
from huggingface_hub import HfApi, hf_hub_download
from voice import DATA

repo = sys.argv[1] if len(sys.argv) > 1 else "zhiyuantechnology/sona-manglish-asr"
token = (Path.home() / ".cache/huggingface/token_write").read_text().strip()
out = DATA / "fleurs_train"; out.mkdir(parents=True, exist_ok=True)
rows = []
for lang in ("ms_my", "cmn_hans_cn", "en_us"):
    t = pq.read_table(hf_hub_download("google/fleurs", f"parquet-data/{lang}/train-00000-of-00001.parquet", repo_type="dataset"))
    for r in t.to_pylist():
        p = out / f"{lang}_{r['id']}.wav"
        if not p.exists():
            x, sr = sf.read(io.BytesIO(r["audio"]["bytes"]))
            sf.write(p, librosa.resample(x, orig_sr=sr, target_sr=16000) if sr != 16000 else x, 16000, subtype="PCM_16")
        rows.append({"id": p.stem, "audio": str(p), "text": r["raw_transcription"], "scene": "fleurs"})
    print(lang, len(rows), flush=True)
Dataset.from_list(rows).cast_column("audio", Audio(sampling_rate=16000)).push_to_hub(repo, split="fleurs_train", private=True, token=token)

# Add the `mixed` config next to the default one in the dataset card.
api = HfApi(token=token)
card = Path(hf_hub_download(repo, "README.md", repo_type="dataset", token=token)).read_text()
_, front, body = card.split("---", 2)
meta = yaml.safe_load(front)
meta["configs"] = [c for c in meta.get("configs", []) if c["config_name"] != "mixed"] + [
    {"config_name": "mixed", "data_files": [{"split": "train", "path": ["data/train-*", "data/fleurs_train-*"]}]}]
api.upload_file(path_or_fileobj=("---\n" + yaml.safe_dump(meta, sort_keys=False) + "---" + body).encode(),
                path_in_repo="README.md", repo_id=repo, repo_type="dataset", commit_message="Add mixed config")
print("pushed", len(rows), "FLEURS train rows; config `mixed` added")

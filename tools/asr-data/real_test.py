"""Real-speech test sets: FLEURS (CC BY 4.0) Malay, Mandarin and English, 300 clips each, as dataset/fleurs_<lang>.jsonl,
and the Revolab ASR Benchmark public split (real Malaysian speech) as dataset/revolab.jsonl. Existing FLEURS sets are kept."""
import io, json
from pathlib import Path
import librosa, soundfile as sf, pyarrow.parquet as pq
from huggingface_hub import hf_hub_download
from voice import DATA

out = DATA / "dataset" / "real"; out.mkdir(parents=True, exist_ok=True)
for lang in ("ms_my", "cmn_hans_cn", "en_us"):
    if (DATA / "dataset" / f"fleurs_{lang}.jsonl").exists(): continue
    t = pq.read_table(hf_hub_download("google/fleurs", f"parquet-data/{lang}/test-00000-of-00001.parquet", repo_type="dataset"))
    rows = []
    for r in t.slice(0, 300).to_pylist():
        x, sr = sf.read(io.BytesIO(r["audio"]["bytes"]))
        p = out / f"{lang}_{r['id']}.wav"; sf.write(p, librosa.resample(x, orig_sr=sr, target_sr=16000) if sr != 16000 else x, 16000)
        rows.append({"id": p.stem, "audio": str(p), "text": r["raw_transcription"]})
    (DATA / "dataset" / f"fleurs_{lang}.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
    print(lang, len(rows))

# Revolab ASR Benchmark public split (CC BY 4.0, gated: accept on the HF page first): real Malaysian Malay/English incl. code-switching.
if not (DATA / "dataset" / "revolab.jsonl").exists():
  tok = (Path.home() / ".cache/huggingface/token_write").read_text().strip()
  t = pq.read_table(hf_hub_download("Revolab/ASR-Benchmark-Public", "data/train-00000-of-00001.parquet", repo_type="dataset", token=tok))
  rows = []
  for r in t.to_pylist():
      x, sr = sf.read(io.BytesIO(r["audio"]["bytes"]))
      p = out / f"revolab_{r['id']}.wav"; sf.write(p, librosa.resample(x, orig_sr=sr, target_sr=16000) if sr != 16000 else x, 16000)
      if r["category"] == "fleurs": continue  # FLEURS train is in the mixed run, so these clips could be seen in training
      rows.append({"id": p.stem, "audio": str(p), "text": r["text"], "category": r["category"]})
  (DATA / "dataset" / "revolab.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
  print("revolab", len(rows))

# Our own voice: fictional medical Manglish lines (real_voice_lines.json) read by the team and recorded on a phone,
# dropped in DATA/real_voice/<id>.m4a (a friend's as f<id>). Test only, never training.
import subprocess
lines = {l["id"]: l["text"] for l in json.load(open(Path(__file__).parent / "real_voice_lines.json"))}
rows = []
for f in sorted((DATA / "real_voice").glob("*.*")):
    if f.suffix == ".wav" or f.stem.lstrip("f") not in lines: continue
    w = f.with_suffix(".wav"); subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f, "-ac", "1", "-ar", "16000", w], check=True)
    rows.append({"id": f"voice_{f.stem}", "audio": str(w), "text": lines[f.stem.lstrip("f")]})
if rows:
    (DATA / "dataset" / "real_voice.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
    print("real_voice", len(rows))

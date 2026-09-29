"""Single-voice VoxCPM2 fine-tuning data: every trimmed clip voiced by Gemini's "Kore" (female, Malaysian accent),
from the ASR training set plus the dedicated TTS lines (tts_voice.py, ~/zyt/data/sona-tts/gemini) once voiced.

Pushes audio/*.wav, train.jsonl (relative paths) and recipe/ (run.sh) to the private HF dataset
zhiyuantechnology/sona-voxcpm2-kore, which the Baseten job downloads. Run with the ASR venv.
"""
import json, shutil, sys
from pathlib import Path
from huggingface_hub import HfApi
sys.path.insert(0, str(Path(__file__).parents[1] / "asr-data"))
from voice import scripts, voice_for, AUDIO, DATA

VOICE, repo = "Kore", "zhiyuantechnology/sona-voxcpm2-kore"
out = Path.home() / "zyt/data/sona-tts/kore"; (out / "audio").mkdir(parents=True, exist_ok=True)
bad = set((DATA / "bad.txt").read_text().split())
rows = []
for conv in scripts():
    if conv.get("split") == "test": continue
    for j, turn in enumerate(conv["turns"]):
        p = AUDIO / f"{conv['id']}_{j:02d}.wav"
        if voice_for(conv, "doctor" if turn["speaker"] == "Doctor" else "patient") != VOICE or not p.exists() or p.stem in bad: continue
        shutil.copy(p, out / "audio" / p.name)
        rows.append({"audio": f"audio/{p.name}", "text": p.with_suffix(".txt").read_text().strip()})
tts = Path.home() / "zyt/data/sona-tts/gemini"
tts_bad = set((tts / "bad.txt").read_text().split()) if (tts / "bad.txt").exists() else set()
for p in sorted((tts / "audio").glob("*.wav")):
    if p.stem in tts_bad: continue
    shutil.copy(p, out / "audio" / p.name)
    rows.append({"audio": f"audio/{p.name}", "text": p.with_suffix(".txt").read_text().strip()})
(out / "train.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
shutil.copytree(Path(__file__).parent / "train", out / "recipe", dirs_exist_ok=True)
print(len(rows), "clips")
api = HfApi(token=(Path.home() / ".cache/huggingface/token_write").read_text().strip())
api.create_repo(repo, repo_type="dataset", private=True, exist_ok=True)
api.upload_folder(repo_id=repo, repo_type="dataset", folder_path=str(out), commit_message=f"{VOICE}: {len(rows)} clips + recipe")
print("pushed", repo)

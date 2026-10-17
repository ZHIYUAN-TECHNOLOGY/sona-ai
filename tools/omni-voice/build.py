"""Joins the Sona-voice clips and publishes them to voice/ of the private dataset zhiyuantechnology/sona-minicpmo-data as
three files, not one per clip (the account allows 1,000 Hugging Face requests per 5 minutes):
- voice/audio.tar: audio/<id>.wav, 24 kHz mono 16-bit;
- voice/train.jsonl: {id, audio: "audio/<id>.wav", text, lang, source, seconds};
- voice/README.md.
Sources: VoxCPM2 clips our ASR read back with <= 5% word errors (voxcpm/kept.jsonl, voxcpm/audio/), Manglish Gemini Kore
clips that score.py read back with <= 5% (manglish/scored.jsonl), and the 4.35 h Kore set VoxCPM2 was fine-tuned on
(~/zyt/data/sona-tts/kore) as it is. No clip repeats a sentence of the Sona eval set.
Needs soundfile and huggingface_hub; uploads with ~/.cache/huggingface/token_write. Usage: python build.py [--dry-run]
"""
import json, re, sys, tarfile
from pathlib import Path

import librosa, soundfile as sf

V = Path.home() / "zyt/data/sona-omni/voice"
KORE = Path.home() / "zyt/data/sona-tts/kore"
ROOT = Path(__file__).resolve().parents[2]
norm = lambda s: re.sub(r"[\W_]+", " ", s.lower()).strip()
EVAL = {norm(json.loads(l)["text"]) for l in (Path.home() / "zyt/data/sona-tts/eval-full1000/manifest.jsonl").read_text().splitlines()}
NURSE = {norm(n["text"]): lang for lang in ("ms", "en", "zh") for n in json.loads((ROOT / f"tools/tts-eval/scripts/{lang}.json").read_text())}
MALAY = re.compile(r"\b(saya|anda|awak|tak|tidak|nak|ni|tu|ke|dan|yang|untuk|dengan|makan|ubat|sakit|boleh|kena|jangan|sudah|dah|lah)\b", re.I)
ENGLISH = re.compile(r"\b(the|you|your|please|take|can|okay|ok|after|before|doctor|medicine|and|is|are|will)\b", re.I)


def lang_of(text):
    """Kore clips carry no language: the nurse lines are known; the consultation turns are told apart by their words."""
    if norm(text) in NURSE: return NURSE[norm(text)]
    cjk, latin = bool(re.search(r"[一-鿿]", text)), bool(re.search(r"[A-Za-z]", text))
    if cjk: return "manglish" if latin else "zh"
    ms, en = bool(MALAY.search(text)), bool(ENGLISH.search(text))
    return "manglish" if ms and en else "ms" if ms else "en"


rows = []
for r in map(json.loads, (V / "voxcpm/kept.jsonl").read_text().splitlines()):
    rows.append({"id": r["id"], "src": V / "voxcpm/audio" / r["audio"], "text": r["text"], "lang": r["lang"], "source": "voxcpm2"})
for r in map(json.loads, (V / "manglish/scored.jsonl").read_text().splitlines()):
    if r["err_resynth"] <= 0.05 * max(r["words"], 1):
        rows.append({"id": r["id"], "src": Path(r["resynth"]), "text": r["text"], "lang": "manglish", "source": "gemini-kore"})
for r in map(json.loads, (KORE / "train.jsonl").read_text().splitlines()):
    rows.append({"id": "kore-" + Path(r["audio"]).stem, "src": KORE / r["audio"], "text": r["text"], "lang": lang_of(r["text"]), "source": "kore-set"})
rows = [r for r in rows if norm(r["text"]) not in EVAL]

hours = {}
for r in rows:
    r["seconds"] = round(sf.info(r["src"]).duration, 2)
    hours[(r["source"], r["lang"])] = hours.get((r["source"], r["lang"]), 0) + r["seconds"] / 3600
for (src, lang), h in sorted(hours.items()): print(f"{src:12} {lang:9} {h:5.2f} h")
print(f"total {sum(hours.values()):.2f} h, {len(rows)} clips", flush=True)
if "--dry-run" in sys.argv: sys.exit()

pub = V / "publish"; (pub / "audio").mkdir(parents=True, exist_ok=True)
for r in rows:  # one format for every source: 24 kHz mono 16-bit WAV
    x, rate = sf.read(r["src"], dtype="float32")
    x = x.mean(1) if x.ndim > 1 else x
    sf.write(pub / "audio" / f"{r['id']}.wav", librosa.resample(x, orig_sr=rate, target_sr=24000) if rate != 24000 else x, 24000, subtype="PCM_16")
with tarfile.open(pub / "audio.tar", "w") as tar:
    tar.add(pub / "audio", arcname="audio")
(pub / "train.jsonl").write_text("\n".join(json.dumps({"id": r["id"], "audio": f"audio/{r['id']}.wav", "text": r["text"], "lang": r["lang"],
                                                       "source": r["source"], "seconds": r["seconds"]}, ensure_ascii=False) for r in rows) + "\n")
table = "\n".join(f"| {src} | {lang} | {h:.2f} |" for (src, lang), h in sorted(hours.items()))
(pub / "README.md").write_text(f"""# voice/: Sona-voice clips for MiniCPM-o's talker

`audio.tar` holds `audio/<id>.wav` (24 kHz mono 16-bit); `train.jsonl` has one row per clip: `id`, `audio` (path in the
tar), `text`, `lang` (ms, en, zh, manglish), `source`, `seconds`. Built by `tools/omni-voice/` in the sona-ai repo.

| source | lang | hours |
|---|---|---|
{table}

- voxcpm2: Sona's fine-tuned VoxCPM2 (zhiyuantechnology/sona-voxcpm2-malaysian) reading Gemma-written replies and the
  nurse lines; kept when our Manglish ASR reads it back with at most 5% word errors.
- gemini-kore: Gemini TTS voice Kore reading Manglish lines (mixed within the sentence); same 5% read-back bar.
- kore-set: the 4.35 h Kore set Sona's VoxCPM2 voice was fine-tuned on, as it is.

No clip repeats a sentence of the Sona eval set. All audio is synthetic (Gemini, or VoxCPM2 fine-tuned on Gemini):
competition and demo use only, under the ASR plan's licence rules.
""")
from huggingface_hub import HfApi
api = HfApi(token=(Path.home() / ".cache/huggingface/token_write").read_text().strip())
for name in ("audio.tar", "train.jsonl", "README.md"):
    api.upload_file(path_or_fileobj=str(pub / name), path_in_repo=f"voice/{name}", repo_id="zhiyuantechnology/sona-minicpmo-data",
                    repo_type="dataset", commit_message=f"voice: {name}")
print("uploaded voice/audio.tar, voice/train.jsonl, voice/README.md", flush=True)

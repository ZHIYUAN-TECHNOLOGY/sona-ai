"""Malay speech-token check for MiniCPM-o 4.5 (docs/minicpm-o-finetune.md, stage 3 gate), part 1 of 2.

MiniCPM-o speaks by writing CosyVoice2 speech tokens (S3 tokenizer v2, 25 a second) that its flow + HiFT turn into sound.
Each test clip goes into those tokens and back out, always in one fixed voice (the model's own system_ref_audio.wav),
so only what the tokens carry survives. score.py then reads both versions with our Manglish ASR.

Runs on CPU with `minicpmo-utils[tts]==1.0.6` (decoder in t2w.py).
Usage: python roundtrip.py [out_dir]   (default ~/zyt/data/sona-omni/malay-check)
Env: VOICE=<wav> re-speaks in that voice instead (e.g. a Sona clip); SETS=ms_sona,ms_fleurs runs only those sets.
"""
import json, os, random, sys
from pathlib import Path

from t2w import Token2wav, load

DATA = Path.home() / "zyt/data"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else DATA / "sona-omni/malay-check"


def rows(path, n=None, lang=None):
    """A test manifest's rows ({id, audio, text}), one language, or n of them picked with a fixed seed."""
    r = [json.loads(l) for l in Path(path).read_text().splitlines() if l.strip()]
    r = [x for x in r if lang is None or x["lang"] == lang]
    if n: random.Random(1).shuffle(r); r = r[:n]
    return r


asr, sona = DATA / "sona-asr/dataset", DATA / "sona-tts/eval-full1000/manifest.jsonl"
SETS = {  # Sona's voice (VoxCPM2, hospital lines with drug names), real read speech (FLEURS), real Malaysian speech (Revolab)
    "ms_sona": rows(sona, lang="ms"), "en_sona": rows(sona, lang="en"), "zh_sona": rows(sona, lang="zh"),
    "ms_fleurs": rows(asr / "fleurs_ms_my.jsonl", 40), "en_fleurs": rows(asr / "fleurs_en_us.jsonl", 40),
    "zh_fleurs": rows(asr / "fleurs_cmn_hans_cn.jsonl", 40), "revolab": rows(asr / "revolab.jsonl", 30),
}
if os.environ.get("SETS"): SETS = {k: v for k, v in SETS.items() if k in os.environ["SETS"].split(",")}

t2w = Token2wav()
voice = os.environ.get("VOICE") or t2w.default_voice
(OUT / "audio").mkdir(parents=True, exist_ok=True)
done = {json.loads(l)["key"] for l in (OUT / "manifest.jsonl").read_text().splitlines()} if (OUT / "manifest.jsonl").exists() else set()
with open(OUT / "manifest.jsonl", "a") as log:
    for name, rs in SETS.items():
        for r in rs:
            key = f"{name}_{r['id']}"
            if key in done: continue
            t = t2w.tokens(load(r["audio"], 16000))
            out = OUT / "audio" / f"{key}.wav"
            out.write_bytes(t2w(t, voice))
            log.write(json.dumps({"key": key, "set": name, "id": r["id"], "text": r["text"], "orig": r["audio"], "resynth": str(out), "tokens": t.shape[1]}, ensure_ascii=False) + "\n")
            log.flush()
            print(key, t.shape[1], "tokens", flush=True)

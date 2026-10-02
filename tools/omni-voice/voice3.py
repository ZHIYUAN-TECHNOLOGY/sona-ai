"""Talker v3 clips: Gemini TTS voice Kore, asked for a Malaysian accent (and Malaysian Mandarin for any Chinese), reads the
training lines of lines_v3.py through the Batch API, then only clips our Manglish ASR hears back right are kept.

  python voice3.py submit   # queue every training line without audio (500 a batch)
  python voice3.py poll     # wait for the batches, save audio/<id>.wav, write manifest.jsonl for score.py
  python voice3.py trim     # cut the accent instruction Gemini read aloud (see below)
  <venv-asr>/python ../omni-eval/score.py ~/zyt/data/sona-omni/voice3/trim   # the ASR reads every clip back
  python voice3.py build    # keep <= 5% word errors, publish voice3/ to the private dataset

Numbers are compared as spoken words (spoken.py), since the ASR writes "38" where the line says "thirty-eight". The
accent instruction is sometimes read aloud; those clips fail the read-back and are dropped.
voice3/ holds audio.tar (audio/<id>.wav, 24 kHz mono 16-bit), train.jsonl ({id, audio, text, lang, source, seconds}; lang
"num" or "mix", so train.py's even sampling gives each a share of steps) and test.jsonl (the hard speaking test's lines).
Gemini made every clip: competition and demo use only, as with voice/.
"""
import base64, json, re, sys, tarfile, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "asr-data"))
from voice import API, MODEL, call  # noqa: E402  (the Gemini key and request shape the ASR data used)
from spoken import spoken  # noqa: E402

DIR = Path.home() / "zyt/data/sona-omni/voice3"; AUDIO = DIR / "audio"; JOBS = DIR / "jobs.json"
ASK = "Say this as a Malaysian woman, with a natural Malaysian accent and Malaysian Mandarin for any Chinese:\n"
rows = [json.loads(l) for l in (DIR / "lines.jsonl").read_text().splitlines()]
train = [r for r in rows if r["split"] == "train"]


def toks(s):  # as score.py: Chinese characters and words
    return re.findall(r"[一-鿿]|[a-z0-9]+(?:[-'][a-z0-9]+)*", s.lower())


def errors(ref, hyp, lang):
    a, b = toks(ref), toks(spoken(hyp, "en" if lang == "manglish" else lang))
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, y in enumerate(b, 1): p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (x != y))
    return d[-1], len(a)


if sys.argv[1] == "submit":
    AUDIO.mkdir(parents=True, exist_ok=True)
    todo = [r for r in train if not (AUDIO / f"{r['id']}.wav").exists()]
    reqs = [{"request": {"contents": [{"parts": [{"text": ASK + r["text"]}]}], "generationConfig": {"responseModalities": ["AUDIO"],
             "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": "Kore"}}}}}, "metadata": {"key": r["id"]}} for r in todo]
    jobs = json.loads(JOBS.read_text()) if JOBS.exists() else []
    for i in range(0, len(reqs), 500):
        j = call("POST", f"{API}/models/{MODEL}:batchGenerateContent",
                 {"batch": {"display_name": f"sona-voice3-{int(time.time())}", "input_config": {"requests": {"requests": reqs[i:i + 500]}}}})
        jobs.append(j["name"]); JOBS.write_text(json.dumps(jobs)); print("submitted", len(reqs[i:i + 500]), j["name"], flush=True)
elif sys.argv[1] == "poll":
    for name in json.loads(JOBS.read_text()):
        while not (j := call("GET", f"{API}/{name}")).get("done"): time.sleep(60)
        for r in j.get("response", {}).get("inlinedResponses", {}).get("inlinedResponses", []):
            try: data = r["response"]["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
            except (KeyError, IndexError): print("no audio", r["metadata"]["key"]); continue
            (AUDIO / f"{r['metadata']['key']}.wav").write_bytes(base64.b64decode(data))
        print(name, "done", flush=True)
    JOBS.write_text("[]")
    (DIR / "manifest.jsonl").write_text("\n".join(json.dumps({"key": r["id"], "set": r["cat"], "id": r["id"], "text": r["text"],
                                                             "resynth": str(AUDIO / f"{r['id']}.wav")}, ensure_ascii=False)
                                                  for r in train if (AUDIO / f"{r['id']}.wav").exists()) + "\n")
elif sys.argv[1] == "trim":
    # gemini-3.8-flash-tts read ASK aloud before nearly every line (2 Oct: all 3,668 clips ran 4-6 s long; a system
    # instruction is refused, "Developer instruction is not enabled for this model"). ASK ends in a colon, so the clip
    # is cut at the end of the longest pause 3-9 s in; score.py then keeps only clips where exactly the line is left.
    # ponytail: an energy pause, not forced alignment; the read-back check is what makes it safe.
    import numpy as np, soundfile as sf
    n = int(sys.argv[2]) if len(sys.argv) > 2 else len(train)
    (DIR / "trimmed").mkdir(exist_ok=True)
    man = []
    for r in train[:n]:
        x, sr = sf.read(AUDIO / f"{r['id']}.wav", dtype="float32")
        hop = sr // 50  # 20 ms frames
        rms = np.sqrt(np.convolve(x ** 2, np.ones(hop) / hop, "same"))[::hop]
        quiet = rms < max(0.01, 0.05 * np.percentile(rms, 95))
        best, run = (0, 0), 0
        for i, q in enumerate(quiet):
            run = run + 1 if q else 0
            if 150 <= i <= min(450, len(quiet) - 40) and run > best[1]: best = (i, run)  # 3-9 s in, 0.8 s of line left
        if best[1] < 10: continue  # no pause of 200 ms: leave the clip out
        sf.write(DIR / "trimmed" / f"{r['id']}.wav", x[max(0, (best[0] - 2) * hop):], sr, subtype="PCM_16")
        man.append({"key": r["id"], "set": r["cat"], "id": r["id"], "text": r["text"], "resynth": str(DIR / "trimmed" / f"{r['id']}.wav")})
    (DIR / "trim").mkdir(exist_ok=True)
    (DIR / "trim" / "manifest.jsonl").write_text("\n".join(json.dumps(m, ensure_ascii=False) for m in man) + "\n")
    print(f"trimmed {len(man)} of {n}; score with: score.py {DIR / 'trim'}", flush=True)
elif sys.argv[1] == "build":
    import librosa, soundfile as sf
    from huggingface_hub import HfApi
    lang = {r["id"]: r["lang"] for r in rows}
    kept, per = [], {}
    for r in map(json.loads, (DIR / "trim" / "scored.jsonl").read_text().splitlines()):
        e, n = errors(r["text"], r["hyp_resynth"], lang[r["id"]])
        ok = e <= 0.05 * max(n, 1)
        per.setdefault(r["set"], [0, 0])[0 if ok else 1] += 1
        if ok: kept.append(r)
    print("kept / dropped by category:", per, flush=True)
    pub = DIR / "publish"; (pub / "audio").mkdir(parents=True, exist_ok=True)
    out = []
    for r in kept:
        x, rate = sf.read(r["resynth"], dtype="float32")
        x = x.mean(1) if x.ndim > 1 else x
        x = librosa.resample(x, orig_sr=rate, target_sr=24000) if rate != 24000 else x
        sf.write(pub / "audio" / f"{r['id']}.wav", x, 24000, subtype="PCM_16")
        out.append({"id": r["id"], "audio": f"audio/{r['id']}.wav", "text": r["text"], "lang": "num" if r["set"].startswith("num_") else "mix",
                    "source": "gemini-kore-malaysian", "seconds": round(len(x) / 24000, 2)})
    print(f"{len(out)} clips, {sum(r['seconds'] for r in out) / 3600:.2f} h", flush=True)
    with tarfile.open(pub / "audio.tar", "w") as tar:
        tar.add(pub / "audio", arcname="audio")
    (pub / "train.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in out) + "\n")
    (pub / "test.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows if r["split"] == "test") + "\n")
    api = HfApi(token=(Path.home() / ".cache/huggingface/token_write").read_text().strip())
    for name in ("audio.tar", "train.jsonl", "test.jsonl"):
        api.upload_file(path_or_fileobj=str(pub / name), path_in_repo=f"voice3/{name}", repo_id="zhiyuantechnology/sona-minicpmo-data",
                        repo_type="dataset", commit_message=f"voice3: {name}")
    print("uploaded voice3/audio.tar, train.jsonl, test.jsonl", flush=True)

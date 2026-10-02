"""Stage 2 hearing data for MiniCPM-o's ear (docs/minicpm-o-finetune.md, run log: real speech is the gap), in sft/hear.json's
format: user "<audio>Write down exactly what was said.", assistant the words. Audio goes in one tar, packs/sft-audio2.tar
(audio/hear2/<id>.wav, 16 kHz mono), because per-file uploads hit Hugging Face's 1000 requests / 5 min.

  python hear2.py manglish   sona-manglish-asr train clips not already in sft/hear.json, clean and noisy (synthetic)
  python hear2.py real       two MagicHub Malay corpora, real recorded speech with human transcripts (CC BY-NC-ND 4.0:
                             demo-only); each clip also heard by our ASR on box ② and kept only when the two roughly agree.
                             One whole conversation group is held out, unfiltered, as sft/hear2_test.json.
  python hear2.py voice      Sona's voice clips richest in medical words, Malay and Manglish first (synthetic)
  python hear2.py pack       sft/hear2.json and packs/sft-audio2.tar
  python hear2.py upload     both, plus hear2_test.json, to the dataset repo (write token)
Run with a venv that has pyarrow, soundfile, librosa, requests and huggingface_hub (tools/omni-eval's venv-asr).
"""
import io, json, os, random, re, sys, tarfile, time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import librosa, numpy as np, soundfile as sf

sys.path.insert(0, str(Path(__file__).parent))
from build import ASR, HF_REPO, SCENES, SFT, conversations

OUT = Path.home() / "zyt/data/sona-omni/hear2"
AUDIO = SFT / "audio/hear2"
ASK = "<audio>Write down exactly what was said."
rng = random.Random(2)


def row(text, path, lang, source):
    return {"messages": [{"role": "user", "content": ASK}, {"role": "assistant", "content": text}],
            "audios": [str(path.relative_to(SFT))], "lang": lang, "source": source}


def save16(x, sr, name):
    """16 kHz mono WAV at audio/hear2/<name>.wav."""
    AUDIO.mkdir(parents=True, exist_ok=True)
    x = x.mean(1) if x.ndim > 1 else x
    if sr != 16000: x = librosa.resample(x.astype(np.float32), orig_sr=sr, target_sr=16000)
    p = AUDIO / f"{name}.wav"
    sf.write(p, x, 16000, subtype="PCM_16")
    return p


def manglish(n=10_000):
    """Synthetic Manglish consultation clips stage 1 did not use (it took 3,000), half clean, half noisy."""
    used = {Path(r["audios"][0]).name for r in json.loads((SFT / "hear.json").read_text())}
    convs = {c["id"]: c for c in conversations()}  # train split only: test.jsonl clips are never here
    free = []
    for line in (ASR / "dataset/train.jsonl").read_text().splitlines():
        r = json.loads(line)
        stem = next((r["id"][: -len(s) - 1] for s in SCENES if r["id"].endswith("_" + s)), r["id"])
        conv = convs.get(stem.rsplit("_", 1)[0])
        if conv and Path(r["audio"]).name not in used:
            free.append((r, conv["lang"]))
    clean = [x for x in free if x[0]["scene"] == "clean"]; noisy = [x for x in free if x[0]["scene"] != "clean"]
    pick = rng.sample(clean, min(len(clean), n // 2)) + rng.sample(noisy, min(len(noisy), n // 2))
    rows = []
    for r, lang in pick:
        p = AUDIO / Path(r["audio"]).name
        AUDIO.mkdir(parents=True, exist_ok=True)
        if not p.exists(): os.link(r["audio"], p)  # already 16 kHz mono WAV
        rows.append(row(r["text"], p, lang, "sona-manglish-asr (Gemini TTS, competition-only)"))
    (OUT / "manglish.json").write_text(json.dumps(rows, ensure_ascii=False))
    print("manglish", len(rows), Counter(r["lang"] for r in rows), "free were", len(free))


# --- real speech -------------------------------------------------------------------------------------------------
BOX = "https://model-qvmgk79q.api.baseten.co/environments/production/sync/v1/audio/transcriptions"  # BOXES.voice
toks = lambda s: re.findall(r"[一-鿿]|[a-z0-9]+(?:[-'][a-z0-9]+)*", s.lower())  # as eval.py and asr-data/baseline.py


def ed(a, b):
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, y in enumerate(b, 1): p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (x != y))
    return d[-1]


def hear(path):
    """Our ASR's words for a WAV (box ②, as packages/api/src/baseten-models.ts transcribe calls it); None on failure."""
    import requests
    key = os.environ["BASETEN_API_KEY"]
    for i in range(4):
        try:
            with open(path, "rb") as f:
                r = requests.post(BOX, headers={"Authorization": f"Api-Key {key}"}, data={"model": "sona-asr"},
                                  files={"file": ("speech.wav", f, "audio/wav")}, timeout=120)
            if r.ok: return str(r.json().get("text", "")).strip()
        except Exception:
            pass
        time.sleep(5 * (i + 1))
    return None


def tidy(text):
    """A human transcript in the house style: no space before punctuation, a capital first letter, an end mark."""
    t = re.sub(r"\s+([.,!?])", r"\1", re.sub(r"\s+", " ", text)).strip()
    return t[:1].upper() + t[1:] + ("" if not t or t[-1] in ".!?" else ".")


def real():
    import pyarrow.parquet as pq
    clips = []  # (name, x, sr, text, group, corpus)
    for p in sorted((OUT / "raw/data").glob("*.parquet")):  # malaysia-ai/malay-conversational-speech-corpus
        for r in pq.read_table(p).to_pylist():
            if r["gender"] == "none,none": continue  # unlabelled: mostly noise
            x, sr = sf.read(io.BytesIO(r["filename"]["bytes"]), dtype="float32")
            clips.append((f"mcsc_{r['id']}_{len(clips):05d}", x, sr, r["Y"], r["id"], "conversational"))
    for p in sorted((OUT / "raw/scripted/data").glob("*.parquet")):  # malaysia-ai/scripted-malay-daily-use-speech-corpus
        for r in pq.read_table(p).to_pylist():
            x, sr = sf.read(io.BytesIO(r["filename"]["bytes"]), dtype="float32")
            name = Path(r["filename"]["path"]).stem
            clips.append((f"msdu_{name}", x, sr, r["Y"], name.split("_")[0], "scripted"))
    dur = lambda c: len(c[1]) / c[2]
    clips = [c for c in clips if 2 <= dur(c) <= 15 and c[3].strip()]
    groups = Counter(c[4] for c in clips if c[5] == "conversational")
    # The held-out test: the conversation group nearest 150 clips, unfiltered, so the score is fair.
    test_group = min(groups, key=lambda g: abs(groups[g] - 150))
    test = [c for c in clips if c[4] == test_group]
    train = [c for c in clips if c[4] != test_group]
    print("real clips 2-15 s:", Counter(c[5] for c in clips), f"{sum(map(dur, clips)) / 3600:.2f} h; test group",
          test_group, len(test), flush=True)

    test_rows = [row(tidy(c[3]), save16(c[1], c[2], c[0]), "ms", "Malay Conversational Speech Corpus, MagicHub (CC BY-NC-ND 4.0: demo-only)")
                 for c in test]
    (SFT / "hear2_test.json").write_text(json.dumps(test_rows, ensure_ascii=False))

    paths = [save16(c[1], c[2], c[0]) for c in train]
    t0 = time.time()
    with ThreadPoolExecutor(16) as pool:
        heard = list(pool.map(hear, paths))
    print(f"box ② heard {sum(h is not None for h in heard)}/{len(paths)} in {time.time() - t0:.0f} s", flush=True)
    rows, mers, dropped = [], [], Counter()
    for c, p, h in zip(train, paths, heard):
        ref = toks(c[3])
        if h is None: dropped["no answer"] += 1; p.unlink(); continue
        m = ed(ref, toks(h)) / max(1, len(ref))
        mers.append(m)
        if m > 0.5: dropped["disagree"] += 1; p.unlink(); continue  # rough agreement: casual spellings differ, words should not
        source = ("Malay Conversational Speech Corpus" if c[5] == "conversational" else "Malay Scripted Speech Corpus, Daily Use")
        rows.append({**row(tidy(c[3]), p, "ms", f"{source}, MagicHub (CC BY-NC-ND 4.0: demo-only)"), "asr": h, "agreement_mer": round(m, 3)})
    (OUT / "real.json").write_text(json.dumps(rows, ensure_ascii=False))
    q = np.percentile(mers, [25, 50, 75, 90]) if mers else []
    print("real kept", len(rows), Counter(r["source"].split(",")[0] for r in rows), "dropped", dict(dropped),
          "agreement MER quartiles/p90", np.round(q, 3).tolist(), f"{sum(sf.info(SFT / r['audios'][0]).duration for r in rows) / 3600:.2f} h")


# --- Sona's voice ------------------------------------------------------------------------------------------------
MEDICAL = re.compile(r"\b(ubat|tablet|kapsul|mg|ml|dos|demam|batuk|selsema|sakit|pening|loya|muntah|cirit|sesak|nafas|dada|jantung|"
                     r"darah|tekanan|gula|kencing|luka|bengkak|ruam|alahan|jangkitan|antibiotik|insulin|suntikan|klinik|hospital|doktor|"
                     r"jururawat|farmasi|preskripsi|temujanji|fever|cough|pain|dose|medicine|tablets?|blood|pressure|sugar|wound|"
                     r"infection|allergy|breath|chest|clinic|doctor|nurse|pharmacy|appointment|inhaler|puff)\b", re.I)


def voice(n=2_000):
    """Sona's clips with the most medical words (drug names too), Malay and Manglish first: the words patients say."""
    import csv
    lines = [l for l in (Path(__file__).parents[2] / "data/drugs.csv").read_text().splitlines() if l and not l.startswith("#")]
    drugs = {r[next(iter(r))].strip().lower() for r in csv.DictReader(lines)}  # the formulary's first column: the name
    d = Path.home() / "zyt/data/sona-omni/voice/publish"
    rows_ = [json.loads(l) for l in (d / "train.jsonl").read_text().splitlines()]
    score = lambda r: (len(MEDICAL.findall(r["text"])) + 2 * sum(w in r["text"].lower() for w in drugs)
                       + (1.5 if r["lang"] in ("ms", "manglish") else 0))
    rows_ = [r for r in rows_ if 2 <= r["seconds"] <= 15]
    pick = sorted(rows_, key=score, reverse=True)[:n]
    rows = []
    for r in pick:
        x, sr = sf.read(d / r["audio"], dtype="float32")
        lang = "ms" if r["lang"] == "manglish" else r["lang"]  # Manglish lines here are mostly Malay-led
        rows.append(row(r["text"], save16(x, sr, r["id"]), lang, "Sona voice (VoxCPM2 and Gemini Kore, competition-only)"))
    (OUT / "voice.json").write_text(json.dumps(rows, ensure_ascii=False))
    print("voice", len(rows), Counter(r["lang"] for r in pick), "mean score", round(sum(map(score, pick)) / len(pick), 2))


def pack():
    rows = [r for f in ("manglish", "real", "voice") for r in json.loads((OUT / f"{f}.json").read_text())]
    rows = [{k: v for k, v in r.items() if k not in ("asr", "agreement_mer")} for r in rows]
    rng.shuffle(rows)
    (SFT / "hear2.json").write_text(json.dumps(rows, ensure_ascii=False, indent=0))
    test = json.loads((SFT / "hear2_test.json").read_text())
    (SFT.parent / "packs").mkdir(exist_ok=True)
    with tarfile.open(SFT.parent / "packs/sft-audio2.tar", "w") as t:
        for r in rows + test:
            t.add(SFT / r["audios"][0], arcname=r["audios"][0])
    print("hear2", len(rows), Counter(r["source"].split(" (")[0].split(",")[0] for r in rows), Counter(r["lang"] for r in rows),
          "test", len(test), f"tar {(SFT.parent / 'packs/sft-audio2.tar').stat().st_size / 1e9:.2f} GB")


def upload():
    from huggingface_hub import CommitOperationAdd, HfApi
    api = HfApi(token=(Path.home() / ".cache/huggingface/token_write").read_text().strip())
    # dataset_info.json is shared with the other stage 2 data tracks: the training recipe registers hear2 (sona_hear columns)
    ops = [CommitOperationAdd(f"sft/{f}", str(SFT / f)) for f in ("hear2.json", "hear2_test.json")]
    ops.append(CommitOperationAdd("packs/sft-audio2.tar", str(SFT.parent / "packs/sft-audio2.tar")))
    c = api.create_commit(HF_REPO, ops, repo_type="dataset", commit_message="sft: hear2 (stage 2 hearing: more Manglish, real Malay speech, Sona's medical lines) and hear2_test")
    print("uploaded", c.oid)


def check():
    """python hear2.py check: the house style and the agreement score."""
    assert tidy("Dia tidak tahu apa-apa .") == "Dia tidak tahu apa-apa."
    assert tidy("ah makanan bagi aku macam struggle kan") == "Ah makanan bagi aku macam struggle kan."
    assert tidy("kenapa ?") == "Kenapa?"
    assert ed(toks("makan lepas makan malam"), toks("Makan terbuka makan malam.")) == 1
    assert toks("我咳到睡不着, already one week lah") == ["我", "咳", "到", "睡", "不", "着", "already", "one", "week", "lah"]
    print("check ok")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    globals()[sys.argv[1]]()

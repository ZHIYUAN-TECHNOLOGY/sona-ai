"""Training data for run.sh, in LLaMA-Factory's sharegpt audio format (messages + audios, one "<audio>" per clip).

smoke: 200 clips of zhiyuantechnology/sona-manglish-asr (train split) as "write down exactly what was said", enough to
prove loading, training, merging and restoring on the H100. full: the stage 1 sets from zhiyuantechnology/sona-minicpmo-data
(config "sft", built by tools/omni-data/), downloaded as written there. stage2: the new sets plus a replay of stage 1's.
Usage: python data.py smoke|full|stage2|stage3|ear <out_dir>   (needs HF_TOKEN for the private datasets)
"""
import json, os, random, sys, tarfile
from pathlib import Path

from datasets import Audio, load_dataset
from huggingface_hub import hf_hub_download, snapshot_download

mode, out = sys.argv[1], Path(sys.argv[2])
(out / "audio").mkdir(parents=True, exist_ok=True)
token = os.environ.get("HF_TOKEN")

if mode == "smoke":
    # The stored WAV bytes are written as they are: decoding through datasets 4 would need torchcodec.
    rows = load_dataset("zhiyuantechnology/sona-manglish-asr", split="train", token=token).cast_column("audio", Audio(decode=False))
    pick = random.Random(1).sample(range(len(rows)), 200)
    data = []
    for i in pick:
        r = rows[i]
        path = out / "audio" / f"{r['id']}.wav"
        path.write_bytes(r["audio"]["bytes"])
        data.append({"messages": [{"role": "user", "content": "<audio>Write down exactly what was said."},
                                  {"role": "assistant", "content": r["text"]}], "audios": [str(path)]})
    (out / "hear.json").write_text(json.dumps(data, ensure_ascii=False))
    info = {"hear": {"file_name": "hear.json", "formatting": "sharegpt", "columns": {"messages": "messages", "audios": "audios"},
                     "tags": {"role_tag": "role", "content_tag": "content", "user_tag": "user", "assistant_tag": "assistant", "system_tag": "system"}}}
    (out / "dataset_info.json").write_text(json.dumps(info, indent=2))
elif mode == "ear":
    # MiniCPM-o's own ear for a one-model call (docs/minicpm-o-finetune.md, one-ear test): "write down exactly what was
    # said" on the set box ②'s ASR was fine-tuned on (config `mixed`: the synthetic Manglish turns plus FLEURS train in
    # Malay, Mandarin and English; tools/asr-data/mixed_data.py). A fifth gets 0.5-3 s of quiet on each side, as a live
    # turn comes to the side job. Test splits never train.
    # ear2 adds real speech and rougher audio (env, all off for ear1): EAR_N caps the mixed set; NSC (shards of IMDA NSC
    # Part 4, Singapore code-switched conversations, via MERaLiON's copy; Singapore Open Data Licence, Part 4 terms to
    # confirm before hospital use); AUG (share of synthetic clips given noise, a room or a phone line).
    import io
    import re
    import numpy as np
    import soundfile as sf
    n = lambda k, d: int(os.environ.get(k, d))
    rows = load_dataset("zhiyuantechnology/sona-manglish-asr", "mixed", split="train", token=token).cast_column("audio", Audio(decode=False))
    pick = random.Random(7)
    keep = sorted(pick.sample(range(len(rows)), n("EAR_N", len(rows)))) if os.environ.get("EAR_N") else range(len(rows))
    aug = float(os.environ.get("AUG", 0))

    def rough(x, sr):
        """Noise at 10-30 dB, a room (0.2-0.6 s of reverb) or a phone line (300-3400 Hz, mu-law)."""
        g, kind = np.random.default_rng(pick.randrange(1 << 30)), pick.choice(["noise", "room", "phone"])
        if kind == "noise":
            x = x + g.standard_normal(len(x)).astype(np.float32) * np.sqrt((np.mean(x ** 2) + 1e-9) / 10 ** (pick.uniform(10, 30) / 10))
        elif kind == "room":
            k = int(sr * pick.uniform(0.2, 0.6)); ir = g.standard_normal(k).astype(np.float32) * np.exp(-6.9 * np.arange(k) / k); ir[0] = 1
            m = 1 << int(np.ceil(np.log2(len(x) + k)))
            y = np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(ir, m), m)[:len(x)]
            x = y * (np.max(np.abs(x)) / (np.max(np.abs(y)) + 1e-9))
        else:
            spec, f = np.fft.rfft(x), np.fft.rfftfreq(len(x), 1 / sr); spec[(f < 300) | (f > 3400)] = 0
            y = np.clip(np.fft.irfft(spec, len(x)), -1, 1); mu = 255
            q = np.round(np.sign(y) * np.log1p(mu * np.abs(y)) / np.log1p(mu) * 127) / 127
            x = np.sign(q) * ((1 + mu) ** np.abs(q) - 1) / mu
        return np.clip(x, -1, 1).astype(np.float32)

    rng, data = random.Random(6), []
    for i in keep:
        r = rows[i]
        path = out / "audio" / f"ear_{i:05d}.wav"
        quiet_pad, rougher = rng.random() < 0.2, r.get("scene") != "fleurs" and pick.random() < aug
        if quiet_pad or rougher:
            x, sr = sf.read(io.BytesIO(r["audio"]["bytes"]), dtype="float32")
            x = x if x.ndim == 1 else x.mean(1)
            if rougher:
                x = rough(x, sr)
            if quiet_pad:
                quiet = lambda: np.zeros(int(sr * rng.uniform(0.5, 3)), np.float32)
                x = np.concatenate([quiet(), x, quiet()])
            sf.write(path, x, sr)
        else:
            path.write_bytes(r["audio"]["bytes"])
        data.append({"messages": [{"role": "user", "content": "<audio>Write down exactly what was said."},
                                  {"role": "assistant", "content": r["text"]}], "audios": [str(path)]})
    # NSC transcripts mark speakers, fillers and cut words: "<Speaker1>: ... (uh) ... [lah] ... !wah! ... di~"
    tidy = lambda t: re.sub(r"\s+", " ", re.sub(r"<[^>]*>:?|\([^)]*\)|\S*~|[\[\]!]", " ", t)).strip()
    import pyarrow.parquet as pq
    for k in range(n("NSC", 0)):
        f = hf_hub_download("MERaLiON/Multitask-National-Speech-Corpus-v1", f"ASR-PART4-Train/train-{k:05d}-of-00017.parquet", repo_type="dataset")
        for j, r in enumerate(pq.read_table(f, columns=["context", "answer"]).to_pylist()):
            x, sr = sf.read(io.BytesIO(r["context"]["bytes"]), dtype="float32")
            text = tidy(r["answer"])
            if not text or len(x) / sr > 30:
                continue
            path = out / "audio" / f"nsc_{k:02d}_{j:04d}.wav"
            sf.write(path, x if x.ndim == 1 else x.mean(1), sr)
            data.append({"messages": [{"role": "user", "content": "<audio>Write down exactly what was said."},
                                      {"role": "assistant", "content": text}], "audios": [str(path)]})
    (out / "ear.json").write_text(json.dumps(data, ensure_ascii=False))
    info = {"ear": {"file_name": "ear.json", "formatting": "sharegpt", "columns": {"messages": "messages", "audios": "audios"},
                    "tags": {"role_tag": "role", "content_tag": "content", "user_tag": "user", "assistant_tag": "assistant", "system_tag": "system"}}}
    (out / "dataset_info.json").write_text(json.dumps(info, indent=2))
    print("ear", len(data), "of which NSC", sum("nsc_" in d["audios"][0] for d in data), flush=True)
elif mode == "stage3":
    # live4's brain (docs/minicpm-o-finetune.md, "The brain against Gemma 26B"): medical knowledge from bigger models
    # (tools/omni-data/knowledge.py: OpenMed Mega, medical-o1, MedReason, MedGemma 27B, Malay by Gemma), with replays of
    # the spoken questions, hearing, plan answers and labels so those skills stay. Text only plus sft-audio.tar and the
    # label images; hear2's real speech (sft-audio2.tar) is not replayed.
    snapshot_download("zhiyuantechnology/sona-minicpmo-data", repo_type="dataset", local_dir=out, token=token, max_workers=2,
                      allow_patterns=["sft/*.json", "see/train.json", "packs/sft-audio.tar", "packs/see-images.tar"])
    for tar, part in (("sft-audio.tar", "sft"), ("see-images.tar", "see")):
        with tarfile.open(out / "packs" / tar) as t:
            t.extractall(out / part)
    rng = random.Random(3)
    take = lambda rows, n: rows if n >= len(rows) else rng.sample(rows, n)
    load = lambda p: json.loads((out / p).read_text()) if (out / p).exists() else []
    n = lambda k, d: int(os.environ.get(k, d))
    strip = lambda rows: [{"messages": r["messages"]} for r in rows]  # source/lang tags are not LLaMA-Factory columns
    sets = {  # name: (rows, has audio, has images)
        "knowledge": (strip(load("sft/knowledge.json")), False, False),
        "knowledge_ms": (strip(load("sft/knowledge_ms.json")), False, False),
        "knowledge_medgemma": (strip(load("sft/knowledge_medgemma.json")), False, False),
        "med_replay": (take(load("sft/answer_med.json"), n("MED_REPLAY", 2000)), False, False),
        "hear_answer": (load("sft/hear_answer_words.json"), True, False),  # numbers as words, as live3 and live4 speak them
        "hear_replay": (take(load("sft/hear.json"), n("HEAR_REPLAY", 800)), True, False),
        "answer_replay": (take(load("sft/answer.json"), n("ANSWER_REPLAY", 800)), False, False),
        "see_replay": (take(load("see/train.json"), n("SEE_REPLAY", 300)), False, True),
    }
    sets = {k: v for k, v in sets.items() if v[0]}
    tags = {"role_tag": "role", "content_tag": "content", "user_tag": "user", "assistant_tag": "assistant", "system_tag": "system"}
    info = {}
    for name, (rows, audio, images) in sets.items():
        base = out / ("see" if images else "sft")
        for r in rows:
            if audio: r["audios"] = [str(base / a) for a in r["audios"]]
            if images: r["images"] = [str(base / i) for i in r["images"]]
        (out / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False))
        cols = {"messages": "messages", **({"audios": "audios"} if audio else {}), **({"images": "images"} if images else {})}
        info[name] = {"file_name": f"{name}.json", "formatting": "sharegpt", "columns": cols, "tags": tags}
        print(name, len(rows), flush=True)
    (out / "dataset_info.json").write_text(json.dumps(info, indent=2))
elif mode == "stage2":
    # Stage 2 continues from stage 1 (run.sh FROM=stage1): the new sets whole, and a replay of stage 1's so it keeps them
    # (docs/minicpm-o-finetune.md, run log). New: sft/answer_med.json (medical answers in en/ms/zh, tools/omni-data) and
    # sft/hear2.json (more Manglish, real Malaysian speech and Sona's medical words, audio in packs/sft-audio2.tar).
    # Test sets never train: sft/eval.json, med_eval.json, hear2_test.json, see/test.json.
    snapshot_download("zhiyuantechnology/sona-minicpmo-data", repo_type="dataset", local_dir=out, token=token, max_workers=2,
                      allow_patterns=["sft/*.json", "see/train.json", "packs/sft-audio.tar", "packs/sft-audio2.tar", "packs/see-images.tar"])
    for tar, part in (("sft-audio.tar", "sft"), ("sft-audio2.tar", "sft"), ("see-images.tar", "see")):
        with tarfile.open(out / "packs" / tar) as t:
            t.extractall(out / part)
    rng = random.Random(2)
    take = lambda rows, n: rows if n >= len(rows) else rng.sample(rows, n)
    load = lambda p: json.loads((out / p).read_text())
    n = lambda k, d: int(os.environ.get(k, d))
    # hear2: every real-speech and Sona-voice row, then synthetic Manglish up to HEAR2_N; REAL=0 leaves out the real speech
    # (MagicHub corpora, CC BY-NC-ND 4.0: demo-only, and "no derivatives" may rule out training at all; user's call).
    hear2 = [r for r in load("sft/hear2.json") if os.environ.get("REAL", "1") == "1" or "BY-NC-ND" not in r.get("source", "")]
    keep = [r for r in hear2 if "manglish-asr" not in r.get("source", "")]
    hear2 = keep + take([r for r in hear2 if "manglish-asr" in r.get("source", "")], max(0, n("HEAR2_N", 8000) - len(keep)))
    sets = {  # name: (rows, has audio, has images)
        "med": (load("sft/answer_med.json"), False, False),
        "hear2": (hear2, True, False),
        "hear_answer": (load("sft/hear_answer.json"), True, False),  # every spoken question: the live call's own task
        "hear_replay": (take(load("sft/hear.json"), n("HEAR_REPLAY", 1000)), True, False),
        "answer_replay": (take(load("sft/answer.json"), n("ANSWER_REPLAY", 1500)), False, False),
        "see_replay": (take(load("see/train.json"), n("SEE_REPLAY", 500)), False, True),
    }
    tags = {"role_tag": "role", "content_tag": "content", "user_tag": "user", "assistant_tag": "assistant", "system_tag": "system"}
    info = {}
    for name, (rows, audio, images) in sets.items():
        base = out / ("see" if images else "sft")
        for r in rows:  # absolute media paths, so every set can sit in one dataset_dir
            if audio: r["audios"] = [str(base / a) for a in r["audios"]]
            if images: r["images"] = [str(base / i) for i in r["images"]]
        (out / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False))
        cols = {"messages": "messages", **({"audios": "audios"} if audio else {}), **({"images": "images"} if images else {})}
        info[name] = {"file_name": f"{name}.json", "formatting": "sharegpt", "columns": cols, "tags": tags}
        print(name, len(rows), flush=True)
    (out / "dataset_info.json").write_text(json.dumps(info, indent=2))
else:  # sft/ (tools/omni-data) and see/ (tools/omni-eyes) side by side; media paths in both are relative (audio/, images/)
    # Media comes as one tar per set (packs/): thousands of per-file downloads hit Hugging Face's 1000 requests / 5 min.
    parts = ["sft", "see"] if os.environ.get("EYES", "1") == "1" else ["sft"]
    packs = {"sft": "packs/sft-audio.tar", "see": "packs/see-images.tar"}
    snapshot_download("zhiyuantechnology/sona-minicpmo-data", repo_type="dataset", local_dir=out, token=token,
                      allow_patterns=[f"{p}/*.json" for p in parts] + [packs[p] for p in parts], max_workers=2)
    for p in parts:
        with tarfile.open(out / packs[p]) as t:
            t.extractall(out / p)
    info = {}
    for p in parts:
        for name, entry in json.loads((out / p / "dataset_info.json").read_text()).items():
            if not name.endswith("_test"): info[name] = entry  # test sets never train (sft's eval.json is not registered)
        for f in (out / p).iterdir():
            if f.name != "dataset_info.json": f.rename(out / f.name)
    (out / "dataset_info.json").write_text(json.dumps(info, indent=2))
print("data ready:", {p.name: p.stat().st_size for p in out.glob("*.json")})

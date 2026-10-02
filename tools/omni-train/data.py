"""Training data for run.sh, in LLaMA-Factory's sharegpt audio format (messages + audios, one "<audio>" per clip).

smoke: 200 clips of zhiyuantechnology/sona-manglish-asr (train split) as "write down exactly what was said", enough to
prove loading, training, merging and restoring on the H100. full: the stage 1 sets from zhiyuantechnology/sona-minicpmo-data
(config "sft", built by tools/omni-data/), downloaded as written there. stage2: the new sets plus a replay of stage 1's.
Usage: python data.py smoke|full|stage2 <out_dir>   (needs HF_TOKEN for the private datasets)
"""
import json, os, random, sys, tarfile
from pathlib import Path

from datasets import Audio, load_dataset
from huggingface_hub import snapshot_download

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

"""Score MiniCPM-o versions on the held-out sets (docs/minicpm-o-finetune.md, pass bars), on the model's own transformers.

hear:   250 clips never trained on (150 sona-manglish-asr test with held-out voices, 50 FLEURS ms, 25 en, 25 zh test),
        "Write down exactly what was said.", mixed error rate as tools/asr-data/baseline.py counts it.
answer: the 120 held-out questions of sona-minicpmo-data sft/eval.json: replies saved for judging; red flags must say 999.
see:    100 of the 300 held-out label photos (see/test.json): name and strength read exactly; unreadable ones ask again.
Writes eval/<name>.json to the dataset repo (needs HF_WRITE_TOKEN) and prints a summary.
Usage: python eval.py <name>=<model dir or hf repo@revision> ...
"""
import io, json, os, random, re, sys, tarfile
from pathlib import Path

import librosa, numpy as np, pyarrow.parquet as pq, torch
from datasets import Audio, load_dataset
from huggingface_hub import HfApi, hf_hub_download, snapshot_download
from PIL import Image
from transformers import AutoModel, AutoTokenizer

DATA = "zhiyuantechnology/sona-minicpmo-data"
token, wtoken = os.environ.get("HF_TOKEN"), os.environ.get("HF_WRITE_TOKEN")
work = Path("/workspace/eval"); work.mkdir(parents=True, exist_ok=True)


def toks(s):  # as tools/asr-data/baseline.py
    return re.findall(r"[一-鿿]|[a-z0-9]+(?:[-'][a-z0-9]+)*", s.lower())


def ed(a, b):
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, y in enumerate(b, 1): p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (x != y))
    return d[-1]


def hear_set():
    rows = []
    asr = load_dataset("zhiyuantechnology/sona-manglish-asr", split="test", token=token).cast_column("audio", Audio(decode=False))
    for i in random.Random(1).sample(range(len(asr)), 150):
        r = asr[i]
        rows.append(("manglish", librosa.load(io.BytesIO(r["audio"]["bytes"]), sr=16000)[0], r["text"]))
    for lang, n, tag in (("ms_my", 50, "fleurs_ms"), ("en_us", 25, "fleurs_en"), ("cmn_hans_cn", 25, "fleurs_zh")):
        t = pq.read_table(hf_hub_download("google/fleurs", f"parquet-data/{lang}/test-00000-of-00001.parquet", repo_type="dataset")).to_pylist()
        for r in random.Random(1).sample(t, n):
            x, sr = librosa.load(io.BytesIO(r["audio"]["bytes"]), sr=16000)
            rows.append((tag, x, r["transcription"] if "transcription" in r else r["raw_transcription"]))
    return rows


snapshot_download(DATA, repo_type="dataset", local_dir=work, token=token,
                  allow_patterns=["sft/eval.json", "sft/med_eval.json", "sft/hear2_test.json", "see/test.json", "packs/see-images.tar", "packs/sft-audio2.tar"])
with tarfile.open(work / "packs/see-images.tar") as tf:  # one tar: per-file downloads hit Hugging Face's rate limit
    tf.extractall(work / "see")
if (work / "packs/sft-audio2.tar").exists():  # stage 2's held-out real Malaysian speech (sft/hear2_test.json)
    with tarfile.open(work / "packs/sft-audio2.tar") as tf:
        tf.extractall(work / "sft")
HEAR = hear_set()
if (work / "sft/hear2_test.json").exists():  # real speech, never trained: tagged by its source's language
    for r in json.loads((work / "sft/hear2_test.json").read_text()):
        HEAR.append(("real_" + r.get("lang", "mixed"), librosa.load(str(work / "sft" / r["audios"][0]), sr=16000)[0], r["messages"][-1]["content"]))
MED = json.loads((work / "sft/med_eval.json").read_text()) if (work / "sft/med_eval.json").exists() else []
ASK = json.loads((work / "sft/eval.json").read_text())
SEE = random.Random(1).sample(json.loads((work / "see/test.json").read_text()), 100)
print(f"sets: hear {len(HEAR)}, answer {len(ASK)}, medical {len(MED)}, see {len(SEE)}", flush=True)

for spec in sys.argv[1:]:
    name, src = spec.split("=", 1)
    path = src
    if not Path(src).exists():
        repo, _, rev = src.partition("@")
        path = snapshot_download(repo, revision=rev or None, token=token, ignore_patterns=["lora-adapter/*"])
    model = AutoModel.from_pretrained(path, trust_remote_code=True, attn_implementation="sdpa", torch_dtype=torch.bfloat16,
                                      init_vision=True, init_audio=True, init_tts=False).eval().cuda()
    tok = AutoTokenizer.from_pretrained(path, trust_remote_code=True)
    chat = lambda msgs: model.chat(msgs=msgs, tokenizer=tok, do_sample=False, max_new_tokens=200)
    out = {"name": name, "source": src, "hear": [], "answer": [], "see": []}

    errs = {}
    for tag, x, ref in HEAR:
        hyp = chat([{"role": "user", "content": [x, "Write down exactly what was said."]}])
        e, n = ed(toks(ref), toks(hyp)), len(toks(ref))
        s = errs.setdefault(tag, [0, 0]); s[0] += e; s[1] += n
        out["hear"].append({"set": tag, "ref": ref, "hyp": hyp, "errors": e, "words": n})
    hear_rates = {k: round(e / n, 4) for k, (e, n) in errs.items()}

    red = [0, 0]
    for q in ASK:
        reply = chat([{"role": "system", "content": q["system"]}, {"role": "user", "content": [q["question"]]}])
        out["answer"].append({**{k: q[k] for k in ("id", "kind", "lang", "question", "expected", "must_999")}, "reply": reply})
        if q.get("must_999"): red[0] += "999" in reply; red[1] += 1

    out["med"] = []  # held-out medical questions in en/ms/zh (tools/omni-data): replies saved for judging
    for q in MED:
        reply = chat([{"role": "system", "content": q["messages"][0]["content"]}, {"role": "user", "content": [q["messages"][1]["content"]]}])
        out["med"].append({"lang": q.get("lang"), "src": q.get("src"), "question": q["messages"][1]["content"],
                           "reference": q["messages"][2]["content"], "source_answer": q.get("reference"), "reply": reply})

    see_ok = see_n = unread_ok = unread_n = 0
    for r in SEE:
        img = Image.open(work / "see" / r["images"][0]).convert("RGB")
        question = r["messages"][0]["content"].replace("<image>", "")
        reply = chat([{"role": "user", "content": [img, question]}])
        exp = r["expected"]
        if exp.get("unreadable"):
            unread_n += 1; unread_ok += bool(re.search(r"photo|picture|gambar|foto|照片|图片|clear|jelas|清楚", reply, re.I))
        else:
            see_n += 1
            see_ok += exp["name"].lower() in reply.lower() and (not exp.get("strength") or exp["strength"].replace(" ", "").lower() in reply.replace(" ", "").lower())
        out["see"].append({"question": question, "expected": exp, "reply": reply})

    out["summary"] = {"hear_error_rate": hear_rates, "red_flags_999": f"{red[0]}/{red[1]}",
                      "see_name_strength": f"{see_ok}/{see_n}", "see_unreadable_asks_again": f"{unread_ok}/{unread_n}"}
    print(name, json.dumps(out["summary"], ensure_ascii=False), flush=True)
    f = work / f"{name}.json"; f.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    if wtoken:
        HfApi(token=wtoken).upload_file(path_or_fileobj=str(f), path_in_repo=f"eval/{name}.json", repo_id=DATA, repo_type="dataset",
                                        commit_message=f"eval: {name}")
    del model; torch.cuda.empty_cache()

"""Medical knowledge of MiniCPM-o versions (docs/minicpm-o-finetune.md, run log), on public benchmarks:
- Global-MMLU's medical questions (CohereLabs/Global-MMLU, Apache-2.0): the same 500 multiple-choice questions in
  English, Malay and Mandarin, answered with a letter; accuracy per language.
- K-QA (github.com/Itaymanes/K-QA, MIT): 100 real patient questions, answered as Sona answers live (liveBrief, no plan);
  replies are saved for judging against the physicians' must-have statements (comprehensive, and nothing contradicted).
Chat mode, greedy, on the model's own transformers (4.51). Writes eval/bench-<name>.json to the dataset repo.
Usage: python bench.py <name>=<model dir or repo@revision> ...
"""
import json, os, random, re, sys, urllib.request
from pathlib import Path

import pyarrow.parquet as pq, torch
from huggingface_hub import HfApi, hf_hub_download, snapshot_download
from transformers import AutoModel, AutoTokenizer

DATA = "zhiyuantechnology/sona-minicpmo-data"
token, wtoken = os.environ.get("HF_TOKEN"), os.environ.get("HF_WRITE_TOKEN")
ASK = {"en": "Answer with the letter of the correct option only.", "ms": "Jawab dengan huruf pilihan yang betul sahaja.",
       "zh": "只用正确选项的字母回答。"}
# liveBrief(undefined, "en") in packages/api/src/voice-agent/live.ts: what box ④'s brain is told on a call
BRIEF = """You are Sona Care, a hospital's assistant for its patients, talking with one patient by voice. Answer whatever they ask: their own care, any other health or medicine question, or anything else. For their own medicines, doses and appointments, use their discharge plan below: it is their record.
How to answer:
- Plain and kind, at a reading age of about 12, at most 3 short sentences. The first has at most 10 words: it is spoken while you write the rest. No lists, symbols or markdown: they are read aloud.
- In the language the patient spoke (Malay, English or Chinese).
- If urgent, tell them to call 999 now.
When they mix languages, or you cannot tell, answer in English.

Discharge plan:
None yet: they are still in hospital."""

mmlu = {}
for lang in ASK:
    rows = pq.read_table(hf_hub_download("CohereLabs/Global-MMLU", f"{lang}/test-00000-of-00001.parquet", repo_type="dataset")).to_pylist()
    mmlu[lang] = {r["sample_id"]: r for r in rows if r["subject_category"] == "Medical"}
SMOKE = bool(os.environ.get("SMOKE"))  # a few questions, on whatever GPU is here (the Mac), to test the script
ids = random.Random(1).sample(sorted(set.intersection(*(set(m) for m in mmlu.values()))), 5 if SMOKE else 500)
kqa = [json.loads(l) for l in urllib.request.urlopen("https://raw.githubusercontent.com/Itaymanes/K-QA/main/dataset/questions_w_answers.jsonl").read().decode().splitlines() if l.strip()]
kqa = random.Random(1).sample(kqa, 2 if SMOKE else 100)
print(f"sets: Global-MMLU medical {len(ids)} x {len(ASK)} languages, K-QA {len(kqa)}", flush=True)

for spec in sys.argv[1:]:
    name, src = spec.split("=", 1)
    path = src
    if not Path(src).exists():
        repo, _, rev = src.partition("@")
        path = snapshot_download(repo, revision=rev or None, token=token, ignore_patterns=["lora-adapter/*", "assets/*"])
    cuda = torch.cuda.is_available()
    model = AutoModel.from_pretrained(path, trust_remote_code=True, attn_implementation="sdpa", torch_dtype=torch.bfloat16 if cuda else torch.float16,
                                      init_vision=False, init_audio=False, init_tts=False).eval().to("cuda" if cuda else "mps")
    tok = AutoTokenizer.from_pretrained(path, trust_remote_code=True)
    chat = lambda msgs, n: model.chat(msgs=msgs, tokenizer=tok, do_sample=False, max_new_tokens=n)
    out = {"name": name, "source": src, "mmlu": {}, "kqa": []}
    for lang in ASK:
        right, rows = 0, []
        for i in ids:
            r = mmlu[lang][i]
            q = f"{r['question']}\nA. {r['option_a']}\nB. {r['option_b']}\nC. {r['option_c']}\nD. {r['option_d']}\n{ASK[lang]}"
            reply = chat([{"role": "user", "content": [q]}], 8)
            got = (re.search(r"(?<![A-Za-z])[ABCD](?![A-Za-z])", reply) or [None])[0]  # a lone letter: "Jawapan ... B" is B, not the A in Jawapan
            right += got == r["answer"]
            rows.append({"id": i, "subject": r["subject"], "answer": r["answer"], "got": got, "reply": reply})
        out["mmlu"][lang] = {"accuracy": round(right / len(ids), 4), "rows": rows}
        print(name, lang, f"Global-MMLU medical {right}/{len(ids)} = {100 * right / len(ids):.1f}%", flush=True)
    for r in kqa:
        reply = chat([{"role": "system", "content": BRIEF}, {"role": "user", "content": [r["Question"]]}], 200)
        out["kqa"].append({"question": r["Question"], "must_have": r.get("Must_have"), "physician": r.get("Free_form_answer"), "reply": reply})
    print(name, "K-QA replies saved", len(out["kqa"]), flush=True)
    f = Path(os.environ.get("OUT", "/workspace")) / f"bench-{name}.json"; f.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    if wtoken and not SMOKE:
        HfApi(token=wtoken).upload_file(path_or_fileobj=str(f), path_in_repo=f"eval/bench-{name}.json", repo_id=DATA,
                                        repo_type="dataset", commit_message=f"bench: {name}")
    del model
    if cuda: torch.cuda.empty_cache()

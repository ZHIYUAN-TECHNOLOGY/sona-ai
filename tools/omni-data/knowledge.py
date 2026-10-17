"""Medical knowledge for live4's brain (docs/minicpm-o-finetune.md, "The brain against Gemma 26B"): answers written by
models bigger than Gemma, from open sets, with every test question left out.

  python knowledge.py open        # sft/knowledge.json: OpenMed Mega, medical-o1 (en, zh) and MedReason, plus the two
                                  # work lists below
  python knowledge.py teach       # MedGemma 27B (box ⑥) answers consumer questions (MedQuAD, K-QA outside the test)
  python knowledge.py malay       # Gemma 26B (box ①) translates a mix into Malaysian Malay
  python knowledge.py publish     # uploads sft/knowledge.json, knowledge_ms.json and knowledge_medgemma.json

Rows are LLaMA-Factory sharegpt messages (user, assistant). Answers are the sources' final answers, never their reasoning,
kept to at most 1,800 characters so a step stays cheap; markdown is flattened, since Sona speaks.
Licences: OpenMed Mega is demo-only (scraped forum prompts inside, docs/research/omni-training-datasets.md); medical-o1
and MedReason are Apache-2.0; MedGemma's answers fall under Google's Health AI Developer Foundations terms.
"""
import json, os, random, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

OUT = Path.home() / "zyt/data/sona-omni/knowledge"
DATA = "zhiyuantechnology/sona-minicpmo-data"
MEDQUAD = ("lavita/MedQuAD", "data/train-00000-of-00001-e36383d177026d53.parquet")
norm = lambda s: re.sub(r"[^a-z0-9一-鿿]+", " ", s.lower()).strip()[:80]
flat = lambda s: re.sub(r"\n{2,}", "\n", re.sub(r"(?m)^#+\s*|\*\*|__|^\s*[-*]\s+", "", s)).strip()
row = lambda q, a, src, lang: {"messages": [{"role": "user", "content": q}, {"role": "assistant", "content": a}], "source": src, "lang": lang}


def tests():
    """Normalised starts of every question we score on, so none of them trains."""
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download
    seen = set()
    for lang in ("en", "ms", "zh"):
        for r in pq.read_table(hf_hub_download("CohereLabs/Global-MMLU", f"{lang}/test-00000-of-00001.parquet", repo_type="dataset")).to_pylist():
            if r["subject_category"] == "Medical": seen.add(norm(r["question"]))
    kqa = urllib.request.urlopen("https://raw.githubusercontent.com/Itaymanes/K-QA/main/dataset/questions_w_answers.jsonl").read().decode()
    seen |= {norm(json.loads(l)["Question"]) for l in kqa.splitlines() if l.strip()}
    for f in ("sft/eval.json", "sft/med_eval.json"):
        for q in json.load(open(hf_hub_download(DATA, f, repo_type="dataset"))):
            seen.add(norm(q["question"] if "question" in q else q["messages"][-2]["content"]))
    return seen


def chat(base, key, model, messages, max_tokens, temperature=0.3):
    body = json.dumps({"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens,
                       "chat_template_kwargs": {"enable_thinking": False}}).encode()
    for _ in range(4):
        try:
            req = urllib.request.Request(f"{base}/sync/v1/chat/completions", data=body, method="POST",
                                         headers={"Authorization": f"Api-Key {key}", "Content-Type": "application/json"})
            return json.load(urllib.request.urlopen(req, timeout=300))["choices"][0]["message"].get("content") or ""
        except Exception:
            pass
    return ""


def run(jobs, fn, path):
    """fn on every job not yet in path (JSONL, resumable), 24 at a time."""
    done = {json.loads(l)["id"] for l in path.read_text().splitlines()} if path.exists() else set()
    todo = [j for j in jobs if j["id"] not in done]
    print(len(jobs), "jobs,", len(todo), "to do", flush=True)
    with ThreadPoolExecutor(24) as pool, open(path, "a") as log:
        for j, out in zip(todo, pool.map(fn, todo)):
            if out: log.write(json.dumps({**j, "out": out}, ensure_ascii=False) + "\n"); log.flush()


if sys.argv[1] == "open":
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download
    OUT.mkdir(parents=True, exist_ok=True)
    skip, rng, rows = tests(), random.Random(4), []
    ok = lambda q, a: q and a and norm(q) not in skip and len(a) <= 1800
    mega = []
    for shard in (0, 1):
        t = pq.read_table(hf_hub_download("OpenMed/Medical-Reasoning-SFT-Mega", f"data/train-{shard:05d}-of-00034.parquet", repo_type="dataset", local_dir=OUT))
        for r in t.to_pylist():
            m = [x for x in r["messages"] if x["role"] in ("user", "assistant")]
            if len(m) == 2 and ok(m[0]["content"], m[1]["content"]): mega.append(row(m[0]["content"], flat(m[1]["content"]), "openmed-mega", "en"))
    rows += rng.sample(mega, min(int(os.environ.get("MEGA_N", 15000)), len(mega)))
    for f, lang in (("medical_o1_sft.json", "en"), ("medical_o1_sft_Chinese.json", "zh")):
        o1 = [row(r["Question"], flat(r["Response"]), "medical-o1", lang) for r in json.load(open(hf_hub_download("FreedomIntelligence/medical-o1-reasoning-SFT", f, repo_type="dataset")))
              if ok(r["Question"], r["Response"])]
        rows += rng.sample(o1, min(6000, len(o1)))
    mr = [json.loads(l) for l in open(hf_hub_download("UCSC-VLAA/MedReason", "ours_quality_33000.jsonl", repo_type="dataset"))]
    mr = [row(f"{r['question']}\n{r['options']}".strip(), flat(r["answer"]), "medreason", "en") for r in mr if ok(r["question"], r["answer"])]
    rows += rng.sample(mr, min(6000, len(mr)))
    (OUT / "knowledge.json").write_text(json.dumps(rows, ensure_ascii=False))
    print({s: sum(r["source"] == s for r in rows) for s in ("openmed-mega", "medical-o1", "medreason")}, len(rows), "rows", flush=True)
    # Work lists: a Malay mix (MedReason, medical-o1 en) for Gemma, and consumer questions for MedGemma.
    en = [r for r in rows if r["lang"] == "en" and r["source"] in ("medreason", "medical-o1")]
    (OUT / "malay_src.json").write_text(json.dumps([{"id": f"ms{i:05d}", "q": r["messages"][0]["content"], "a": r["messages"][1]["content"]}
                                                    for i, r in enumerate(rng.sample(en, min(6000, len(en))))], ensure_ascii=False))
    mq = [r["question"] for r in pq.read_table(hf_hub_download(*MEDQUAD, repo_type="dataset")).to_pylist()
          if r.get("question") and norm(r["question"]) not in skip]
    mq = list(dict.fromkeys(mq))
    (OUT / "teach_src.json").write_text(json.dumps([{"id": f"mg{i:05d}", "q": q} for i, q in enumerate(rng.sample(mq, min(6000, len(mq))))], ensure_ascii=False))
    print("work lists: malay", len(json.load(open(OUT / "malay_src.json"))), "teach", len(json.load(open(OUT / "teach_src.json"))), flush=True)

elif sys.argv[1] == "teach":
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download
    base, key = os.environ["TEACHER_BASE"], os.environ["BASETEN_API_KEY"]
    SYS = ("You are a careful physician answering a patient's health question. Answer accurately and plainly in at most 6 "
           "sentences, with the key facts, the usual dose or timing when relevant, the cautions that matter, and when to see a "
           "doctor or call 999. No markdown. When an NIH reference is given, keep to its facts.")
    # MedQuAD's NIH answer, where it kept one (GARD, GHR and other NIH sources; not ADAM or MedlinePlus drugs): MedGemma alone
    # made up rare-disease facts (2 Oct: isobutyryl-CoA dehydrogenase deficiency "breaks down leucine"; it is valine).
    ref = {r["question"]: r["answer"] for r in pq.read_table(hf_hub_download(*MEDQUAD, repo_type="dataset")).to_pylist() if r.get("answer")}
    ask = lambda q: q + (f"\n\nNIH reference:\n{ref[q][:4000]}" if q in ref else "")
    run(json.load(open(OUT / "teach_src.json")), lambda j: chat(base, key, "medgemma-27b", [{"role": "system", "content": SYS},
        {"role": "user", "content": ask(j["q"])}], 400), OUT / "teach.jsonl")

elif sys.argv[1] == "malay":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "omni-voice"))
    from lines import BASE, KEY, MODEL, wait_for_box  # noqa: E402  (box ① and the Worker's invoke-only key)
    wait_for_box()
    ASK = ("Translate this medical question and answer into Bahasa Melayu as Malaysians write it (not Indonesian). Keep drug "
           "names, numbers, units and option letters as they are. Answer with JSON only: {\"q\": \"...\", \"a\": \"...\"}.\n\n")

    def tr(j):
        text = chat(BASE, KEY, MODEL, [{"role": "user", "content": ASK + json.dumps({"q": j["q"], "a": j["a"]}, ensure_ascii=False)}], 1500, 0.2)
        try:
            d = json.loads(text[text.index("{"): text.rindex("}") + 1])
            return d if d.get("q") and d.get("a") else None
        except Exception:
            return None
    run(json.load(open(OUT / "malay_src.json")), tr, OUT / "malay.jsonl")

elif sys.argv[1] == "publish":
    from huggingface_hub import HfApi
    # MedGemma ends most answers with "call 999 if ..." because the teach prompt asked for it, and the live call already
    # sends patients to 999 too readily (live3, 2 Oct: 999 for a cough). That last sentence goes, except on poisoning,
    # overdose and emergency questions.
    urgent = re.compile(r"poison|overdose|ingest|swallow|emergenc", re.I)
    def calm(q, a):
        s = re.split(r"(?<=[.!?])\s+", a.strip())
        return " ".join(s[:-1]) if len(s) > 2 and "999" in s[-1] and not urgent.search(q) else a
    ms = [row(x["out"]["q"], flat(x["out"]["a"]), "gemma-malay", "ms") for x in map(json.loads, (OUT / "malay.jsonl").read_text().splitlines())]
    mg = [row(x["q"], calm(x["q"], flat(x["out"])), "medgemma-27b", "en") for x in map(json.loads, (OUT / "teach.jsonl").read_text().splitlines()) if len(x["out"]) > 40]
    # Rows that send the patient to 911 (US) teach the wrong number for Malaysia.
    k = [r for r in json.load(open(OUT / "knowledge.json")) if not re.search(r"\b911\b", r["messages"][1]["content"])]
    (OUT / "knowledge.json").write_text(json.dumps(k, ensure_ascii=False))
    (OUT / "knowledge_ms.json").write_text(json.dumps(ms, ensure_ascii=False)); (OUT / "knowledge_medgemma.json").write_text(json.dumps(mg, ensure_ascii=False))
    api = HfApi(token=(Path.home() / ".cache/huggingface/token_write").read_text().strip())
    for f in ("knowledge.json", "knowledge_ms.json", "knowledge_medgemma.json"):
        api.upload_file(path_or_fileobj=str(OUT / f), path_in_repo=f"sft/{f}", repo_id=DATA, repo_type="dataset", commit_message=f"live4: {f}")
    print("published: open", len(json.load(open(OUT / "knowledge.json"))), "malay", len(ms), "medgemma", len(mg), flush=True)

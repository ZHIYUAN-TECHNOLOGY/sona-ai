"""Gemma 4 26B (box ①, today's call's brain) on the tests MiniCPM-o's brain was scored on, so "match Gemma" has a number
(docs/minicpm-o-finetune.md): the same 500 Global-MMLU medical questions in en/ms/zh (ids from eval/bench-stage2.json), the
same K-QA questions with the live brief (bench.py), and the 90 non-emergency plan questions of sft/eval.json.
Greedy, through box ①'s OpenAI-style API; 16 requests at a time. Writes ~/zyt/data/sona-omni/gemma-bench.json.
Usage: python3 gemma_bench.py   (wakes box ① first; needs huggingface_hub and pyarrow)
Another box: BENCH_BASE (its environment URL), BENCH_MODEL, BENCH_KEY and BENCH_NAME, e.g. MedGemma 27B (box ⑥).
"""
import json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pyarrow.parquet as pq
from huggingface_hub import hf_hub_download

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "omni-voice"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "omni-train"))
from lines import BASE, KEY, MODEL, wait_for_box  # noqa: E402  (box ① and the Worker's invoke-only key)
BASE, MODEL, KEY = os.environ.get("BENCH_BASE", BASE), os.environ.get("BENCH_MODEL", MODEL), os.environ.get("BENCH_KEY", KEY)
NAME = os.environ.get("BENCH_NAME", "gemma")

DATA = "zhiyuantechnology/sona-minicpmo-data"
ASK = {"en": "Answer with the letter of the correct option only.", "ms": "Jawab dengan huruf pilihan yang betul sahaja.", "zh": "只用正确选项的字母回答。"}
BRIEF = re.search(r'BRIEF = """(.*?)"""', (Path(__file__).resolve().parents[1] / "omni-train/bench.py").read_text(), re.S).group(1)


def chat(messages, max_tokens):
    body = json.dumps({"model": MODEL, "messages": messages, "temperature": 0, "max_tokens": max_tokens,
                       "chat_template_kwargs": {"enable_thinking": False}}).encode()
    for attempt in range(4):
        try:
            req = urllib.request.Request(f"{BASE}/sync/v1/chat/completions", data=body, method="POST",
                                         headers={"Authorization": f"Api-Key {KEY}", "Content-Type": "application/json"})
            return json.load(urllib.request.urlopen(req, timeout=300))["choices"][0]["message"].get("content") or ""
        except Exception as e:
            err = e
    return f"<error {err}>"


if __name__ == "__main__":
    if "BENCH_BASE" not in os.environ: wait_for_box()
    s2 = json.load(open(hf_hub_download(DATA, "eval/bench-stage2.json", repo_type="dataset")))
    ev = json.load(open(hf_hub_download(DATA, "eval/stage2.json", repo_type="dataset")))
    plan_q = {q["id"]: q for q in json.load(open(hf_hub_download(DATA, "sft/eval.json", repo_type="dataset")))}
    out = {"name": MODEL, "mmlu": {}, "kqa": [], "answer": []}
    with ThreadPoolExecutor(16) as pool:
        for lang in ASK:
            rows = {r["sample_id"]: r for r in pq.read_table(hf_hub_download("CohereLabs/Global-MMLU", f"{lang}/test-00000-of-00001.parquet",
                                                                             repo_type="dataset")).to_pylist()}
            ids = [r["id"] for r in s2["mmlu"][lang]["rows"]]
            qs = [rows[i] for i in ids]
            prompts = [f"{r['question']}\nA. {r['option_a']}\nB. {r['option_b']}\nC. {r['option_c']}\nD. {r['option_d']}\n{ASK[lang]}" for r in qs]
            replies = list(pool.map(lambda p: chat([{"role": "user", "content": p}], int(os.environ.get("BENCH_MC_TOKENS", 8))), prompts))
            # A lone letter after any thinking (MedGemma 27B thinks on its own, <unused94>...<unused95>; give it BENCH_MC_TOKENS=1024)
            got = [(re.search(r"(?<![A-Za-z])[ABCD](?![A-Za-z])", re.sub(r"<unused94>.*?(?:<unused95>|$)", "", x, flags=re.S)) or [None])[0] for x in replies]
            right = sum(g == r["answer"] for g, r in zip(got, qs))
            out["mmlu"][lang] = {"accuracy": round(right / len(qs), 4), "answered": sum(g is not None for g in got),
                                 "rows": [{"id": r["sample_id"], "answer": r["answer"], "got": g, "reply": x} for r, g, x in zip(qs, got, replies)]}
            print(lang, f"Global-MMLU medical {right}/{len(qs)} = {100 * right / len(qs):.1f}%", flush=True)
        kqa = s2["kqa"]
        for r, reply in zip(kqa, pool.map(lambda r: chat([{"role": "system", "content": BRIEF}, {"role": "user", "content": r["question"]}], 200), kqa)):
            out["kqa"].append({"question": r["question"], "must_have": r["must_have"], "reply": reply})
        items = [a for a in ev["answer"] if not a.get("must_999")]
        for a, reply in zip(items, pool.map(lambda a: chat([{"role": "system", "content": plan_q[a["id"]]["system"]},
                                                             {"role": "user", "content": a["question"]}], 200), items)):
            out["answer"].append({"id": a["id"], "question": a["question"], "reply": reply})
    f = Path.home() / f"zyt/data/sona-omni/{NAME}-bench.json"
    f.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print("K-QA", len(out["kqa"]), "plan answers", len(out["answer"]), "->", f, flush=True)

"""Score evaluators on baseline.jsonl: accuracy per question, misses, and time per request.

python score.py laya            # local Laya (pip install laya); first run downloads ~1 GB
python score.py gemma           # OpenAI-compatible endpoint: GEMMA_URL, GEMMA_MODEL, GEMMA_KEY
"""
import json, os, statistics, sys, time, urllib.request
from check import items, request

MODEL = os.environ.get("LAYA_MODEL", "convaiinnovations/laya-multilingual")


def laya_evaluator():
    import laya
    agent = laya.load(MODEL)
    return lambda r: {k: v["choice"] for k, v in agent.predict(r["state"], r["questions"])["answers"].items()}


def gemma_evaluator():
    url, model, key = os.environ["GEMMA_URL"], os.environ["GEMMA_MODEL"], os.environ.get("GEMMA_KEY", "")

    def evaluate(r):
        prompt = (f"State: {json.dumps(r['state'], ensure_ascii=False)}\n"
                  f"Questions: {json.dumps(r['questions'], ensure_ascii=False)}\n"
                  'For each question pick exactly one criteria key. Reply with JSON only: {"<question>": "<key>"}')
        body = {"model": model, "temperature": 0, "response_format": {"type": "json_object"},
                "messages": [{"role": "user", "content": prompt}]}
        req = urllib.request.Request(f"{url}/chat/completions", json.dumps(body).encode(),
                                     {"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req, timeout=60) as res:
            content = json.load(res)["choices"][0]["message"]["content"]
        # Google's endpoint prepends Gemma's <thought> block and can't turn it off.
        return json.loads(content.rsplit("</thought>", 1)[-1])
    return evaluate


def score(evaluate):
    requests = [{"id": i["id"], "request": i["request"], **request(i)} for i in items]
    evaluate(requests[0])  # warm-up, not timed
    hits, misses, times = {q: 0 for q in requests[0]["gold"]}, [], []
    for r in requests:
        start = time.perf_counter()
        got = evaluate(r)
        times.append((time.perf_counter() - start) * 1000)
        for q, gold in r["gold"].items():
            if got.get(q) == gold: hits[q] += 1
            else: misses.append(f"{r['id']} {q}: got {got.get(q)!r}, want {gold!r} | {r['request']}")
    n = len(requests)
    for q, h in hits.items(): print(f"{q}: {h}/{n} = {h / n:.0%}")
    print(f"time per request: median {statistics.median(times):.0f} ms, max {max(times):.0f} ms")
    print("\n".join(["misses:", *misses]) if misses else "no misses")
    return hits


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "laya"
    score({"laya": laya_evaluator, "gemma": gemma_evaluator}[which]())

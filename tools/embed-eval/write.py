"""Writes the fine-tuning corpus with the brain box (Gemma on SageMaker Malaysia, endpoint sona-brain): a patient
leaflet in English, Malay and Chinese for every condition the synthetic consultations cover (tools/asr-data/scripts,
455 conditions), and eight patient questions per leaflet, two each in English, Malay, Chinese and Manglish, the way
patients type into the library's search. A fifth of the conditions is held out for judging. The consultations'
doctor turns ride along as "spoken" lines, the hard negatives train.py mines (the 1,800 nurse lines stay the judge's).

  AWS_PROFILE=sona ~/zyt/venvs/embed/bin/python tools/embed-eval/write.py [out.json]   # default ~/zyt/data/sona-embed/corpus.json
"""
import asyncio, glob, json, random, re, sys
from pathlib import Path

import boto3

HERE = Path(__file__).parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "zyt/data/sona-embed/corpus.json"
LANGS = {"en": "English", "ms": "Malay (Bahasa Malaysia)", "zh": "Simplified Chinese"}
rt = boto3.session.Session(profile_name="sona", region_name="ap-southeast-5").client("sagemaker-runtime")
lock = asyncio.Semaphore(24)


async def ask(system: str, user: str, max_tokens: int) -> str:
    body = {"model": "gemma-4-26b-a4b", "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0.7, "max_tokens": max_tokens}
    async with lock:
        for attempt in range(3):
            try:
                res = await asyncio.to_thread(rt.invoke_endpoint, EndpointName="sona-brain", ContentType="application/json", Body=json.dumps(body))
                return json.loads(res["Body"].read())["choices"][0]["message"]["content"]
            except Exception as e:
                if attempt == 2: raise
                await asyncio.sleep(2)


def block(s: str) -> str:
    m = re.search(r"```(?:json)?\s*(.*?)```", s, re.S)
    return (m.group(1) if m else s).strip()


async def leaflet(cond: str, lang: str) -> dict | None:
    text = await ask(f"You write patient discharge leaflets for a Malaysian hospital, in {LANGS[lang]}. Plain words a patient understands. "
                     "Reply as JSON: {\"title\": ..., \"text\": ...}. The text is 120 to 200 words: what the condition is, the medicines "
                     "and how to take them, what to do at home, and the warning signs that mean come back or call 999.",
                     f"Condition: {cond}", 700)
    try:
        d = json.loads(block(text)); return {"condition": cond, "lang": lang, "title": d["title"], "text": d["text"]}
    except Exception: return None


async def questions(doc: dict) -> list[dict]:
    text = await ask("You write what a Malaysian patient or family member would type into a hospital app's search when they have this leaflet's "
                     "problem. Short, natural, sometimes with symptoms or a worry, never copying the leaflet's wording. Reply as a JSON object "
                     "with keys en, ms, zh, mix, each a list of 2 questions: en in English, ms in Malay, zh in Chinese, mix in Manglish "
                     "(Malay, English and Chinese mixed in one sentence, as spoken in KL).",
                     f"Leaflet title: {doc['title']}\n\n{doc['text']}", 500)
    try:
        d = json.loads(block(text))
        return [{"doc": doc["id"], "lang": lang, "q": q} for lang in ("en", "ms", "zh", "mix") for q in d[lang][:2] if isinstance(q, str)]
    except Exception: return []


async def main():
    convs = [c for f in sorted(glob.glob(str(HERE.parent / "asr-data/scripts/*/*.json"))) for c in json.load(open(f))]
    conds = sorted({c["condition"] for c in convs})
    rng = random.Random(11); rng.shuffle(conds)
    held = set(conds[: len(conds) // 5])
    docs = [d for d in await asyncio.gather(*[leaflet(c, l) for c in conds for l in LANGS]) if d]
    for i, d in enumerate(docs): d["id"] = f"gen:{i}"; d["split"] = "held" if d["condition"] in held else "train"
    qs = [q for qs in await asyncio.gather(*[questions(d) for d in docs]) for q in qs]
    spoken = [{"condition": c["condition"], "text": t["text"]} for c in convs for t in c["turns"] if t["speaker"] == "Doctor" and len(t["text"]) > 30]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    json.dump({"docs": docs, "questions": qs, "spoken": spoken}, open(OUT, "w"), ensure_ascii=False)
    print(len(docs), "leaflets,", len(qs), "questions,", len(spoken), "spoken lines;", sum(d["split"] == "held" for d in docs), "leaflets held out ->", OUT)


asyncio.run(main())

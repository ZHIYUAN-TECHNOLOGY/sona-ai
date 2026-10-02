"""Gemma on box ① (Baseten, OpenAI-style), for writing training data. Calls are cached by key so a rerun resumes.

The key is BASETEN_API_KEY from the main checkout's apps/server/.env (never printed).
"""
import hashlib, json, os, re, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

URL = "https://model-q9p7zn63.api.baseten.co/environments/production/sync/v1/chat/completions"
MODEL = "gemma-4-26b-a4b"  # BRAIN_MODEL in packages/api/src/baseten-models.ts
ENV = Path("/Users/ngchwanlii/zyt/projects/sona-ai/apps/server/.env")
KEY = re.search(r"^BASETEN_API_KEY=(.*)$", ENV.read_text(), re.M).group(1).strip().strip('"')
CACHE = Path.home() / "zyt/data/sona-omni/sft/raw"


def ask(system, user, max_tokens=1500, temperature=0.7, tries=6):
    """Gemma's reply text; waits out a sleeping box (it starts on any request) and retries."""
    body = json.dumps({"model": MODEL, "temperature": temperature, "max_tokens": max_tokens,
                       "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}).encode()
    for i in range(tries):
        try:
            req = urllib.request.Request(URL, body, {"Authorization": f"Api-Key {KEY}", "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)["choices"][0]["message"]["content"]
        except Exception as e:  # ponytail: one retry policy for cold starts, 5xx and timeouts alike
            if i == tries - 1: raise
            time.sleep(min(60, 5 * 2 ** i))


def json_in(text):
    """The JSON object or array in a reply that may wrap it in prose or a code fence."""
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    for open_, close in (("{", "}"), ("[", "]")):
        i, j = t.find(open_), t.rfind(close)
        if i != -1 and j > i:
            try: return json.loads(t[i:j + 1])
            except json.JSONDecodeError: pass
    return None


def cached(name, system, user, **kw):
    """ask() once per (name, prompt): the parsed JSON, kept in raw/<name>/<hash>.json; None if Gemma's JSON never parses."""
    d = CACHE / name; d.mkdir(parents=True, exist_ok=True)
    f = d / (hashlib.sha1((system + "\x00" + user).encode()).hexdigest()[:16] + ".json")
    if f.exists(): return json.loads(f.read_text())
    for _ in range(3):
        out = json_in(ask(system, user, **kw))
        if out is not None:
            f.write_text(json.dumps(out, ensure_ascii=False))
            return out
    return None


def pmap(fn, items, workers=None):
    """fn over items in parallel threads (WORKERS, default 8), results in order (the box batches them)."""
    with ThreadPoolExecutor(workers or int(os.environ.get("WORKERS", 8))) as ex: return list(ex.map(fn, items))

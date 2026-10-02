"""Lines for Sona-voice training audio: Gemma (box ①) writes short replies Sona would say, in Malay, English, Mandarin
and Manglish, plus the 1,800 nurse lines in tools/tts-eval/scripts. Every glossary term (tools/tts-eval/terms.json)
appears; no line repeats a sentence of the Sona eval set (~/zyt/data/sona-tts/eval-full1000/manifest.jsonl).

Writes ~/zyt/data/sona-omni/voice/lines.jsonl ({id, lang, text, source}). Resumable: requests already answered are kept.
Usage: python3 lines.py
"""
import json, re, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path.home() / "zyt/data/sona-omni/voice"
KEY = next(l.split("=", 1)[1].strip().strip('"') for l in (Path.home() / "zyt/projects/sona-ai/apps/server/.env").read_text().splitlines()
           if l.startswith("BASETEN_API_KEY="))
BASE = "https://model-q9p7zn63.api.baseten.co/environments/production"  # box ①, BOXES.brain in packages/api/src/baseten-models.ts
MODEL = "gemma-4-26b-a4b"
# Lines to request per language (25 a request): what is kept after the ASR filter is ~8 h ms, 2 h en, 2 h zh, 2 h Manglish.
WANT = {"manglish": 2500, "ms": 6500, "en": 1600, "zh": 1800}  # Manglish first: Gemini voices it
TOPICS = [
    "when and how to take a medicine, with the dose", "side effects to expect and what to do", "a missed dose",
    "finishing a course of antibiotics", "using an inhaler or nebuliser", "caring for a wound or stitches at home",
    "fever and how to bring it down", "drinking enough water and what to eat", "rest, walking and getting back to work",
    "warning signs that mean come back or call 999", "the next clinic appointment and what to bring",
    "what a blood test or X-ray result means, in general", "living with diabetes", "high blood pressure",
    "asthma and breathing", "feeling worried or low, and reassurance", "instructions for a family member caring for them",
    "how to use the Sona Care app", "greetings and small talk (weather, festivals like Hari Raya, Chinese New Year, Deepavali)",
    "hospital logistics (pharmacy queue, parking, visiting hours, insurance forms)", "vaccines", "caring for a child with a cold",
    "caring for an elderly parent", "sleep", "quitting smoking", "times, dates and numbers (doses, days, appointment times)",
]
STYLE = {
    "ms": "Bahasa Melayu as Malaysians speak it (not Indonesian), warm and conversational, the way a Malaysian nurse talks "
          "to a patient. Drug names in English as Malaysian clinicians say them (paracetamol, amoxicillin). Malay only otherwise.",
    "en": "Malaysian English, plain, warm and conversational, the way a Malaysian nurse talks to a patient. English only.",
    "zh": "Malaysian Mandarin in Simplified Chinese characters, warm and conversational, the way a Malaysian Chinese nurse "
          "talks to a patient. Chinese only (numbers may be digits).",
    "manglish": "Manglish: every line mixes English with Malay (sometimes Mandarin) inside the sentence, the way Malaysian "
                "nurses really talk to patients (e.g. 'Auntie, ubat ni kena makan after food, okay?').",
}
TERMS = json.loads((ROOT / "tools/tts-eval/terms.json").read_text())["terms"]
norm = lambda s: re.sub(r"[\W_]+", " ", s.lower()).strip()
EVAL = {norm(json.loads(l)["text"]) for l in (Path.home() / "zyt/data/sona-tts/eval-full1000/manifest.jsonl").read_text().splitlines()}
CJK = re.compile(r"[一-鿿]")


def ask(lang, topic, terms):
    must = f" Use each of these words at least once, as written: {', '.join(terms)}." if terms else ""
    prompt = (f"Write 25 different things Sona Care, a hospital's voice assistant, might say aloud to a patient about: {topic}. "
              f"Language: {STYLE[lang]}{must} Each item is one or two short sentences, at most 25 words, plain enough to read "
              "aloud: no lists, symbols, brackets, emojis or markdown. Vary them: questions, instructions, reassurance. "
              'Answer with a JSON array of 25 strings only.')
    body = json.dumps({"model": MODEL, "messages": [{"role": "user", "content": prompt}], "temperature": 0.9, "max_tokens": 2400}).encode()
    for attempt in range(4):
        try:
            req = urllib.request.Request(f"{BASE}/sync/v1/chat/completions", data=body, method="POST",
                                         headers={"Authorization": f"Api-Key {KEY}", "Content-Type": "application/json"})
            text = json.load(urllib.request.urlopen(req, timeout=300))["choices"][0]["message"]["content"]
            arr = json.loads(text[text.index("["): text.rindex("]") + 1])
            return [s.strip() for s in arr if isinstance(s, str)]
        except Exception:
            time.sleep(10 * (attempt + 1))
    return []


def keep(lang, s):
    if not s or norm(s) in EVAL: return False
    if lang == "zh": return bool(CJK.search(s)) and 6 <= len(s) <= 60
    if lang in ("ms", "en") and CJK.search(s): return False
    return 3 <= len(s.split()) <= 28


def wait_for_box():
    urllib.request.urlopen(urllib.request.Request(f"{BASE}/wake", method="POST", headers={"Authorization": f"Api-Key {KEY}"}), timeout=10)
    for _ in range(90):  # a sleeping box takes minutes
        try:
            if urllib.request.urlopen(urllib.request.Request(f"{BASE}/sync/health", headers={"Authorization": f"Api-Key {KEY}"}), timeout=10).status == 200: return
        except Exception: pass
        time.sleep(20)
    raise SystemExit("box ① did not wake")



def assemble(raw=OUT / "gemma_raw.jsonl"):
    """Every answered request's lines that pass keep(), once each, then the nurse lines not already there."""
    seen, rows = set(), []
    for l in raw.read_text().splitlines():
        r = json.loads(l)
        for s in r["lines"]:
            if keep(r["lang"], s) and norm(s) not in seen:
                seen.add(norm(s)); rows.append({"id": f"g-{r['lang']}-{len(rows):05d}", "lang": r["lang"], "text": s, "source": "gemma"})
    for lang in ("ms", "en", "zh"):
        for n in json.loads((ROOT / f"tools/tts-eval/scripts/{lang}.json").read_text()):
            if norm(n["text"]) not in seen and norm(n["text"]) not in EVAL:
                seen.add(norm(n["text"])); rows.append({"id": f"nurse-{n['id']}", "lang": lang, "text": n["text"], "source": "nurse"})
    return rows


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    raw = OUT / "gemma_raw.jsonl"  # one row per answered request, so a rerun only asks what is missing
    done = {json.loads(l)["job"] for l in raw.read_text().splitlines()} if raw.exists() else set()
    jobs = []
    for lang, n in WANT.items():
        terms = [t[lang] for t in TERMS] if lang in ("ms", "en", "zh") else []
        for i in range(n // 25):
            # The first 51 requests carry 3 glossary terms each, so each of the 50 terms is asked for about 3 times.
            group = [terms[(i * 3 + k) % len(terms)] for k in range(3)] if terms and i < 51 else []
            jobs.append((f"{lang}-{i:04d}", lang, TOPICS[i % len(TOPICS)], group))
    todo = [j for j in jobs if j[0] not in done]
    print(len(jobs), "requests,", len(todo), "to do", flush=True)
    if todo:
        wait_for_box()
        with ThreadPoolExecutor(20) as pool, open(raw, "a") as log:
            for job, lines in zip(todo, pool.map(lambda j: ask(j[1], j[2], j[3]), todo)):
                log.write(json.dumps({"job": job[0], "lang": job[1], "lines": lines}, ensure_ascii=False) + "\n"); log.flush()
    rows = assemble(raw)
    (OUT / "lines.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")
    missing = [t[l] for t in TERMS for l in ("ms", "en", "zh") if not any(t[l].lower() in r["text"].lower() for r in rows if r["lang"] == l)]
    print({l: sum(r["lang"] == l for r in rows) for l in WANT}, "| glossary terms missing:", missing, flush=True)

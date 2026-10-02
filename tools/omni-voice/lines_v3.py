"""Lines for talker v3 (docs/minicpm-o-finetune.md, voice v3 plan): what voice v1's 17.9 h almost never had.
- num_*: numbers Sona says (doses, °C, dates, times, readings, 999), written as words, the way live3's brain writes them;
- zh_in_latin: Malay or English with Chinese words in characters inside the sentence, as Malaysian Chinese speak;
- latin_in_zh: Malaysian Mandarin with Malay or English words inside;
- manglish: Malay and English mixed, with particles.
Gemma (box ①) writes them through lines.ask; spoken.py turns any digit left into words. 25 lines of each category are
held out (split "test") as the hard speaking test; voice3.py then voices them all with Gemini TTS.

Writes ~/zyt/data/sona-omni/voice3/lines.jsonl ({id, cat, lang, text, split}). Resumable. Usage: python3 lines_v3.py
"""
import json, random, re
from concurrent.futures import ThreadPoolExecutor

from lines import EVAL, OUT, STYLE, TOPICS, ask, norm, wait_for_box
from spoken import spoken

OUT3 = OUT.parent / "voice3"
WORDS = {"ms": "'tiga puluh lapan darjah Celsius', 'lima ratus miligram', 'pukul lapan pagi', 'lapan Oktober', 'sembilan sembilan sembilan'",
         "en": "'thirty-eight degrees Celsius', 'five hundred milligrams', 'eight a m', 'October eighth', 'nine nine nine'",
         "zh": "'三十八度', '五百毫克', '早上八点', '十月八日', '九九九'"}
NUMBERS = (" Every line states numbers Sona tells patients: doses with strengths, tablets, millilitres, times, dates, how many days, "
           "temperatures, blood pressure or sugar readings, or the emergency number 999. Write every number in words, never digits, "
           "for example {}.")
CATS = {  # category: (lang tag for training, style, lines wanted)
    "num_ms": ("ms", STYLE["ms"] + NUMBERS.format(WORDS["ms"]), 600),
    "num_en": ("en", STYLE["en"] + NUMBERS.format(WORDS["en"]), 400),
    "num_zh": ("zh", STYLE["zh"].replace(" (numbers may be digits)", "") + NUMBERS.format(WORDS["zh"]), 400),
    "num_manglish": ("manglish", STYLE["manglish"] + NUMBERS.format(WORDS["en"] + " or " + WORDS["ms"]), 400),
    "zh_in_latin": ("manglish", "Manglish as Malaysian Chinese nurses speak: Malay or English sentences with Chinese words or short "
                    "phrases in Simplified Chinese characters inside the sentence (e.g. 'Auntie, ubat ni kena makan 饭后 okay?', "
                    "'Don't worry, 慢慢来, rest dulu ya.'). Every line has a Chinese word in characters and at least three Malay or "
                    "English words.", 1200),
    "latin_in_zh": ("zh", "Malaysian Mandarin in Simplified Chinese characters with Malay or English words inside the sentence, as "
                    "Malaysian Chinese speak (e.g. '你记得 follow up 那天带 IC 来', '这个 ubat 要饭后吃哦'). Every line has a Malay "
                    "or English word.", 600),
    "manglish": ("manglish", STYLE["manglish"], 400),
}
NUM_TOPICS = ["a medicine's dose and strength", "how often and for how many days to take a medicine", "a fever and its temperature",
              "the next appointment's date and time", "blood pressure readings", "blood sugar readings",
              "measuring a liquid medicine in millilitres", "fasting hours before a blood test", "when to call 999",
              "a child's dose by weight", "insulin units", "how many days the wound needs before the stitches come out"]
CJK, LATIN = re.compile(r"[一-鿿]"), re.compile(r"[A-Za-z]{2,}")


def keep(cat, s):
    if not s or norm(s) in EVAL or re.search(r"\d", s): return False
    words, han = len(LATIN.findall(s)), len(CJK.findall(s))
    if cat in ("num_zh",): return han >= 6 and len(s) <= 60
    if cat == "zh_in_latin": return han >= 1 and words >= 3 and len(s.split()) <= 28
    if cat == "latin_in_zh": return han >= 4 and words >= 1 and len(s) <= 70
    return han == 0 and 3 <= len(s.split()) <= 28


if __name__ == "__main__":
    OUT3.mkdir(parents=True, exist_ok=True)
    raw = OUT3 / "gemma_raw.jsonl"
    done = {json.loads(l)["job"] for l in raw.read_text().splitlines()} if raw.exists() else set()
    jobs = [(f"{cat}-{i:03d}", cat, (NUM_TOPICS if cat.startswith("num_") else TOPICS)[i % len(NUM_TOPICS if cat.startswith("num_") else TOPICS)])
            for cat, (_, _, n) in CATS.items() for i in range(n // 25)]
    todo = [j for j in jobs if j[0] not in done]
    print(len(jobs), "requests,", len(todo), "to do", flush=True)
    if todo:
        wait_for_box()
        with ThreadPoolExecutor(20) as pool, open(raw, "a") as log:
            for job, lines in zip(todo, pool.map(lambda j: ask(CATS[j[1]][0], j[2], [], CATS[j[1]][1]), todo)):
                log.write(json.dumps({"job": job[0], "cat": job[1], "lines": lines}, ensure_ascii=False) + "\n"); log.flush()
    seen, rows = set(), []
    for l in raw.read_text().splitlines():
        r = json.loads(l)
        lang = CATS[r["cat"]][0]
        for s in r["lines"]:
            s = spoken(s, "en" if lang == "manglish" else lang) if r["cat"].startswith("num_") else s
            if keep(r["cat"], s) and norm(s) not in seen:
                seen.add(norm(s)); rows.append({"id": f"v3-{r['cat']}-{len(rows):05d}", "cat": r["cat"], "lang": lang, "text": s})
    rng = random.Random(3)
    for cat in CATS:  # the hard speaking test: never trained on
        for r in rng.sample([r for r in rows if r["cat"] == cat], 25): r["split"] = "test"
    for r in rows: r.setdefault("split", "train")
    (OUT3 / "lines.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")
    print({c: sum(r["cat"] == c for r in rows) for c in CATS}, len(rows), "lines", flush=True)

"""Stage 2 medical answers for MiniCPM-o's brain (docs/minicpm-o-finetune.md, combined retrain): licence-clean consumer
health Q&A, each source answer rewritten by Gemma (box ①) into Sona's spoken style twice, in its own language and
translated, so English, Malay and Mandarin get about a third each (Malay trailed English by 11 points on Global-MMLU's
medical questions, 2 Oct). The facts come only from the source answer.

Sources (docs/research/omni-training-datasets.md): MedQuAD (CC BY 4.0, NIH pages; everyday conditions first, a few rare
ones) and medical-o1-reasoning-SFT (Apache-2.0, the final Response only, short patient-like questions), minus the rows
stage 1 used (build.py open_sets drew them with random.Random(1): drawn again here and left out).
Usage (venv with pyarrow + huggingface_hub): python medical.py build | upload
Output: ~/zyt/data/sona-omni/sft/answer_med.json (train) and med_eval.json (100 a language, held out by source).
"""
import json, os, random, re, sys
from collections import Counter
from pathlib import Path

from build import HF_REPO, LANG_NAME, NO_PLAN, SFT, SYSTEM, WRITER, items_of, reply_of, train_plans
from gemma import cached, pmap

PAIRS = {"en": [("en", "ms")] * 3 + [("en", "zh")] * 2, "zh": [("zh", "ms")] * 3 + [("zh", "en")]}  # ~3,000 a language
TOPUP = [("ms", "zh")] * 2 + [("en", "ms"), ("en", "zh")]  # the top-up's languages: English already led after the judge
RULES = """Each reply is spoken aloud by Sona: plain and kind, at a reading age of about 12, at most 3 short sentences, the first at most 10 words, no lists, symbols or markdown. It keeps the reference's facts that matter most to a patient and drops the rest. It adds nothing the reference does not say: no new medicines, doses, numbers or claims. It keeps the reference's cautions and conditions (use with caution, it depends on, ask your doctor or pharmacist first, interactions, when to seek care): never turn them into a flat "yes, it is safe" or a definite number the reference does not give. The question is one a patient or family member would ask, in that language, as a Malaysian would say it; it asks about a condition, test or medicine in general, never describes an emergency happening now. If a reference cannot become such a question (an exam puzzle, a lab study), skip it."""
# live1 contradicted physicians on K-QA 7/40 (base 4/40), mostly by being confidently permissive ("Yes, you can safely
# take Imodium" with fatty liver): a source that hedges must not become a reply that does not (2 Oct, blind check).
HEDGED = re.compile(r"caution|depend|consult|your (doctor|health care|healthcare)|pharmacist|\bmay\b|\bmight\b|interact|not recommended|should not|avoid|seek (medical|care|help)|risk|"
                    r"慎用|注意|取决|咨询|遵医嘱|医生|可能|相互作用|避免|禁忌|就医|风险", re.I)
FLAT = re.compile(r"^\s*(yes|no|ya|tidak|boleh)\b[,.!]?|\b(it'?s|it is|completely|perfectly) (safe|fine)\b|you can safely|no problem|selamat (diambil|dimakan|digunakan)|tiada masalah|"
                  r"^\s*(可以|是的|不可以|不能)[，。！]|完全安全|没问题|可以放心", re.I)
STILL_HEDGES = re.compile(r"doctor|pharmacist|caution|careful|depend|\bmay\b|\bmight\b|\bcheck\b|\bask\b|doktor|ahli farmasi|berhati-hati|bergantung|mungkin|tanya|rujuk|"
                          r"医生|药剂师|注意|取决|可能|咨询|遵医嘱|小心", re.I)


def sources(rng):
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download
    dl = lambda repo, f: hf_hub_download(repo, f, repo_type="dataset")
    clean = {"NIDDK", "NINDS", "NIHSeniorHealth", "CancerGov", "NHLBI", "CDC", "MPlusHealthTopics", "GARD", "GHR"}
    mq = [r for r in pq.read_table(dl("lavita/MedQuAD", "data/train-00000-of-00001-e36383d177026d53.parquet")).to_pylist()
          if (r["answer"] or "").strip() and r["document_source"] in clean]
    o1 = {lang: json.loads(Path(dl("FreedomIntelligence/medical-o1-reasoning-SFT", f)).read_text())
          for f, lang in (("medical_o1_sft.json", "en"), ("medical_o1_sft_Chinese.json", "zh"))}
    # Stage 1's draw, repeated call for call (build.py open_sets, a fresh Random(1)), so its rows stay out.
    s1 = random.Random(1)
    rare = [r for r in mq if r["document_source"] in ("GARD", "GHR")]
    used = {id(r) for r in s1.sample([r for r in mq if r["document_source"] not in ("GARD", "GHR")], 324) + s1.sample(rare, 36)}
    used |= {id(r) for lang in ("en", "zh") for r in s1.sample(o1[lang], 150)}

    keep = {"information", "symptoms", "treatment", "causes", "exams and tests", "outlook", "prevention", "susceptibility",
            "considerations", "frequency", "complications", "stages"}
    fresh = [r for r in mq if id(r) not in used and r["question_type"] in keep]
    every = [r for r in fresh if r["document_source"] not in ("GARD", "GHR")]
    drawn = rng.sample(every, 1800) + rng.sample([r for r in fresh if r not in every], 200)
    items = [("MedQuAD (CC BY 4.0)", r["question"], r["answer"], "en") for r in drawn]
    exam = re.compile(r"^(a|an)\s+\d+[- ]year[- ]old|which of the following|most likely|下列|最可能|患者|\d+岁", re.I)
    for lang, n, longest in (("en", 500, 400), ("zh", 2000, 150)):
        ok = [r for r in o1[lang] if id(r) not in used and len(r["Question"]) <= longest and not exam.search(r["Question"])]
        items += [("medical-o1-reasoning-SFT (Apache-2.0)", r["Question"], r["Response"], lang) for r in rng.sample(ok, n)]
    # Top-up (2 Oct): the judge dropped 2,178 medical-o1 rows (exam and clinician items), so 1,300 more everyday MedQuAD
    # sources, from their own Random so the first draw and its cached rewrites hold; they come with their languages.
    top, ids = random.Random(8), {id(r) for r in drawn}
    items += [("MedQuAD (CC BY 4.0)", r["question"], r["answer"], "en", top.choice(TOPUP))
              for r in top.sample([r for r in every if id(r) not in ids], 1300)]
    return items


CJK = re.compile(r"[一-鿿]")
MS = re.compile(r"\b(anda|saya|ini|itu|yang|dan|dengan|untuk|boleh|tidak|ialah|adalah|jika|atau|dalam|pada|kepada|sakit|ubat|apa|apakah|bagaimana|kenapa|mengapa|bila|perlu|kena|ada|akan|juga|sebab|kalau|macam|mana|dah|ke|ni)\b", re.I)
EN = re.compile(r"\b(the|is|are|was|you|your|i|my|me|and|with|for|can|not|if|or|in|this|that|it|of|to|what|how|why|when|should|do|does|will|be|have|has|a|an|any|about)\b", re.I)


def language(text):
    """zh, ms or en by script and common words; "?" for a short Latin phrase with no signal (accepted for ms or en)."""
    if len(CJK.findall(text)) > 0.3 * len(re.sub(r"\s", "", text)): return "zh"
    ms, en = len(MS.findall(text)), len(EN.findall(text))
    return "ms" if ms > en else "en" if en > ms else "?"


def gate(question, reply, lang, source):
    """The quality gate: why a row is dropped (None: kept). Spoken, short, right language, no refusal, no number the
    source lacks, and no flat yes or "safe" where the source hedges."""
    if not question.strip() or not reply.strip(): return "empty"
    if re.search(r"[*#`|]|^\s*([-•]|\d+[.)])\s", reply, re.M): return "markdown"
    if len([s for s in re.split(r"(?<=[.!?])\s+|(?<=[。！？])", reply.strip()) if s.strip()]) > 3: return "over 3 sentences"
    if any(language(t) not in (lang, "?" if lang != "zh" else lang) for t in (question, reply)): return "wrong language"
    if re.search(r"\b(I'm sorry|I cannot|I can't help|as an AI)\b|maaf, saya tidak (dapat|boleh)|抱歉|我无法", reply, re.I): return "refusal"
    if any(n not in source for n in re.findall(r"\d+(?:\.\d+)?", reply)): return "number not in source"
    if HEDGED.search(source) and FLAT.search(reply) and not STILL_HEDGES.search(reply): return "flat where source hedges"
    return None


# Characters only Traditional Chinese uses: Malaysian Chinese read Simplified (MedQuAD's zh rewrites slipped into it).
TRADITIONAL = re.compile(r"[會問題簡腎諮詢醫與這個們為來說對時後開關點體療藥師請該變處經嗎還從應]")
# The spot-read (2 Oct) found medical-o1 rows no patient would ask (PRC emergency law, classical grammar, a surfactant's
# HLB value), exam answers given as home advice (IV glucose for low blood sugar) and chest pain at rest answered with a
# diagnosis and no 999: Gemma judges every row, and a row that fails any test is dropped.
JUDGE = """You check training data for Sona Care, a Malaysian hospital's voice assistant for patients at home. For each numbered question and reply, keep it only if all three hold:
1. A patient or family member in Malaysia could plausibly ask it about health, a condition, a test or a medicine. Not an exam puzzle, a lab or pharmacy calculation, law, history, grammar, statistics or a detail only clinicians need (staging systems, staff drug doses, anaesthesia settings, properties of chemicals).
2. The reply answers that question directly and sensibly for a patient, without asking for details the patient never gave, and never offers a hospital-only treatment (such as an IV drip) as what to do.
3. If the question describes something that may be an emergency now (chest pain, trouble breathing, fainting, heavy bleeding, signs of a stroke, a seizure, thoughts of suicide), the reply tells them to call 999 or go to the emergency department.
Reply with JSON only: {"items": [{"n": 1, "keep": true}]}"""


def judged(rows):
    """Gemma's keep decision for each row, 25 a call (cached like the rewrites)."""
    def one(batch):
        listing = "\n\n".join(f"[{n}] Question: {r['messages'][1]['content']}\nReply: {r['messages'][2]['content']}" for n, r in enumerate(batch, 1))
        out = cached("medical_judge", JUDGE, listing, max_tokens=1500, temperature=0.0)
        keep = {it.get("n") for it in items_of(out, "items") if it.get("keep") in (True, "true")}
        return [n in keep for n in range(1, len(batch) + 1)]
    return [k for ks in pmap(one, [rows[i:i + 25] for i in range(0, len(rows), 25)]) for k in ks]


def _check():
    src = "Loperamide may be used with caution; ask your doctor if you have liver disease."
    assert gate("Can I take Imodium?", "Yes, you can safely take Imodium.", "en", src) == "flat where source hedges"
    assert gate("Can I take Imodium?", "Yes, but ask your doctor first if you have liver problems.", "en", src) is None
    assert gate("How much should I take?", "You should take 40 mg a day.", "en", src) == "number not in source"
    assert gate("Boleh saya ambil Imodium?", "Ya, anda boleh ambil dengan selamat, tiada masalah.", "ms", src) == "flat where source hedges"


_check()


def build():
    rng = random.Random(7)
    items = sources(rng)
    for i, it in enumerate(items):  # (source, question, answer, source language) -> + its two reply languages
        if len(it) == 4: items[i] = (*it, rng.choice(PAIRS[it[3]]))
    items = items[: int(os.environ.get("LIMIT", len(items)))]  # a trial on the first few; Gemma's replies are cached for the full run
    print("sources", Counter(s for s, *_ in items), Counter(it[3] for it in items), flush=True)

    def one(batch):
        listing = "\n\n".join(f"[{n}] Question ({LANG_NAME[q_lang]}): {q[:1200]}\nReference answer: {a[:2500]}\n"
                              f"Write it in: {LANG_NAME[to[0]]}, then {LANG_NAME[to[1]]}"
                              for n, (_, q, a, q_lang, to) in enumerate(batch, 1))
        out = cached("medical", WRITER, f"""For each numbered question and reference answer, write a patient's question and Sona Care's reply, once in each language given (translate naturally where needed).
{RULES}
{listing}
JSON: {{"items": [{{"n": 1, "lang": "en|ms|zh", "question": "...", "reply": "..."}}]}}""", max_tokens=4000, temperature=0.4)
        rows, dropped = [], Counter()
        for it in items_of(out, "items"):
            n, lang = it.get("n"), it.get("lang")
            if not isinstance(n, int) or not 1 <= n <= len(batch) or lang not in batch[n - 1][4]: continue
            q, r = str(it.get("question") or "").strip(), reply_of(str(it.get("reply") or ""), lang, False)
            why = gate(q, r, lang, batch[n - 1][1] + "\n" + batch[n - 1][2])
            if why:
                dropped[why] += 1
                continue
            fallback = rng.choice(list(LANG_NAME))  # any language: a single-language question decides the reply's (the live1 shortcut)
            plan = rng.choice(train_plans())["text"] if rng.random() < 0.2 else NO_PLAN
            rows.append({"messages": [{"role": "system", "content": SYSTEM.format(lang=LANG_NAME[fallback], plan=plan)},
                                      {"role": "user", "content": q}, {"role": "assistant", "content": r}],
                         "lang": lang, "kind": "medical_open", "source": f"{batch[n - 1][0]}, reply rewritten by Gemma",
                         "src": batch[n - 1][1][:200], "reference": batch[n - 1][2][:1500]})
        return rows, dropped

    done = pmap(one, [items[i:i + 5] for i in range(0, len(items), 5)])
    rows, dropped = [r for rs, _ in done for r in rs], sum((d for _, d in done), Counter())
    print("rewritten", len(rows), "of", 2 * len(items), Counter(r["lang"] for r in rows), "dropped", dict(dropped), flush=True)
    before = len(rows)
    rows = [r for r in rows if r["lang"] != "zh" or not TRADITIONAL.search(r["messages"][1]["content"] + r["messages"][2]["content"])]
    traditional, keep = before - len(rows), judged(rows)
    off = [r for r, k in zip(rows, keep) if not k]
    (SFT / "raw/medical_judge_dropped.json").write_text(json.dumps(off, ensure_ascii=False, indent=1))
    rows = [r for r, k in zip(rows, keep) if k]
    print(f"Traditional Chinese dropped {traditional}, judge dropped {len(off)}", dict(Counter(r["source"].split(" (")[0] for r in off)),
          dict(Counter(r["lang"] for r in off)), f"kept {len(rows)}", flush=True)
    # Held out by source, so a held-out answer's translation never trains: sources in a fixed order until 100 a language.
    by_src = {}
    for r in rows: by_src.setdefault(r["src"], []).append(r)
    order = sorted(by_src); rng.shuffle(order)
    held, train, count = [], [], Counter()
    for s in order:
        group = by_src[s]
        if any(count[r["lang"]] < 100 for r in group) and all(count[r["lang"]] < 110 for r in group):
            held += group; count.update(r["lang"] for r in group)
        else:
            train += group
    for r in train: r.pop("reference"); r.pop("src")
    rng.shuffle(train)
    (SFT / "answer_med.json").write_text(json.dumps(train, ensure_ascii=False, indent=0))
    (SFT / "med_eval.json").write_text(json.dumps(held, ensure_ascii=False, indent=1))
    print("answer_med", len(train), Counter(r["lang"] for r in train), Counter(r["source"].split(",")[0] for r in train))
    print("med_eval", len(held), Counter(r["lang"] for r in held))


def upload():
    from huggingface_hub import HfApi
    api = HfApi(token=(Path.home() / ".cache/huggingface/token_write").read_text().strip())
    c = api.upload_folder(repo_id=HF_REPO, repo_type="dataset", folder_path=SFT, path_in_repo="sft", allow_patterns=["answer_med.json", "med_eval.json"],
                          commit_message="sft: stage 2 medical answers (MedQuAD, medical-o1; en/ms/zh, rewritten by Gemma) and their held-out set")
    print("uploaded", c.oid if hasattr(c, "oid") else c)


if __name__ == "__main__":
    {"build": build, "upload": upload}[sys.argv[1]]()

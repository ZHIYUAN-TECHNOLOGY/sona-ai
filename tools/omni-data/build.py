"""Stage 1 training data for MiniCPM-o 4.5 (docs/minicpm-o-finetune.md), in LLaMA-Factory's sharegpt format.

Usage (venv with pyarrow + huggingface_hub): python build.py <step>, steps in order:
  hear          4,000 Manglish clips + FLEURS train -> exact words (the ear)
  plans         35 synthetic discharge plans (30 train, 5 held out), written by Gemma
  hear_answer   patient lines from the ASR consultations -> Sona Care's spoken reply (Gemma)
  answer        text questions: plan, open medical, everyday, red flags (Gemma, plus open datasets if picked)
  eval          held-out questions with the key facts an answer must carry (never trained on)
  upload        dataset_info.json, card, and everything to the private HF dataset, folder sft/
Output: ~/zyt/data/sona-omni/sft/ (audio hard-linked from ~/zyt/data/sona-asr, which stays as is).
"""
import json, os, random, re, sys
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

from gemma import cached, pmap

SFT = Path.home() / "zyt/data/sona-omni/sft"
ASR = Path.home() / "zyt/data/sona-asr"
SCRIPTS = Path(__file__).resolve().parents[1] / "asr-data/scripts"
HF_REPO = "zhiyuantechnology/sona-minicpmo-data"
LANG_NAME = {"en": "English", "ms": "Malay", "zh": "Chinese"}
PERSONA_LANG = {"Malay": "ms", "English (Malaysian)": "en", "Mandarin (Malaysian)": "zh"}
CALL999 = {  # LINES.*.call999 in packages/api/src/voice-agent/answer.ts: said first on an emergency sign
    "en": "If this is happening now, call 999 or go to the nearest emergency department.",
    "ms": "Jika ini sedang berlaku, hubungi 999 atau pergi ke jabatan kecemasan terdekat.",
    "zh": "如果正在发生，请立即拨打999或前往最近的急诊部。",
}
# The live VOICE prompt (answer.ts) without its JSON flags line: MiniCPM-o speaks every word it writes.
SYSTEM = """You are Sona Care, a hospital's assistant for its patients, talking with one patient by voice. Answer whatever they ask: their own care, any other health or medicine question, or anything else. For their own medicines, doses and appointments, use their discharge plan below: it is their record.
How to answer:
- Plain and kind, at a reading age of about 12, at most 3 short sentences. The first has at most 10 words: it is spoken while you write the rest. No lists, symbols or markdown: they are read aloud.
- In the language the patient spoke (Malay, English or Chinese).
- If urgent, tell them to call 999 now.
When they mix languages, or you cannot tell, answer in {lang}.

Discharge plan:
{plan}"""
NO_PLAN = "None yet: they are still in hospital."
WRITER = "You write realistic training data for Sona Care, a Malaysian hospital's voice assistant for patients after discharge. Reply with JSON only."
REPLY_RULES = """Sona's replies: spoken aloud, plain and kind, at most 3 short sentences, the first at most 10 words, no lists or symbols. In the language the patient used; if they mixed languages, in their main language. Their own medicines, doses, dates and warning signs come from the plan exactly; anything else from sound, current medical knowledge (Malaysian context: MOH, 999, klinik kesihatan). An emergency sign (chest pain, severe breathlessness, confusion, fainting, coughing blood, blue lips, stroke signs, suicidal thoughts) is triage "urgent": the reply tells them to call 999 now."""
rng = random.Random(1)


def system(plan_text, lang):
    return SYSTEM.format(lang=LANG_NAME[lang], plan=plan_text or NO_PLAN)


def plan_text(p):
    """A plan as Gemma reads it: the same layout as planText in packages/api/src/routers/care-plan.ts."""
    meds = [f"- {m['name']} ({m['group']}): {m['line']}{'; ' + m['take'] if m.get('take') else ''}" for m in p["medicines"]]
    day = lambda s: date.fromisoformat(re.search(r"\d{4}-\d{2}-\d{2}", str(s)).group())  # Gemma may write a range
    follow = day(p["followUpDate"])
    return "\n".join([f"Discharged: {day(p['dischargedAt'])}T02:05:00.000Z", "Medicines:", *meds, "Come back or call if:",
                      *[f"- {w}" for w in p["warningSigns"]], f"Follow-up: {p['followUpTitle']} on {follow.strftime('%a %b %d %Y')}",
                      "Check-ins: day 2 and 7 after discharge", f"Leaflet ({p['leafletLabel']}):", p["leafletText"]])


def reply_of(text, lang, urgent):
    """The spoken reply; an urgent one starts with Sona's own 999 line, and Gemma's own 999 sentence is not repeated."""
    text = re.sub(r"\s+", " ", text).strip()
    if not urgent: return text
    rest = [s for s in re.split(r"(?<=[.!?。！？])\s*", text) if s and "999" not in s]
    return " ".join([CALL999[lang], *rest]) if lang != "zh" else CALL999[lang] + "".join(rest)


def items_of(out, key):
    """Gemma's list under `key`, or the bare list it sometimes returns instead; only the dict entries."""
    got = out if isinstance(out, list) else (out or {}).get(key) or [] if isinstance(out, dict) else []
    return [x for x in got if isinstance(x, dict)]


def link(src, dst):
    dst = SFT / dst
    dst.parent.mkdir(parents=True, exist_ok=True)
    if not dst.exists(): os.link(src, dst)
    return str(dst.relative_to(SFT))


def save(name, rows):
    (SFT / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=0))
    print(name, len(rows), "rows")


def conversations():
    """Training consultations (split == train) with their area, condition, patient language and turns."""
    for f in sorted(SCRIPTS.glob("*/*.json")):
        for c in json.loads(f.read_text()):
            if c["split"] == "train":
                yield {**c, "area": f.parent.name, "lang": PERSONA_LANG[c["patient_persona"]["dominant_language"]]}


SCENES = ("waiting_room", "ac_room", "phone", "quiet")


def hear():
    convs = {c["id"]: c for c in conversations()}
    by_lang = defaultdict(list)
    for line in (ASR / "dataset/train.jsonl").read_text().splitlines():
        r = json.loads(line)
        stem = next((r["id"][: -len(s) - 1] for s in SCENES if r["id"].endswith("_" + s)), r["id"])
        conv = convs.get(stem.rsplit("_", 1)[0])
        if conv: by_lang[conv["lang"]].append(r)
    rows = []
    for lang, rs in sorted(by_lang.items()):
        clean = [r for r in rs if r["scene"] == "clean"]; noisy = [r for r in rs if r["scene"] != "clean"]
        for r in rng.sample(clean, 500) + rng.sample(noisy, 500):
            rows.append({"messages": [{"role": "user", "content": "<audio>Write down exactly what was said."}, {"role": "assistant", "content": r["text"]}],
                         "audios": [link(r["audio"], f"audio/hear/{Path(r['audio']).name}")], "lang": lang, "source": "sona-manglish-asr (Gemini TTS, competition-only)"})
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download
    for lang, code in (("ms", "ms_my"), ("zh", "cmn_hans_cn"), ("en", "en_us")):
        t = pq.read_table(hf_hub_download("google/fleurs", f"parquet-data/{code}/train-00000-of-00001.parquet", repo_type="dataset"), columns=["id", "raw_transcription"]).to_pylist()
        have = [r for r in t if (ASR / f"fleurs_train/{code}_{r['id']}.wav").exists()]
        for r in rng.sample(have, 334 if lang == "en" else 333):
            wav = ASR / f"fleurs_train/{code}_{r['id']}.wav"
            rows.append({"messages": [{"role": "user", "content": "<audio>Write down exactly what was said."}, {"role": "assistant", "content": r["raw_transcription"]}],
                         "audios": [link(wav, f"audio/hear/fleurs_{wav.name}")], "lang": lang, "source": "google/fleurs train (CC BY 4.0)"})
    rng.shuffle(rows)
    save("hear", rows)
    print(Counter(r["lang"] for r in rows))


CONDITIONS = {  # 30 to train on, 5 held out (the last of each area but family), common reasons for a Malaysian discharge
    "resp": ["Community-acquired pneumonia", "Asthma flare", "COPD flare", "Tuberculosis, starting treatment", "Acute bronchitis", "Pleural effusion after drainage"],
    "infect": ["Dengue fever", "Cellulitis of the leg", "Kidney infection (pyelonephritis)", "Acute gastroenteritis with dehydration", "Leptospirosis", "Hand, foot and mouth disease in a child"],
    "cardio": ["Heart attack (NSTEMI) after a stent", "Heart failure flare", "New atrial fibrillation", "Very high blood pressure", "Deep vein thrombosis", "Pulmonary embolism"],
    "gi": ["Laparoscopic appendicectomy", "Bleeding stomach ulcer", "Acute pancreatitis", "Laparoscopic gallbladder removal", "Diverticulitis", "Hepatitis A"],
    "msk": ["Hip fracture after surgery", "Wrist fracture in a cast", "Acute low back pain", "Gout flare", "Knee replacement", "Ankle fracture in a cast"],
    "family": ["Type 2 diabetes, newly started on insulin", "Mild stroke", "High blood pressure after childbirth", "Viral fever in a child", "Iron deficiency anaemia after a transfusion"],
}
HELD_OUT = {c[-1] for a, c in CONDITIONS.items() if a != "family"}


def plans():
    conds = [(a, c) for a, cs in CONDITIONS.items() for c in cs]
    def one(ac):
        area, cond = ac
        lang = rng.choice(["ms", "en", "zh"])
        p = cached("plans", WRITER, f"""Write a realistic discharge plan for a patient in Malaysia discharged after: {cond}.
JSON: {{"dischargedAt": "2026-09-2X" (a date 22-29 Sep 2026), "medicines": [{{"name", "group": "new|changed|stopped|continue", "line": "what it is for and how to take it, with the real dose and how long", "take": "short timing note or empty"}}] (3-5 medicines, realistic Malaysian generics and doses), "warningSigns": [4-6 short signs to come back or call for], "followUpTitle": "e.g. Clinic review", "followUpDate": "2026-10-0X to 2026-10-2X", "leafletLabel": "{dict(ms='BM', en='English', zh='中文')[lang]}", "leafletText": "3-4 plain sentences in {LANG_NAME[lang]} for the patient: what they had and how to recover"}}""", temperature=0.6)
        return {"area": area, "condition": cond, "held_out": cond in HELD_OUT, "lang": lang, "plan": p, "text": plan_text(p)}
    out = pmap(one, conds)
    (SFT / "plans.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(len(out), "plans,", sum(p["held_out"] for p in out), "held out")


def train_plans():
    return [p for p in json.loads((SFT / "plans.json").read_text()) if not p["held_out"]]


def hear_answer():
    by_area = defaultdict(list)
    for p in train_plans(): by_area[p["area"]].append(p)
    dataset = {json.loads(l)["id"]: json.loads(l) for l in (ASR / "dataset/train.jsonl").read_text().splitlines()}
    jobs = []
    for c in conversations():
        lines = [(i, t["text"]) for i, t in enumerate(c["turns"]) if t["speaker"] == "Patient" and f"{c['id']}_{i:02d}" in dataset]
        if lines: jobs.append((c, rng.choice(by_area[c["area"]]), lines))

    def one(job):
        c, plan, lines = job
        numbered = "\n".join(f"{n}. {t}" for n, (_, t) in enumerate(lines, 1))
        out = cached("hear_answer", WRITER, f"""A patient ({c['patient_persona']['description']}; main language: {LANG_NAME[c['lang']]}) is home after discharge and talks to Sona Care by voice. Their plan:
{plan['text']}

Below are things this patient said in a clinic consultation about "{c['condition']}". For each line, decide if the patient could plausibly say it to Sona Care on its own (a question, worry, symptom report or statement about their health, medicines or life; not a bare answer to a doctor's question like "Last week, doctor."). For kept lines write Sona Care's reply, answering what they said; use the plan above for their own medicines, doses and appointments.
{REPLY_RULES}
Lines:
{numbered}
JSON: {{"lines": [{{"n": 1, "keep": true|false, "triage": "fine|worse|urgent", "lang": "en|ms|zh (language of the reply)", "reply": "..."}}]}}""", max_tokens=3000, temperature=0.4)
        rows = []
        for item in items_of(out, "lines"):
            n = item.get("n")
            if not item.get("keep") or not isinstance(n, int) or not 1 <= n <= len(lines) or item.get("lang") not in CALL999 or not item.get("reply"): continue
            i, _ = lines[n - 1]
            stem = f"{c['id']}_{i:02d}"
            noisy = [k for k in (f"{stem}_{s}" for s in SCENES) if k in dataset]
            clip = dataset[noisy[0] if noisy and rng.random() < 0.5 else stem]
            rows.append({"messages": [{"role": "system", "content": system(plan["text"], c["lang"])}, {"role": "user", "content": "<audio>"},
                                      {"role": "assistant", "content": reply_of(item["reply"], item["lang"], item.get("triage") == "urgent")}],
                         "audios": [link(clip["audio"], f"audio/hear_answer/{Path(clip['audio']).name}")], "lang": c["lang"], "triage": item.get("triage"),
                         "source": "sona-manglish-asr patient turn (Gemini TTS, competition-only) + Gemma reply"})
        return rows

    per_lang = int(os.environ.get("PER_LANG", 0)) or len(jobs)  # ~5 kept lines a consultation: 110 a language give ~1,500
    by_lang_jobs = defaultdict(list)
    for j in jobs: by_lang_jobs[j[0]["lang"]].append(j)
    lists = [js[:per_lang] for js in by_lang_jobs.values()]
    jobs = [j for group in zip(*lists) for j in group] + [j for js in lists for j in js[min(map(len, lists)):]]  # languages interleaved
    rows = [r for rs in pmap(one, jobs) for r in rs]
    by_lang = defaultdict(list)
    for r in rows: by_lang[r["lang"]].append(r)
    keep = [r for rs in by_lang.values() for r in rng.sample(rs, min(len(rs), 500))]  # ~1,500, even across languages
    rng.shuffle(keep)
    save("hear_answer", keep)
    print(Counter(r["lang"] for r in keep), Counter(r["triage"] for r in keep))


LANG_MIX = "a mix of languages: about a third English, a third Malay, a sixth Chinese, and a sixth Manglish (English, Malay and Chinese mixed in one sentence, as Malaysians talk)"
ITEM = '{"question": "what the patient says, in their words", "lang": "en|ms|zh (the language Sona replies in: the patient\'s, or their main one if mixed)", "triage": "fine|worse|urgent", "reply": "..."}'
TOPICS = {  # what Gemma writes about, beyond the patient's own plan
    "open": ["fever and dengue", "diabetes and blood sugar", "high blood pressure", "cholesterol and heart health", "asthma and inhalers", "coughs, colds and flu",
             "antibiotics and when they help", "paracetamol, ibuprofen and pain relief", "stomach upset, diarrhoea and dehydration", "skin rashes and allergies",
             "children's fever and common illnesses", "pregnancy and after childbirth", "older people, falls and frailty", "sleep", "stress, anxiety and low mood",
             "diet, rice, kopi and teh tarik", "exercise and weight", "smoking and vaping", "vaccines", "kidney health", "liver health and alcohol",
             "eyes and ears", "teeth and gums", "wound care and stitches", "back and joint pain", "medicine side effects and interactions", "traditional and herbal remedies",
             "women's health", "men's health", "blood tests and what results mean", "how clinics, klinik kesihatan and hospitals work in Malaysia", "first aid at home"],
    "everyday": ["greetings and small talk", "Malaysian food and recipes", "weather and haze", "travel and getting around", "family and caregiving", "feeling lonely or bored",
                 "using the Sona Care app", "time, dates and festivals (Raya, CNY, Deepavali)", "general knowledge questions", "jokes and light chat"],
}


def text_rows(items, plan=None):
    """Text rows from Gemma's items; questions not about a plan get a random plan in the prompt (or none, 15%), as live."""
    rows = []
    for it in items or []:
        if not isinstance(it, dict) or it.get("lang") not in CALL999 or not it.get("question") or not it.get("reply"): continue
        p = plan if plan is not None else (None if rng.random() < 0.15 else rng.choice(train_plans())["text"])
        rows.append({"messages": [{"role": "system", "content": system(p, it["lang"])}, {"role": "user", "content": it["question"].strip()},
                                  {"role": "assistant", "content": reply_of(it["reply"], it["lang"], it.get("triage") == "urgent")}],
                     "lang": it["lang"], "triage": it.get("triage"), "source": "Gemma 4 (box 1), synthetic"})
    return rows


def answer():
    jobs = []
    for p in train_plans():
        for focus in ("their medicines: what each is for, doses, timing, food, missed doses, side effects, stopped or changed medicines",
                      "their follow-up date, check-ins, warning signs from the plan, daily life, food, work, exercise and recovery"):
            jobs.append(("plan", p, f"""A patient is home after discharge. Their plan:
{p['text']}

Write 17 different things this patient might say to Sona Care about {focus}, in {LANG_MIX}. Include 2 reports of a warning sign from the plan (one an emergency). Then Sona's reply to each.
{REPLY_RULES}
JSON: {{"items": [{ITEM}]}}"""))
    for kind, n_calls, extra in (("open", 2, "any health or medicine question a Malaysian patient or family member might ask"), ("everyday", 2, "everyday, non-medical things a patient might say or ask")):
        for topic in TOPICS[kind]:
            for k in range(n_calls):
                jobs.append((kind, None, f"""Write 15 different questions or messages about "{topic}" ({extra}), set {k + 1}, in {LANG_MIX}. Vary the wording, length and detail. Then Sona Care's reply to each: helpful, accurate and direct; it answers fully, including usual adult doses where asked.
{REPLY_RULES}
JSON: {{"items": [{ITEM}]}}"""))
    for k in range(10):
        jobs.append(("red_flag", None, f"""Write 15 different messages, set {k + 1}, in {LANG_MIX}, from a patient or family member describing an emergency happening now (chest pain, severe breathlessness, stroke signs, fainting, confusion, heavy bleeding, coughing or vomiting blood, a seizure, severe allergic reaction, a child who is floppy or not waking, suicidal thoughts). Vary how people actually say it. Then Sona's reply: triage "urgent", tell them to call 999 now, and one short practical step while help comes.
{REPLY_RULES}
JSON: {{"items": [{ITEM}]}}"""))

    def one(job):
        kind, plan, prompt = job
        out = cached("answer", WRITER, prompt, max_tokens=4000, temperature=0.9)
        rows = text_rows(items_of(out, "items"), plan["text"] if plan else None)
        for r in rows: r["kind"] = kind
        return rows

    rows = [r for rs in pmap(one, jobs) for r in rs]
    rng.shuffle(rows)
    save("answer", rows)
    print(Counter(r["kind"] for r in rows), Counter(r["lang"] for r in rows))


def open_sets():
    """Licence-clean picks from docs/research/omni-training-datasets.md, answers rewritten by Gemma into Sona's spoken style
    (same facts), merged into answer.json. Run after `answer`."""
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download
    dl = lambda repo, f: hf_hub_download(repo, f, repo_type="dataset")
    clean = {"NIDDK", "NINDS", "NIHSeniorHealth", "CancerGov", "NHLBI", "CDC", "MPlusHealthTopics", "GARD", "GHR"}  # not the MedlinePlus subsets MedQuAD withholds
    mq = [r for r in pq.read_table(dl("lavita/MedQuAD", "data/train-00000-of-00001-e36383d177026d53.parquet")).to_pylist() if (r["answer"] or "").strip() and r["document_source"] in clean]
    rare = [r for r in mq if r["document_source"] in ("GARD", "GHR")]
    mq = rng.sample([r for r in mq if r["document_source"] not in ("GARD", "GHR")], 324) + rng.sample(rare, 36)
    items = [("MedQuAD (CC BY 4.0)", r["question"], r["answer"], "en", ("en", "ms", "zh")[i % 3]) for i, r in enumerate(mq)]
    for f, lang in (("medical_o1_sft.json", "en"), ("medical_o1_sft_Chinese.json", "zh")):
        o = json.loads(Path(dl("FreedomIntelligence/medical-o1-reasoning-SFT", f)).read_text())
        items += [("medical-o1-reasoning-SFT (Apache-2.0)", r["Question"], r["Response"], lang, lang) for r in rng.sample(o, 150)]
    aya = [r for r in pq.read_table(dl("CohereLabs/aya_dataset", "data/train-00000-of-00001.parquet"), columns=["inputs", "targets", "language"]).to_pylist() if r["language"] == "Standard Malay"]
    items += [("Aya Dataset (Apache-2.0)", r["inputs"], r["targets"], "ms", "ms") for r in rng.sample(aya, 200)]

    def one(batch):
        listing = "\n\n".join(f"[{n}] Question ({LANG_NAME[q_lang]}): {q[:1200]}\nReference answer: {a[:2500]}\nReply in: {LANG_NAME[to]}"
                              for n, (_, q, a, q_lang, to) in enumerate(batch, 1))
        out = cached("open", WRITER, f"""Turn each question and reference answer into a patient's message and Sona Care's spoken reply, in the language given (translate the question naturally if needed, as a Malaysian would say it). The reply keeps the reference's facts that matter most and drops the rest.
{REPLY_RULES}
{listing}
JSON: {{"items": [{{"n": 1, {ITEM[1:]}]}}""", max_tokens=4000, temperature=0.4)
        rows = []
        for it in items_of(out, "items"):
            n = it.get("n") if isinstance(it, dict) else None
            if not isinstance(n, int) or not 1 <= n <= len(batch): continue
            for r in text_rows([it]): rows.append({**r, "kind": "open_dataset", "source": f"{batch[n - 1][0]}, reply rewritten by Gemma"})
        return rows

    rows = [r for rs in pmap(one, [items[i:i + 8] for i in range(0, len(items), 8)]) for r in rs]
    merged = [r for r in json.loads((SFT / "answer.json").read_text()) if r.get("kind") != "open_dataset"] + rows
    rng.shuffle(merged)
    save("answer", merged)
    print("open rows", len(rows), Counter(r["source"].split(",")[0] for r in rows), Counter(r["lang"] for r in rows))


def eval_set():
    held = [p for p in json.loads((SFT / "plans.json").read_text()) if p["held_out"]]
    expect = '"expected": ["2-3 key facts a correct reply must carry"]'
    jobs = [("red_flag", None, f"""Write 30 messages, all different, about an emergency happening now (10 English, 8 Malay, 6 Chinese, 6 Manglish), worded as real patients or family would; include indirect ones ("my father's face looks droopy"). JSON: {{"items": [{{"question": "...", "lang": "en|ms|zh", {expect}}}]}}""")]
    jobs += [("open", None, f"""Write 30 different health, medicine or everyday questions a Malaysian patient might ask, set {k + 1} (12 English, 8 Malay, 5 Chinese, 5 Manglish), each with the key facts a correct, current answer must carry. JSON: {{"items": [{{"question": "...", "lang": "en|ms|zh", {expect}}}]}}""") for k in range(2)]
    jobs += [("plan", p, f"""A patient's discharge plan:
{p['text']}
Write 8 different questions the patient might ask about their own medicines, doses, appointments or warning signs (3 English, 2 Malay, 2 Chinese, 1 Manglish), each with the facts from the plan a correct reply must carry. JSON: {{"items": [{{"question": "...", "lang": "en|ms|zh", {expect}}}]}}""") for p in held]
    rows = []
    for kind, plan, prompt in jobs:
        out = cached("eval", WRITER, prompt, max_tokens=5000, temperature=0.9)
        for it in items_of(out, "items"):
            if it.get("lang") not in CALL999 or not it.get("question"): continue
            rows.append({"id": f"{kind}_{len(rows):03d}", "kind": kind, "lang": it["lang"], "question": it["question"], "expected": it.get("expected", []),
                         "must_999": kind == "red_flag", "system": system(plan["text"] if plan else rng.choice(train_plans())["text"], it["lang"]),
                         "plan_condition": plan["condition"] if plan else None})
    (SFT / "eval.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    print("eval", len(rows), Counter(r["kind"] for r in rows))


TAGS = {"role_tag": "role", "content_tag": "content", "user_tag": "user", "assistant_tag": "assistant", "system_tag": "system"}


def upload():
    from huggingface_hub import HfApi
    info = {"sona_hear": {"file_name": "hear.json", "formatting": "sharegpt", "columns": {"messages": "messages", "audios": "audios"}, "tags": TAGS},
            "sona_hear_answer": {"file_name": "hear_answer.json", "formatting": "sharegpt", "columns": {"messages": "messages", "audios": "audios"}, "tags": TAGS},
            "sona_answer": {"file_name": "answer.json", "formatting": "sharegpt", "columns": {"messages": "messages"}, "tags": TAGS}}
    info = {k: v for k, v in info.items() if (SFT / v["file_name"]).exists()}  # an early upload carries only what is built
    (SFT / "dataset_info.json").write_text(json.dumps(info, indent=1))
    api = HfApi(token=(Path.home() / ".cache/huggingface/token_write").read_text().strip())
    api.create_repo(HF_REPO, repo_type="dataset", private=True, exist_ok=True)
    c = api.upload_folder(repo_id=HF_REPO, repo_type="dataset", folder_path=SFT, path_in_repo="sft",
                          allow_patterns=["*.json", "audio/**"], ignore_patterns=["raw/**"], commit_message="sft: stage 1 data (hear, hear_answer, answer, eval)")
    print("uploaded", c.oid if hasattr(c, "oid") else c)


if __name__ == "__main__":
    {"eval": eval_set, "open": open_sets}.get(sys.argv[1], globals().get(sys.argv[1]))()

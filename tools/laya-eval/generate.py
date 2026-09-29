"""Synthetic Laya training data: Gemini writes fictional clinician requests per capability, style and patient.

python generate.py      # fills requests.jsonl (cached; only missing combinations call the API), then writes train.jsonl

The label is the capability the request was written for, so no separate labelling pass. train.jsonl rows follow
LocalLLaMA/typed-decisions ({id, workflow, state, questions, gold} with JSON-string fields), which Laya's Kaggle
notebook reads. Key: ~/.config/gemini_key. Fictional patients only; nothing real goes to the API.
"""
import json, random, re, time, urllib.request
from pathlib import Path
from check import CAPABILITY_OPTIONS, MEDICINE_OPTIONS, PATIENTS, items as baseline

HERE = Path(__file__).parent
MODEL = "gemini-3.8-flash"
PER_CALL = 12
# Extra generation rounds for classes that came out thin (v1 fine-tune missed note, medication and briefing).
CAP = 250
ROUNDS = {"note": 3, "medication": 3, "briefing": 2}

# What each card is for, with the boundaries the baseline showed are easy to cross.
BRIEFS = {
    "briefing": "a summary of who the patient is: background, history, allergies, current medicines. Not a diagnosis, not a written note.",
    "reasoning": "the likely diagnosis or differential, what to rule out, why one cause over another. Not published studies or guidelines.",
    "xray": "reading or checking the patient's chest X-ray (CXR, filem dada).",
    "medication": "reviewing medicines the patient already takes: interactions, allergy clashes, whether current meds are safe. Not writing a new prescription.",
    "prescription": "writing, drafting or starting a prescription, refill or new medicine with a dose.",
    "followup": "when the patient should come back, safety-netting advice, or a task/reminder for this patient's care. Not a referral letter to another specialty.",
    "note": "writing or drafting the consultation note or documentation of this visit.",
    "evidence": "studies, guidelines, graded evidence or a severity score (e.g. CURB-65) behind a decision.",
    "not-covered": "work this app cannot do yet, such as: discharge or discharge blockers, guarantee letters or insurance, ICD-10 or casemix coding, referral letters to another specialty, shift handover, bed status across the ward, medical certificates (MC), billing, admission paperwork, or booking theatre. Mix these topics.",
}
STYLES = [
    "Manglish: Malay and English mixed within one sentence, casual, particles like lah, ah, tak, je",
    "Malay only, casual hospital speech",
    "English only, terse clinician shorthand",
    "Malay or English with a short Mandarin phrase in Chinese characters inside the sentence",
    "Mandarin-dominant (Chinese characters) with English medical terms",
    "a very short voice command of two to five words, any of Malay, English or Mandarin",
]
PATIENT_HINTS = {
    "SYN-1042": "Amelia Tan (Puan Tan, she/her), 42, asthma, cough five days with fever since yesterday, uses a salbutamol inhaler and cetirizine, penicillin allergy",
    "SYN-1086": "Daniel Rahman (Encik Rahman, pakcik, he/him), 57, breathless on exertion, history not yet taken, takes an unknown tablet",
}
MEDICINE_WORDS = {"salbutamol-inhaler": r"salbutamol|ventolin|albuterol", "cetirizine-tablet": r"cetirizine|zyrtec", "paracetamol-tablet": r"paracetamol|panadol|acetaminophen"}


def ask_gemini(prompt):
    key = (Path.home() / ".config/gemini_key").read_text().strip()
    body = {"model": MODEL, "temperature": 1.0, "response_format": {"type": "json_object"}, "messages": [{"role": "user", "content": prompt}]}
    req = urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", json.dumps(body).encode(),
                                 {"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                return json.loads(json.load(res)["choices"][0]["message"]["content"])["requests"]
        except Exception as error:  # rate limits and the odd malformed reply: back off and retry
            if attempt == 3: raise
            print(f"  retry after {error}")
            time.sleep(10 * (attempt + 1))


def prompt_for(capability, style, patient):
    return (f"Write {PER_CALL} different things a Malaysian hospital doctor might type or say to a clinical assistant app "
            f"while seeing this fictional patient: {PATIENT_HINTS[patient]}.\n"
            f"Every one must be asking for {BRIEFS[capability]}\n"
            f"Language style: {style}.\n"
            "Vary length, wording and politeness; some mention the patient, most don't. Name at most one medicine per request. No numbering. "
            'Reply with JSON only: {"requests": ["...", ...]}')


norm = lambda s: re.sub(r"\W+", " ", s.lower()).strip()
words = lambda s: set(norm(s).split())
BASELINE = [(norm(i["request"]), words(i["request"])) for i in baseline]


def near_baseline(text):
    n, w = norm(text), words(text)
    return any(n == bn or len(w & bw) / max(1, len(w | bw)) >= 0.6 for bn, bw in BASELINE)


def medicine_in(text):
    found = [m for m, pattern in MEDICINE_WORDS.items() if re.search(pattern, text, re.I)]
    return found[0] if len(found) == 1 else ("many" if found else None)


def fill_requests(path):
    have = [json.loads(l) for l in path.read_text().splitlines()] if path.exists() else []
    done = {(r["capability"], r["style"], r["patient"], r.get("round", 0)) for r in have}
    with path.open("a") as out:
        for capability in CAPABILITY_OPTIONS:
            for rnd in range(ROUNDS.get(capability, 1)):
                for style in range(len(STYLES)):
                    for patient in PATIENTS:
                        if (capability, style, patient, rnd) in done: continue
                        print(f"generating {capability} / round {rnd} / style {style} / {patient}")
                        for text in ask_gemini(prompt_for(capability, STYLES[style], patient)):
                            out.write(json.dumps({"capability": capability, "style": style, "patient": patient, "round": rnd, "request": text.strip()}, ensure_ascii=False) + "\n")
                    out.flush()
    return [json.loads(l) for l in path.read_text().splitlines()]


def keep(rows):
    """Drop duplicates, anything close to the held-out baseline, and requests whose medicine label would be ambiguous."""
    seen, kept, dropped = set(), [], {"duplicate": 0, "near baseline": 0, "medicine": 0}
    for r in rows:
        n, med = norm(r["request"]), medicine_in(r["request"])
        if not n or n in seen: dropped["duplicate"] += 1; continue
        if near_baseline(r["request"]): dropped["near baseline"] += 1; continue
        # The baseline only names a medicine for medication/prescription requests; keep training consistent with that.
        if med == "many" or (med and r["capability"] not in ("medication", "prescription")): dropped["medicine"] += 1; continue
        seen.add(n)
        kept.append({**r, "medicine": med or "none"})
    print(f"kept {len(kept)} of {len(rows)}; dropped {dropped}")
    return kept


def one_hot(label, options):
    return {"type": "choice", "label": label, "probabilities": {k: float(k == label) for k in options}}


def row(i, r, rng):
    capability = dict(CAPABILITY_OPTIONS)
    label = r["capability"]
    # The server offers only relevant cards, so vary the offer: sometimes drop the right card
    # (answer becomes "none of the above") and sometimes a couple of others. "not-covered" is always offered.
    droppable = [k for k in capability if k != "not-covered"]
    if label != "not-covered" and rng.random() < 0.15:
        del capability[label]; label = "not-covered"
    for k in rng.sample([k for k in droppable if k in capability and k != label], rng.randint(0, 2)):
        del capability[k]
    capability = dict(rng.sample(list(capability.items()), len(capability)))  # Laya has position bias; shuffle
    medicine = dict(rng.sample(list(MEDICINE_OPTIONS.items()), len(MEDICINE_OPTIONS)))
    questions = {
        "capability": {"type": "choice", "instructions": "Which clinical result answers this request?", "criteria": capability},
        "medicine": {"type": "choice", "instructions": "Which catalogue medicine does the request name?", "criteria": medicine},
    }
    gold = {"capability": one_hot(label, capability), "medicine": one_hot(r["medicine"], medicine)}
    state = {"request": r["request"], "patient": PATIENTS[r["patient"]]}
    return {"id": f"sona_{i:05d}", "workflow": "sona_composition", "split": "train",
            "state": json.dumps(state, ensure_ascii=False), "questions": json.dumps(questions, ensure_ascii=False), "gold": json.dumps(gold)}


if __name__ == "__main__":
    kept = keep(fill_requests(HERE / "requests.jsonl"))
    rng = random.Random(20260929)
    # Cap each class so the topped-up ones don't tilt the model towards picking them.
    rng.shuffle(kept)
    capped, taken = [], {}
    for r in kept:
        taken[r["capability"]] = taken.get(r["capability"], 0) + 1
        if taken[r["capability"]] <= CAP: capped.append(r)
    kept = capped
    with (HERE / "train.jsonl").open("w") as out:
        for i, r in enumerate(kept):
            out.write(json.dumps(row(i, r, rng), ensure_ascii=False) + "\n")
    counts = {}
    for r in kept: counts[r["capability"]] = counts.get(r["capability"], 0) + 1
    print(f"train.jsonl: {len(kept)} rows {counts}")

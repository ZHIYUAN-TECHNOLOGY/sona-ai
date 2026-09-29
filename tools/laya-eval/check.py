"""Validate baseline.jsonl against the app catalogue; `--requests` prints one evaluator request per line.

Request shape is json-render's evaluator input ({state, questions}), which Laya and a constrained Gemma both take.
"""
import json, re, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
read = lambda p: (ROOT / p).read_text()

# ponytail: regex over the TS sources so this runs without bun; breaks if those declarations change shape.
CAPABILITIES = re.findall(r"(\w+): \"Clinical\w+\"", re.search(r"clinicalComponentNames = \{(.*?)\}", read("apps/native/features/presentation/catalog.ts"), re.S)[1])
MEDICINES = dict(re.findall(r'id: "([\w-]+)".*?label: "([^"]+)"', read("apps/native/features/clinical/medicine-catalog.ts")))
PATIENTS = dict(re.findall(r'id: "(SYN-\d+)".*?subtitle: "([^"]+)"', read("packages/domain/src/demo-patients.ts")))

# Kept short: Laya shares one 256-token budget across a question's options.
CAPABILITY_OPTIONS = {
    "briefing": "Summary of the patient's background, history, allergies and medicines",
    "reasoning": "Differential diagnosis and clinical reasoning",
    "xray": "Chest X-ray reading",
    "medication": "Review current medicines for interactions or problems",
    "prescription": "Write or draft a prescription",
    "followup": "Follow-up visit, safety-netting or a task",
    "note": "Write the consultation note",
    "evidence": "Studies, guidelines or severity score behind a decision",
    "not-covered": "None of the above",
}
MEDICINE_OPTIONS = {**MEDICINES, "none": "No specific medicine named"}


def request(item):
    return {
        "state": {"request": item["request"], "patient": PATIENTS[item["patient"]]},
        "questions": {
            "capability": {"type": "choice", "instructions": "Which clinical result answers this request?", "criteria": CAPABILITY_OPTIONS},
            "medicine": {"type": "choice", "instructions": "Which catalogue medicine does the request name?", "criteria": MEDICINE_OPTIONS},
        },
        "gold": {"capability": item["capability"], "medicine": item["medicine"] or "none"},
    }


items = [json.loads(line) for line in (Path(__file__).parent / "baseline.jsonl").read_text().splitlines() if line.strip()]
assert set(CAPABILITY_OPTIONS) == {*CAPABILITIES, "not-covered"}, f"catalogue drifted: {CAPABILITIES}"
assert len(items) == 50, len(items)
assert len({i["id"] for i in items}) == len(items) == len({i["request"] for i in items}), "duplicate id or request"
for i in items:
    assert i["patient"] in PATIENTS, i
    assert i["capability"] in CAPABILITY_OPTIONS, i
    assert i["medicine"] is None or i["medicine"] in MEDICINES, i
    assert i["medicine"] is None or i["capability"] in ("medication", "prescription"), i
counts = Counter(i["capability"] for i in items)
assert min(counts.values()) >= 5, counts

if __name__ == "__main__" and "--requests" in sys.argv:
    for i in items:
        print(json.dumps({"id": i["id"], **request(i)}, ensure_ascii=False))
elif __name__ == "__main__":
    print(f"ok: {len(items)} items, {dict(counts)}")

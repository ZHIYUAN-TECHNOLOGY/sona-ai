"""Step 2 of scoring who-said-what: the words, by our fine-tuned Manglish ASR, three ways (segments.py is step 1).

  whole   each part of about 30 s transcribed in one go, as the scribe does today: the words, with nobody's name on them.
  truth   each true turn cut out and transcribed alone: the most that cutting by voice can give.
  voices  each turn the diarizer found (the box's own rule, voices.turns) cut out and transcribed alone, as the box will.

Word error rate against the script (a Chinese character is a word), and for `voices` the same per person: every word
counted against the person the diarizer gave it to (voices matched to people by time, as run.py does).

  ~/zyt/venvs/asr/bin/python tools/diar-eval/words.py <whole|truth|voices> [set dir] [name ...]
"""
import json, re, sys
from pathlib import Path

import numpy as np, soundfile as sf, torch
from qwen_asr import Qwen3ASRModel
from scipy.optimize import linear_sum_assignment

sys.path.insert(0, str(Path(__file__).parents[2] / "packages/infra/baseten/voice/data"))

SR = 16000
MODE = sys.argv[1]
SET = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.home() / "zyt/data/sona-diar/set1"
NAMES = sys.argv[3:] or ["p2_1", "p3_1", "p3_3", "p4_1", "p4_3", "p5_1", "p6_1", "p8_1"]
ASR = Path.home() / "zyt/data/sona-asr/ckpt/mixed-final"
asr = Qwen3ASRModel.from_pretrained(str(ASR), dtype=torch.float32, device_map="mps")


def hear(x):
    if len(x) < 0.2 * SR: return ""
    text = asr.transcribe((x, SR))[0].text
    torch.mps.empty_cache()
    return text


def words(s): return re.findall(r"[一-鿿]|[a-z0-9]+", s.lower())


def errors(ref, hyp):
    """Word edits from hyp to ref (Levenshtein)."""
    row = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, row[0] = row[0], i
        for j, h in enumerate(hyp, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (r != h))
    return row[-1]


def pieces(name, audio):
    """What is sent to the ASR in this mode: (start s, end s, voice or None)."""
    parts = json.loads((SET / f"{name}.parts.json").read_text())
    if MODE == "whole": return [(p["from"], p["to"], None) for p in parts]
    if MODE == "truth": return [(t["start"], t["end"], t["speaker"]) for t in json.loads((SET / f"{name}.json").read_text())]
    from voices import turns
    return [(p["from"] + t["from"], p["from"] + t["to"], t["voice"]) for p in parts for t in turns(p["segments"], p["to"] - p["from"])]


total = {"ref": 0, "err": 0, "who_err": 0, "pieces": 0, "empty": 0}
for name in NAMES:
    audio, _ = sf.read(SET / f"{name}.wav", dtype="float32")
    truth = json.loads((SET / f"{name}.json").read_text())
    heard = [(a, b, v, hear(audio[round(a * SR):round(b * SR)])) for a, b, v in sorted(pieces(name, audio))]
    ref = [w for t in truth for w in words(t["text"])]
    err = errors(ref, [w for *_, text in heard for w in words(text)])
    row = {"name": name, "pieces": len(heard), "empty": sum(not text.strip() for *_, text in heard), "wer": round(100 * err / len(ref), 1)}
    if MODE != "whole":
        # Voices matched to people by the time they share, then each person's words against what their voice was given.
        people, found = sorted({t["speaker"] for t in truth}), sorted({v for _, _, v, _ in heard})
        share = np.zeros((len(people), len(found)))
        for t in truth:
            for a, b, v, _ in heard: share[people.index(t["speaker"]), found.index(v)] += max(0, min(b, t["end"]) - max(a, t["start"]))
        r, h = linear_sum_assignment(-share)
        voice_of = {people[i]: found[j] for i, j in zip(r, h)}
        who = sum(errors([w for t in truth if t["speaker"] == p for w in words(t["text"])],
                         [w for _, _, v, text in heard if v == voice_of.get(p) for w in words(text)]) for p in people)
        who += sum(len(words(text)) for _, _, v, text in heard if v not in voice_of.values())  # a voice that is nobody's
        row["wer_by_person"] = round(100 * who / len(ref), 1)
        total["who_err"] += who
    total["ref"] += len(ref); total["err"] += err; total["pieces"] += row["pieces"]; total["empty"] += row["empty"]
    print(json.dumps(row), flush=True)
    (SET / f"{name}.{MODE}.heard.json").write_text(json.dumps([{"from": a, "to": b, "voice": v, "text": text} for a, b, v, text in heard], ensure_ascii=False, indent=1))
print(MODE, "WER %.1f%%" % (100 * total["err"] / total["ref"]), "" if MODE == "whole" else "by person %.1f%%" % (100 * total["who_err"] / total["ref"]),
      total["pieces"], "pieces,", total["empty"], "empty")

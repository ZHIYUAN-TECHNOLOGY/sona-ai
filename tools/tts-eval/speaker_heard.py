"""Did a reference clip cost any words? Every sentence speaker_gen.py made, heard back by our fine-tuned ASR and
compared with what it was asked to say (a Chinese character is a word). Per arm: word error rate, and the sentences
that lost a fifth of their words or more.

  ~/zyt/venvs/asr/bin/python tools/tts-eval/speaker_heard.py [arm ...]   # default: none ref
"""
import json, re, sys
from pathlib import Path

import librosa, torch
from qwen_asr import Qwen3ASRModel

OUT = Path.home() / "zyt/data/sona-tts/speaker"
ARMS = sys.argv[1:] or ["none", "ref"]
asr = Qwen3ASRModel.from_pretrained(str(Path.home() / "zyt/data/sona-asr/ckpt/mixed-final"), dtype=torch.float32, device_map="mps")
answers = json.load(open(Path(__file__).parent / "scripts/answers.json"))


def words(s):  # "5 milligrams", "5 miligram" and "5mg" are the same words
    return re.findall(r"[一-鿿]|[a-z]+|[0-9]+", re.sub(r"milligrams?|miligram|毫克", "mg", s.lower()))


def errors(ref, hyp):
    row = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, row[0] = row[0], i
        for j, h in enumerate(hyp, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (r != h))
    return row[-1]


for arm in ARMS:
    total, wrong, lost = 0, 0, []
    for a in answers:
        for n, said in enumerate(a["sentences"]):
            wav = OUT / arm / f"{a['id']}_{n}.wav"
            if not wav.exists(): continue
            heard = asr.transcribe((librosa.load(wav, sr=16000)[0], 16000))[0].text
            torch.mps.empty_cache()
            ref, e = words(said), 0
            e = errors(ref, words(heard)); total += len(ref); wrong += e
            if e / len(ref) >= 0.2: lost.append((wav.stem, round(e / len(ref), 2), said, heard))
    print(arm, "WER %.1f%%" % (100 * wrong / total), len(lost), "sentences with a fifth or more wrong", flush=True)
    for row in lost: print("  ", *row, sep=" | ")

"""Does Smart Turn (pipecat-ai/smart-turn-v3, an 8 MB audio model that says whether a speaker has finished) judge our
patients' languages? It lists Chinese, English and Indonesian, not Malay or Manglish. Each clip never trained on
(tools/omni-train/eval.py's sets: sona-manglish-asr test, FLEURS ms/en/zh) is played twice: whole ("finished") and cut
at the quietest point in its middle ("not finished"), each with 0.2 s of quiet after, as the live box would hand it
over at a pause. Prints, by set, how often it is right on each, and its time on this CPU. Synthetic or read speech only.

  HF_TOKEN=... uv run --with onnxruntime --with transformers --with librosa --with datasets --with pyarrow python tools/turn-eval/eval.py
Env: MODEL (default smart-turn-v3.2-cpu.onnx), N (clips a set, default 60), AT (probability that counts as finished, default 0.5).
"""
import io
import os
import random
import time

import librosa
import numpy as np
import onnxruntime as ort
import pyarrow.parquet as pq
from datasets import Audio, load_dataset
from huggingface_hub import hf_hub_download
from transformers import WhisperFeatureExtractor

N, AT, SR = int(os.environ.get("N", 60)), float(os.environ.get("AT", 0.5)), 16_000
options = ort.SessionOptions()
options.inter_op_num_threads = 1
session = ort.InferenceSession(hf_hub_download("pipecat-ai/smart-turn-v3", os.environ.get("MODEL", "smart-turn-v3.2-cpu.onnx")), sess_options=options)
features = WhisperFeatureExtractor(chunk_length=8)


def finished(audio: np.ndarray) -> float:
    """Smart Turn's probability that the speaker is done, on the last 8 s (its inference.py)."""
    audio = audio[-8 * SR:] if len(audio) > 8 * SR else np.pad(audio, (8 * SR - len(audio), 0))
    x = features(audio, sampling_rate=SR, return_tensors="np", padding="max_length", max_length=8 * SR, truncation=True, do_normalize=True)
    return float(session.run(None, {"input_features": x.input_features.astype(np.float32)})[0].item())


def clips():
    asr = load_dataset("zhiyuantechnology/sona-manglish-asr", split="test", token=os.environ.get("HF_TOKEN")).cast_column("audio", Audio(decode=False))
    for i in random.Random(1).sample(range(len(asr)), N):
        yield "manglish", librosa.load(io.BytesIO(asr[i]["audio"]["bytes"]), sr=SR)[0]
    for lang, tag in (("ms_my", "fleurs_ms"), ("en_us", "fleurs_en"), ("cmn_hans_cn", "fleurs_zh")):
        rows = pq.read_table(hf_hub_download("google/fleurs", f"parquet-data/{lang}/test-00000-of-00001.parquet", repo_type="dataset")).to_pylist()
        for r in random.Random(1).sample(rows, N):
            yield tag, librosa.load(io.BytesIO(r["audio"]["bytes"]), sr=SR)[0]


quiet, score, ms = np.zeros(SR // 5, np.float32), {}, []
MID = os.environ.get("MID") == "1"  # cut mid-word (the loudest point of the middle) instead of at a gap
for tag, audio in clips():
    audio = librosa.effects.trim(audio, top_db=35)[0]
    if len(audio) < 2 * SR:
        continue
    # Cut where the middle (40-70%) is quietest: a gap between words, mid-sentence.
    lo, hi, hop = int(len(audio) * 0.4), int(len(audio) * 0.7), SR // 20
    cut = (max if MID else min)(range(lo, hi, hop), key=lambda i: float(np.mean(audio[i:i + hop] ** 2)))
    t = time.time()
    whole, part = finished(np.concatenate([audio, quiet])), finished(np.concatenate([audio[:cut], quiet]))
    ms.append((time.time() - t) * 500)
    score.setdefault(tag, []).append((whole, part))
for tag, pairs in score.items():
    whole, part = np.array(pairs).T
    # The bar that splits the two best for this set: what tuning AT alone could reach.
    best = max(np.linspace(0.05, 0.95, 19), key=lambda a: (whole > a).mean() + (part <= a).mean())
    print(f"{tag:10s} {len(pairs):3d} clips | finished heard as finished {(whole > AT).mean():4.0%} | cut mid-sentence heard as not finished "
          f"{(part <= AT).mean():4.0%} | medians {np.median(whole):.2f} and {np.median(part):.2f} | best bar {best:.2f}: {(whole > best).mean():4.0%} and {(part <= best).mean():4.0%}")
print(f"{np.median(ms):.0f} ms a judgement (median, this CPU)")

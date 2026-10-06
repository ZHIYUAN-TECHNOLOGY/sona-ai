"""Who spoke when on the synthetic consultations (build.py), with Nemotron 3 Diarization, three ways:

  whole   the recording in one pass (the model's offline mode): the best it can do.
  parts   as the scribe sends it: parts of about 30 s cut at a pause, each a separate request. The model's speaker
          memory (its speaker cache, about 0.3 MB) goes out with each answer and comes back with the next part, through
          bytes, as a stateless box would hand it over. Voice 3 stays voice 3.
  naive   the same parts with no memory: every part numbers its voices from 1 again.

Per recording: people found against people there, the share of speech time given to the wrong person or missed (DER,
no collar), and the share of turns given to the right person.

  ~/zyt/venvs/diar/bin/python tools/diar-eval/run.py [set dir] [out json]
"""
import io, json, sys, time
from pathlib import Path

import numpy as np, soundfile as sf, torch
from scipy.optimize import linear_sum_assignment
from transformers import AutoModelForAudioFrameClassification, AutoProcessor
from transformers.models.nemotron3_diarization.modeling_nemotron3_diarization import Nemotron3DiarizationSpeakerCache

SR, HOP = 16000, 0.01
SET = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "zyt/data/sona-diar/set1"
MODEL = "nvidia/Nemotron-3-Diarization"
# The scribe's cut (apps/native/features/scribe/live.ts): the first pause after 25 s, and by 36 s whatever is said.
SOFT, HARD = 25.0, 36.0
STATE = ("embeds", "probs", "fifo")
COUNTS = ("num_cache_frames", "num_fifo_frames", "is_compressed", "is_initialized")

device = "mps" if torch.backends.mps.is_available() else "cpu"
processor = AutoProcessor.from_pretrained(MODEL)
model = AutoModelForAudioFrameClassification.from_pretrained(MODEL).to(device).eval()


def new_cache():
    # The offline sizes: a part is about one offline chunk (27 s), not a 1 s streaming step.
    return Nemotron3DiarizationSpeakerCache(model.config.streaming_config, fifo_length=model.config.fifo_length,
                                            speaker_cache_update_period=model.config.speaker_cache_update_period)


def packed(cache) -> bytes:
    """The speaker memory as bytes (half precision), as the box would answer with it."""
    buf = io.BytesIO()
    np.savez_compressed(buf, **{k: getattr(cache, k).cpu().numpy().astype(np.float16) for k in STATE}, counts=np.array([int(getattr(cache, k)) for k in COUNTS]))
    return buf.getvalue()


def unpacked(blob: bytes):
    z, cache = np.load(io.BytesIO(blob)), new_cache()
    for k in STATE: setattr(cache, k, torch.from_numpy(z[k].astype(np.float32)).to(device))
    for k, v in zip(COUNTS, z["counts"]): setattr(cache, k, type(getattr(cache, k))(v))
    return cache


def cuts(audio):
    """Where the scribe would cut: the quietest 0.3 s between 25 and 36 s into each part."""
    at, out, win = 0, [], int(0.3 * SR)
    while len(audio) - at > HARD * SR:
        lo, hi = at + int(SOFT * SR), at + int(HARD * SR)
        energy = np.convolve(audio[lo:hi] ** 2, np.ones(win) / win, mode="valid")
        at = lo + int(np.argmin(energy)) + win // 2
        out.append(at)
    return [0, *out, len(audio)]


@torch.inference_mode()
def whole(audio):
    inputs = processor(audio, sampling_rate=SR).to(device)
    return model(**inputs).logits[0].sigmoid().cpu().numpy()


@torch.inference_mode()
def parts(audio, remember):
    probs, blob, sizes, took = [], None, [], []
    edges = cuts(audio)
    for a, b in zip(edges, edges[1:]):
        t = time.time()
        inputs = processor(audio[a:b], sampling_rate=SR, is_streaming=True, is_first_audio_chunk=True, is_last_audio_chunk=True).to(device)
        out = model(**inputs, speaker_cache=unpacked(blob) if blob and remember else new_cache())
        p = out.logits[0].sigmoid().cpu().numpy()
        want = round((b - a) / SR / HOP)  # keep the parts on the recording's clock
        probs.append(np.pad(p, ((0, max(0, want - len(p))), (0, 0)))[:want])
        blob = packed(out.speaker_cache)
        sizes.append(len(blob)); took.append(time.time() - t)
    return probs, sizes, took


def truth(name, frames):
    turns = json.loads((SET / f"{name}.json").read_text())
    ref = np.zeros((frames, max(t["speaker"] for t in turns) + 1), dtype=bool)
    for t in turns:
        for a, b in t["speech"]: ref[round(a / HOP):round(b / HOP), t["speaker"]] = True
    return ref, turns


def score(ref, hyp, turns):
    """DER with the best one-to-one match of found voices to people, and the turns given to the right person."""
    n = min(len(ref), len(hyp)); ref, hyp = ref[:n], hyp[:n]
    hyp = hyp[:, hyp.sum(0) > 50]  # a voice heard for under half a second is not a person
    overlap = ref.T.astype(int) @ hyp.astype(int)
    r, h = linear_sum_assignment(-overlap)
    nr, nh = ref.sum(1), hyp.sum(1)
    right = sum((ref[:, i] & hyp[:, j]).sum() for i, j in zip(r, h))
    miss, fa = np.maximum(nr - nh, 0).sum(), np.maximum(nh - nr, 0).sum()
    confusion = np.minimum(nr, nh).sum() - right
    seat = dict(zip(h, r))
    ok = 0
    for t in turns:
        a, b = round(t["start"] / HOP), min(n, round(t["end"] / HOP))
        heard = hyp[a:b].sum(0)
        ok += len(heard) > 0 and heard.max() > 0 and seat.get(int(heard.argmax())) == t["speaker"]
    total = nr.sum()
    # A person heard as two voices (each with a tenth or more of their speech), and a voice that is two people.
    names = {t["speaker"]: t["voice"] for t in turns}
    split = {names[i]: [round(float(v), 2) for v in sorted(row / max(1, row.sum()), reverse=True) if v >= 0.1] for i, row in enumerate(overlap)}
    merged = [[names[i] for i in np.nonzero(col / max(1, col.sum()) >= 0.1)[0]] for col in overlap.T]
    return {"split": {k: v for k, v in split.items() if len(v) > 1}, "merged": [m for m in merged if len(m) > 1],
            "people": int(ref.shape[1]), "found": int(hyp.shape[1]), "der": round(100 * (miss + fa + confusion) / total, 1),
            "miss": round(100 * miss / total, 1), "false_alarm": round(100 * fa / total, 1), "wrong_person": round(100 * confusion / total, 1),
            "turns_right": round(100 * ok / len(turns), 1)}


if __name__ == "__main__":
    rows = []
    for wav in sorted(SET.glob("*.wav")):
        audio, _ = sf.read(wav, dtype="float32")
        t = time.time(); p_whole = whole(audio); t_whole = time.time() - t
        ref, turns = truth(wav.stem, len(p_whole))
        with_memory, sizes, took = parts(audio, remember=True)
        naive, _, _ = parts(audio, remember=False)
        # With no memory a part's voice 1 is nobody's voice 1 elsewhere: each part's voices are their own columns.
        blocks = np.zeros((sum(len(p) for p in naive), 8 * len(naive)), dtype=bool)
        at = 0
        for i, p in enumerate(naive): blocks[at:at + len(p), 8 * i:8 * i + 8] = p > 0.5; at += len(p)
        row = {"name": wav.stem, "seconds": round(len(audio) / SR), "parts": len(sizes),
               "whole": score(ref, p_whole > 0.5, turns), "parts_memory": score(ref, np.concatenate(with_memory) > 0.5, turns),
               "naive": score(ref, blocks, turns), "memory_kb": round(max(sizes) / 1024), "part_seconds": round(float(np.mean(took)), 2), "whole_seconds": round(t_whole, 2)}
        rows.append(row)
        print(json.dumps(row), flush=True)
    for mode in ("whole", "parts_memory", "naive"):
        print(mode, {k: round(float(np.mean([r[mode][k] for r in rows])), 1) for k in ("der", "wrong_person", "miss", "false_alarm", "turns_right")},
              "count right:", sum(r[mode]["found"] == r[mode]["people"] for r in rows), "of", len(rows))
    if len(sys.argv) > 2: Path(sys.argv[2]).write_text(json.dumps(rows, indent=1))

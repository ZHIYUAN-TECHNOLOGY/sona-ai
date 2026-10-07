"""Who said what in one part of a consultation: the diarizer's segments become turns, each turn is cut out of the
audio and written down by the ASR on its own, and the turns come back in the order they were spoken. No torch here, so
the gateway imports it; the two models are passed in. Run this file to check it."""
import asyncio
import io

import soundfile as sf


def turns(segments, length_s, gap_s=0.4, min_s=0.3, pad_s=0.15):
    """A voice's segments less than `gap_s` apart are one turn (a breath is not a new turn). `from`/`to` are when it
    was spoken; `cut` is the same widened by `pad_s`, so the ASR does not lose a word's first or last sound."""
    joined = []
    for s in sorted(segments, key=lambda s: (s["voice"], s["from"])):
        if joined and joined[-1]["voice"] == s["voice"] and s["from"] - joined[-1]["to"] < gap_s:
            joined[-1]["to"] = max(joined[-1]["to"], s["to"])
        else:
            joined.append({"voice": s["voice"], "from": s["from"], "to": s["to"]})
    # ponytail: turns under 0.3 s are dropped (too short for the ASR, which invents words on them), so a quick "ya" or
    # "mm" is lost; a forced aligner over the whole part's transcript is the upgrade if short turns matter.
    kept = [t for t in joined if t["to"] - t["from"] >= min_s]
    # ponytail: voices talking over each other stay separate turns, so the shared stretch is written down once per
    # voice with both voices in it; a speech separation model is the upgrade if overlaps read badly.
    return sorted(({**t, "cut": (max(0.0, t["from"] - pad_s), min(length_s, t["to"] + pad_s))} for t in kept),
                  key=lambda t: t["from"])


async def heard(wav_bytes, memory, diarize, transcribe):
    """`diarize(wav_bytes, memory) -> {"segments", "memory"}` and `transcribe(wav_bytes) -> str` are coroutines."""
    said = await diarize(wav_bytes, memory)
    audio, rate = sf.read(io.BytesIO(wav_bytes), dtype="float32", always_2d=True)

    def piece(a, b):
        buf = io.BytesIO()
        sf.write(buf, audio[int(a * rate):int(b * rate)], rate, format="WAV", subtype="PCM_16")
        return buf.getvalue()

    spoken = turns(said["segments"], len(audio) / rate)
    texts = await asyncio.gather(*(transcribe(piece(*t["cut"])) for t in spoken))
    segments = [{"voice": t["voice"], "from": round(t["from"], 2), "to": round(t["to"], 2), "text": text.strip()}
                for t, text in zip(spoken, texts) if text.strip()]
    return {"text": " ".join(s["text"] for s in segments), "segments": segments, "memory": said["memory"]}


if __name__ == "__main__":
    import numpy as np

    seg = lambda voice, a, b: {"voice": voice, "from": a, "to": b}
    got = turns([seg(2, 4.0, 6.0), seg(1, 0.0, 1.0), seg(1, 1.3, 2.0), seg(1, 3.0, 3.2), seg(1, 5.0, 9.95)], 10.0)
    assert [(t["voice"], t["from"], t["to"]) for t in got] == [(1, 0.0, 2.0), (2, 4.0, 6.0), (1, 5.0, 9.95)], got
    assert [t["cut"] for t in got] == [(0.0, 2.15), (3.85, 6.15), (4.85, 10.0)], got  # padded, inside the recording
    assert turns([], 10.0) == []

    buf = io.BytesIO()
    sf.write(buf, 0.3 * np.sin(2 * np.pi * 440 * np.arange(10 * 8000) / 8000), 8000, format="WAV", subtype="PCM_16")
    lengths = []

    async def diarize(wav, memory):
        assert memory == "before"
        return {"segments": [seg(2, 4.0, 6.0), seg(1, 0.0, 1.0), seg(1, 1.3, 2.0), seg(3, 7.0, 8.0)], "memory": "after"}

    async def transcribe(wav):
        lengths.append(round(sf.info(io.BytesIO(wav)).duration, 2))
        return {2.15: " selamat pagi ", 2.3: "sakit kepala", 1.3: "  "}[lengths[-1]]  # the third voice said nothing

    out = asyncio.run(heard(buf.getvalue(), "before", diarize, transcribe))
    assert sorted(lengths) == [1.3, 2.15, 2.3], lengths
    assert out == {"text": "selamat pagi sakit kepala", "memory": "after",
                   "segments": [{"voice": 1, "from": 0.0, "to": 2.0, "text": "selamat pagi"},
                                {"voice": 2, "from": 4.0, "to": 6.0, "text": "sakit kepala"}]}, out
    print("voices ok")

"""Who spoke when on box ②: NVIDIA's Nemotron-3-Diarization, one forward per part of a consultation (about 30 s). The
box keeps nothing between parts: each answer carries the speaker memory, and the caller sends it back with the next
part, which is what keeps a person's voice number the same through the consultation (tools/diar-eval/run.py: 99% of
turns right this way). Runs in its own venv (/opt/diar: the model is not in a released transformers yet), started by
gateway.py on :8004."""
import base64
import io
import os
import threading

import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from transformers import AutoModelForAudioFrameClassification, AutoProcessor
from transformers.models.nemotron3_diarization.modeling_nemotron3_diarization import Nemotron3DiarizationSpeakerCache

SR = 16000
STATE = ("embeds", "probs", "fifo")
COUNTS = ("num_cache_frames", "num_fifo_frames", "is_compressed", "is_initialized")

# The mounted weights on the box; the hub when run beside the code, where there is no such folder.
folder = os.environ.get("MODELS", "/app/models") + "/diar"
source = folder if os.path.isdir(folder) else "nvidia/Nemotron-3-Diarization"
device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
processor = AutoProcessor.from_pretrained(source)
model = AutoModelForAudioFrameClassification.from_pretrained(source).to(device).eval()
one_at_a_time = threading.Lock()  # ponytail: one forward at a time (a part takes well under a second); batch if parts queue
app = FastAPI()


def new_cache():
    # The offline sizes: a part is about one offline chunk (27 s), not a 1 s streaming step.
    return Nemotron3DiarizationSpeakerCache(model.config.streaming_config, fifo_length=model.config.fifo_length,
                                            speaker_cache_update_period=model.config.speaker_cache_update_period)


def packed(cache) -> bytes:
    """The speaker memory as bytes (half precision), small enough to travel with every part."""
    buf = io.BytesIO()
    np.savez_compressed(buf, **{k: getattr(cache, k).cpu().numpy().astype(np.float16) for k in STATE},
                        counts=np.array([int(getattr(cache, k)) for k in COUNTS]))
    return buf.getvalue()


def unpacked(blob: bytes):
    z, cache = np.load(io.BytesIO(blob)), new_cache()
    for k in STATE:
        setattr(cache, k, torch.from_numpy(z[k].astype(np.float32)).to(device))
    for k, v in zip(COUNTS, z["counts"]):
        setattr(cache, k, type(getattr(cache, k))(v))
    return cache


def mono_16k(blob: bytes):
    audio, rate = sf.read(io.BytesIO(blob), dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if rate == SR:
        return audio
    # ponytail: straight-line resampling with no low-pass first, fine for the scribe's 16 kHz and for speech recorded
    # higher; a polyphase resampler (scipy.signal.resample_poly) is the upgrade if other rates diarize worse.
    return np.interp(np.arange(0, len(audio), rate / SR), np.arange(len(audio)), audio).astype(np.float32)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/v1/diarize")
def diarize(file: UploadFile = File(...), memory: str = Form("")):
    # Each part is fed as a whole streaming session, first and last chunk at once, starting from the memory so far.
    with one_at_a_time, torch.inference_mode():
        inputs = processor(mono_16k(file.file.read()), sampling_rate=SR, is_streaming=True, is_first_audio_chunk=True,
                           is_last_audio_chunk=True).to(device)
        out = model(**inputs, speaker_cache=unpacked(base64.b64decode(memory)) if memory else new_cache())
        found = processor.extract_speaker_dict(out.logits)[0]
    return {"segments": [{"voice": s["Speaker"] + 1, "from": s["Start"], "to": s["End"]} for s in found],
            "memory": base64.b64encode(packed(out.speaker_cache)).decode()}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8004)

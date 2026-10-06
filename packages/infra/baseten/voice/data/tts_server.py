"""Sona's voice on box ②: the fine-tuned VoxCPM2 (docs/tts-training.md) on Nano-vLLM-VoxCPM, which runs the whole
decoding step as CUDA graphs (VoxCPM2 0.10x real time on a 4090 in its benchmark; plain VoxCPM was 1.3-1.7x on this
L4, 1 Oct). Runs in its own venv (/opt/tts: torch 2.8 with prebuilt flash-attn), started by gateway.py on :8002.
Every line is spoken from the same reference clip of her voice, the one in the line's language (data/anchors), and from
the same seed: an answer is made a sentence at a time, and with neither the model drew a slightly different speaker for
each sentence (tools/tts-eval/speaker_gen.py: the lowest likeness between two sentences of an answer rose from 0.15-0.28
to 0.57, with no words lost; one clip for all three languages turned a Malay line into garbled English)."""
import contextlib
import io
import os

import numpy as np
import soundfile as sf
import uvicorn
from fastapi import FastAPI, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from spoken import lang_of

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = 7  # any fixed number: the same starting noise for every line
voice = None
rate = 48_000
anchors: dict[str, bytes] = {}  # her voice by language, as the model's own latents


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    global voice, rate, anchors
    from nanovllm_voxcpm import VoxCPM

    # The rated settings (10 steps here, cfg 2.0 per request). A small share of the L4, which the ASR and the reranker
    # share; a part is a sentence or two (care.speak takes at most 300 characters), so short contexts and few at once.
    voice = VoxCPM.from_pretrained(os.environ.get("MODELS", "/app/models") + "/tts", inference_timesteps=10, max_num_seqs=8, max_model_len=2048,
                                   max_num_batched_tokens=4096, gpu_memory_utilization=0.35)
    await voice.wait_for_ready()
    rate = (await voice.get_model_info())["output_sample_rate"]
    anchors = {lang: await voice.encode_latents(open(f"{HERE}/anchors/{lang}.wav", "rb").read(), "wav") for lang in ("en", "ms", "zh")}
    yield
    await voice.stop()


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": True}


class Speak(BaseModel):
    text: str
    cfg_value: float = 2.0  # the settings the round-4 listening test was rated on (docs/tts-training.md)


# A line may run to 1,500 steps (4 minutes of sound; a part is a sentence or two): the engine's own 2,000, with the
# reference clip and the words before it, is over the 2,048 this box gives a line, and it refuses the request.
def said(s: Speak):
    return voice.generate(target_text=s.text, cfg_value=s.cfg_value, ref_audio_latents=anchors[lang_of(s.text)], seed=SEED, max_generate_length=1500)


# MP3, not WAV: about 90 kbps against 768 for 48 kHz WAV (49 KB instead of 420 for 4.5 s), so a part crosses from the
# US box to Malaysia in a round trip or two instead of a second of TCP slow start.
@app.post("/v1/tts")
async def speak(s: Speak):
    wav = np.concatenate([chunk async for chunk in said(s)])
    buf = io.BytesIO()
    sf.write(buf, wav, rate, format="MP3")
    return Response(buf.getvalue(), media_type="audio/mpeg")


# The same line as it is made: raw PCM16 at the model's rate (48 kHz), a piece at a time, so its first sound can be
# played while the rest is still being made (the whole line as one MP3 above is a wait of its full length).
@app.post("/v1/tts/stream")
async def speak_stream(s: Speak):
    async def pieces():
        async for chunk in said(s):
            yield (np.clip(chunk, -1, 1) * 32767).astype("<i2").tobytes()

    return StreamingResponse(pieces(), media_type="application/octet-stream", headers={"x-sample-rate": str(rate)})


if __name__ == "__main__":  # the engine starts its worker process with spawn, which re-imports this file
    uvicorn.run(app, host="127.0.0.1", port=8002)

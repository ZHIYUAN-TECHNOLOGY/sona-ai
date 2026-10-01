"""Sona's voice on box ②: the fine-tuned VoxCPM2 (docs/tts-training.md) on Nano-vLLM-VoxCPM, which runs the whole
decoding step as CUDA graphs (VoxCPM2 0.10x real time on a 4090 in its benchmark; plain VoxCPM was 1.3-1.7x on this
L4, 1 Oct). Runs in its own venv (/opt/tts: torch 2.8 with prebuilt flash-attn), started by gateway.py on :8002."""
import contextlib
import io

import numpy as np
import soundfile as sf
import uvicorn
from fastapi import FastAPI, Response
from pydantic import BaseModel

voice = None
rate = 48_000


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    global voice, rate
    from nanovllm_voxcpm import VoxCPM

    # The rated settings (10 steps here, cfg 2.0 per request). A small share of the L4, which the ASR and the reranker
    # share; a part is a sentence or two (care.speak takes at most 300 characters), so short contexts and few at once.
    voice = VoxCPM.from_pretrained("/app/models/tts", inference_timesteps=10, max_num_seqs=8, max_model_len=2048,
                                   max_num_batched_tokens=4096, gpu_memory_utilization=0.35)
    await voice.wait_for_ready()
    rate = (await voice.get_model_info())["output_sample_rate"]
    yield
    await voice.stop()


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": True}


class Speak(BaseModel):
    text: str
    cfg_value: float = 2.0  # the settings the round-4 listening test was rated on (docs/tts-training.md)


# MP3, not WAV: about 90 kbps against 768 for 48 kHz WAV (49 KB instead of 420 for 4.5 s), so a part crosses from the
# US box to Malaysia in a round trip or two instead of a second of TCP slow start.
@app.post("/v1/tts")
async def speak(s: Speak):
    wav = np.concatenate([chunk async for chunk in voice.generate(target_text=s.text, cfg_value=s.cfg_value)])
    buf = io.BytesIO()
    sf.write(buf, wav, rate, format="MP3")
    return Response(buf.getvalue(), media_type="audio/mpeg")


if __name__ == "__main__":  # the engine starts its worker process with spawn, which re-imports this file
    uvicorn.run(app, host="127.0.0.1", port=8002)

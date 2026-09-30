"""Box ② gateway: Baseten gives a container one port, so this sits in front of the ASR vLLM server and runs the
smaller models in-process. Everything loads before the server starts, so /health answers only once all is up."""
import functools
import io
import subprocess
import threading
import time
import urllib.request

import httpx
import soundfile as sf
import torch
import uvicorn
import voxcpm.model.voxcpm2 as voxcpm2
from fastapi import FastAPI, Request, Response
from pydantic import BaseModel
from safetensors.torch import load_file
from sentence_transformers import CrossEncoder
from voxcpm import VoxCPM

# The box has 11.5 GiB of RAM. VoxCPM2 builds its model and reads its 9 GB fp32 checkpoint on the CPU, which overflows
# it, so build and read straight onto the GPU while nothing else is there yet.
voxcpm2.load_file = functools.partial(load_file, device="cuda")
with torch.device("cuda"):
    tts = VoxCPM("/app/models/tts", zipenhancer_model_path=None, enable_denoiser=False, optimize=False, device="cuda")
tts_lock = threading.Lock()  # ponytail: one voice at a time; a second replica (or nano-vllm-voxcpm) when it queues
reranker = CrossEncoder("/app/models/rerank", device="cuda", model_kwargs={"torch_dtype": torch.float16})
torch.cuda.empty_cache()

# ASR last, so vLLM sizes its share around the models already on the GPU. 4096 tokens covers vLLM's 30 s
# transcription chunks; bf16 because the fine-tuned config names no dtype.
vllm = subprocess.Popen(["vllm", "serve", "/app/models/asr", "--served-model-name", "sona-asr", "--host", "127.0.0.1",
                         "--port", "8001", "--dtype", "bfloat16", "--gpu-memory-utilization", "0.4",
                         "--max-model-len", "4096", "--override-generation-config.max_new_tokens", "4096"])
while True:
    if vllm.poll() is not None:
        raise SystemExit("ASR vLLM exited")  # so Baseten restarts the box instead of billing an idle wait
    try:
        urllib.request.urlopen("http://127.0.0.1:8001/health")
        break
    except OSError:
        time.sleep(2)

asr = httpx.AsyncClient(base_url="http://127.0.0.1:8001", timeout=600)
app = FastAPI()


@app.get("/health")
async def health():
    if vllm.poll() is not None:
        return Response(status_code=503)
    return Response(status_code=(await asr.get("/health")).status_code)


@app.post("/v1/audio/transcriptions")
async def transcribe(request: Request):
    r = await asr.post("/v1/audio/transcriptions", content=await request.body(),
                       headers={"content-type": request.headers["content-type"]})
    return Response(r.content, r.status_code, media_type=r.headers.get("content-type"))


class Speak(BaseModel):
    text: str
    cfg_value: float = 2.0  # the settings the round-4 listening test was rated on (docs/tts-training.md)
    inference_timesteps: int = 10


@app.post("/v1/tts")
def speak(s: Speak):
    with tts_lock:
        wav = tts.generate(text=s.text, cfg_value=s.cfg_value, inference_timesteps=s.inference_timesteps)
    buf = io.BytesIO()
    sf.write(buf, wav, tts.tts_model.sample_rate, format="WAV")
    return Response(buf.getvalue(), media_type="audio/wav")


class Rerank(BaseModel):
    query: str
    passages: list[str]


@app.post("/v1/rerank")
def rerank(r: Rerank):
    return {"scores": reranker.predict([(r.query, p) for p in r.passages]).tolist()}


uvicorn.run(app, host="0.0.0.0", port=8000)

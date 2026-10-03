"""Box ② gateway: Baseten gives a container one port, so this sits in front of the ASR vLLM server and Sona's voice
(two local servers) and runs the reranker in-process. Everything loads before the server starts, so /health answers
only once all is up.
On SageMaker (packages/infra/aws/voice) the same file serves: MODELS and PORT come from the environment, and SageMaker's
one route, POST /invocations, goes to the three by what is sent."""
import os
import subprocess
import time
import urllib.request

import httpx
import torch
import uvicorn
from fastapi import FastAPI, Request, Response
from pydantic import BaseModel
from sentence_transformers import CrossEncoder

MODELS, PORT = os.environ.get("MODELS", "/app/models"), int(os.environ.get("PORT", 8000))


def wait_for(proc: subprocess.Popen, url: str, name: str):
    while True:
        if proc.poll() is not None:
            raise SystemExit(f"{name} exited")  # so Baseten restarts the box instead of billing an idle wait
        try:
            urllib.request.urlopen(url)
            return
        except OSError:
            time.sleep(2)


# Sona's voice first, in its own venv (data/tts_server.py: Nano-vLLM-VoxCPM needs flash-attn, which has no build for
# this image's torch), so it takes its share of the GPU before the reranker and vLLM.
voice = subprocess.Popen(["/opt/tts/bin/python", "/app/data/tts_server.py"])
wait_for(voice, "http://127.0.0.1:8002/health", "Voice server")

reranker = CrossEncoder(f"{MODELS}/rerank", device="cuda", model_kwargs={"torch_dtype": torch.float16})
torch.cuda.empty_cache()

# ASR last, so vLLM sizes its share around the models already on the GPU. 4096 tokens covers vLLM's 30 s
# transcription chunks; bf16 because the fine-tuned config names no dtype.
vllm = subprocess.Popen(["vllm", "serve", f"{MODELS}/asr", "--served-model-name", "sona-asr", "--host", "127.0.0.1",
                         "--port", "8001", "--dtype", "bfloat16", "--gpu-memory-utilization", "0.4",
                         "--max-model-len", "4096", "--override-generation-config.max_new_tokens", "4096"])
wait_for(vllm, "http://127.0.0.1:8001/health", "ASR vLLM")

asr = httpx.AsyncClient(base_url="http://127.0.0.1:8001", timeout=600)
tts = httpx.AsyncClient(base_url="http://127.0.0.1:8002", timeout=120)
app = FastAPI()


@app.get("/health")
async def health():
    if vllm.poll() is not None or voice.poll() is not None:
        return Response(status_code=503)
    return Response(status_code=(await asr.get("/health")).status_code)


@app.post("/v1/audio/transcriptions")
async def transcribe(request: Request):
    r = await asr.post("/v1/audio/transcriptions", content=await request.body(),
                       headers={"content-type": request.headers["content-type"]})
    return Response(r.content, r.status_code, media_type=r.headers.get("content-type"))


@app.post("/v1/tts")
async def speak(request: Request):
    r = await tts.post("/v1/tts", content=await request.body(), headers={"content-type": "application/json"})
    return Response(r.content, r.status_code, media_type=r.headers.get("content-type"))


class Rerank(BaseModel):
    query: str
    passages: list[str]


@app.post("/v1/rerank")
def rerank(r: Rerank):
    return {"scores": reranker.predict([(r.query, p) for p in r.passages]).tolist()}


# SageMaker's contract: GET /ping, and every request on POST /invocations. An uploaded file is speech to write down;
# JSON with passages is a rerank; other JSON is a line for Sona's voice.
app.get("/ping")(health)


@app.post("/invocations")
async def invocations(request: Request):
    if request.headers.get("content-type", "").startswith("multipart/"):
        return await transcribe(request)
    body = await request.json()
    return rerank(Rerank(**body)) if "passages" in body else await speak(request)


uvicorn.run(app, host="0.0.0.0", port=PORT)

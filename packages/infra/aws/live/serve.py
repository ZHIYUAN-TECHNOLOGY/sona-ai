"""Box ④ under SageMaker's two routes. live.py runs beside this on port 8000 as on Baseten, and /ping answers once it
has loaded and warmed.

A live call is a WebSocket, and SageMaker in Malaysia carries none (its two-way streaming is not offered in
ap-southeast-5, 4 Oct 2026). So /invocations carries one call as plain requests (the Worker's end: sagemakerLive in
packages/api/src/sagemaker.ts), in the order they are sent:
  JSON {"type": "start", ...}   opens the call on live.py (its start message) and answers its {"type": "ready"}
  bytes (application/octet-stream)   the patient's audio, 16 kHz PCM16, any length
  JSON {"type": "say" | "stop", ...}   passed on as they are
  JSON {"type": "listen"}   answers with a stream of everything live.py sends back, as frames: a byte (0 text, 1 her
       voice, 2 the call is over), a length (4 bytes, big-endian), the bytes. It ends after LISTEN_S, short of the
       longest an invocation may last, and the caller asks again; what is sent between two listens waits for the next.
One call at a time, as live.py takes them.

For measuring a GPU, {"run": {env}} plays check.py's recorded question to live.py inside the box, and {} returns that
run's output so far, the GPUs' memory and live.py's last lines (test.sh)."""
import asyncio
import contextlib
import json
import os
import struct
import subprocess
import sys
import time
import urllib.request

import uvicorn
import websockets
from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse

LISTEN_S = 45
log = open("/tmp/live.log", "w")
live = subprocess.Popen([sys.executable, "/app/data/live.py"], env={**os.environ, "PORT": "8000"}, stdout=log, stderr=subprocess.STDOUT)
run = {"proc": None}
call: dict = {}  # the open call: its socket to live.py, what live.py has sent that no listen has taken yet, its reader
app = FastAPI()


def tail(path, n=40):
    try:
        return open(path).read().splitlines()[-n:]
    except OSError:
        return []


@app.get("/ping")
def ping():
    if live.poll() is not None:  # it died (out of memory?): say why in the endpoint's log, and fail the start
        print("\n".join(tail("/tmp/live.log", 60)), flush=True)
        return Response(status_code=500)
    try:
        return Response(status_code=urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=2).status)
    except OSError:
        return Response(status_code=503)


async def hang_up():
    if call:
        ws, reader = call["ws"], call["reader"]
        call.clear()
        reader.cancel()
        with contextlib.suppress(Exception):
            await ws.close()


async def start(message: dict):
    await hang_up()
    ws = await websockets.connect("ws://127.0.0.1:8000/v1/live", max_size=None)
    await ws.send(json.dumps(message))
    ready = await ws.recv()
    out: asyncio.Queue = asyncio.Queue()

    async def read():
        with contextlib.suppress(Exception):
            async for m in ws:
                out.put_nowait(m)
        out.put_nowait(None)  # live.py closed the call

    call.update(ws=ws, out=out, reader=asyncio.create_task(read()))
    return ready


async def frames(out: asyncio.Queue):
    until = time.time() + LISTEN_S
    while (left := until - time.time()) > 0:
        try:
            m = await asyncio.wait_for(out.get(), left)
        except asyncio.TimeoutError:
            return
        if m is None:
            yield struct.pack(">BI", 2, 0)
            return
        data = m if isinstance(m, bytes) else m.encode()
        yield struct.pack(">BI", isinstance(m, bytes), len(data)) + data


@app.post("/invocations")
async def invocations(request: Request):
    body = await request.body()
    if request.headers.get("content-type", "").startswith("application/octet-stream"):
        if not call:
            return Response(status_code=409)
        await call["ws"].send(body)
        return Response(status_code=204)
    message = json.loads(body or b"{}")
    kind = message.get("type")
    if kind == "start":
        return Response(await start(message), media_type="application/json")
    if kind == "listen":
        if not call:
            return Response(struct.pack(">BI", 2, 0), media_type="application/octet-stream")
        return StreamingResponse(frames(call["out"]), media_type="application/octet-stream")
    if kind:
        if call:
            await call["ws"].send(json.dumps(message))
        if kind == "stop":
            await hang_up()
        return Response(status_code=204)
    if "run" in message:
        run["proc"] = subprocess.Popen([sys.executable, "/app/check.py", "/app/question.wav"], cwd="/tmp",
                                       env={**os.environ, "JSON": "/tmp/run.json", "OUT": "/tmp/reply.wav", **message["run"]},
                                       stdout=open("/tmp/run.log", "w"), stderr=subprocess.STDOUT)
    gpu = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu", "--format=csv,noheader"],
                         capture_output=True, text=True).stdout.strip()
    done = run["proc"] is not None and run["proc"].poll() is not None
    return {"done": done, "gpu": gpu, "run": tail("/tmp/run.log", 80), "live": tail("/tmp/live.log", 12),
            "result": json.load(open("/tmp/run.json")) if done and os.path.exists("/tmp/run.json") else None}


uvicorn.run(app, host="0.0.0.0", port=8080)

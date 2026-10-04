"""Box ④ under SageMaker's two routes, for measuring it on a GPU there. live.py runs beside this on port 8000 as on
Baseten. /ping answers once live.py has loaded and warmed. /invocations with {"run": {env}} plays check.py's recorded
question to it in real time inside the box (a slow GPU can take longer than an invocation's 60 s, so the run goes on
in the background), and with {} returns the run's output so far, the GPU's memory and live.py's last lines."""
import json
import os
import subprocess
import sys
import urllib.request

import uvicorn
from fastapi import FastAPI, Request, Response

log = open("/tmp/live.log", "w")
live = subprocess.Popen([sys.executable, "/app/data/live.py"], env={**os.environ, "PORT": "8000"}, stdout=log, stderr=subprocess.STDOUT)
run = {"proc": None}
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


@app.post("/invocations")
async def invocations(request: Request):
    body = json.loads(await request.body() or b"{}")
    if "run" in body:
        run["proc"] = subprocess.Popen([sys.executable, "/app/check.py", "/app/question.wav"], cwd="/tmp",
                                       env={**os.environ, "JSON": "/tmp/run.json", "OUT": "/tmp/reply.wav", **body["run"]},
                                       stdout=open("/tmp/run.log", "w"), stderr=subprocess.STDOUT)
    gpu = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu", "--format=csv,noheader"],
                         capture_output=True, text=True).stdout.strip()
    done = run["proc"] is not None and run["proc"].poll() is not None
    return {"done": done, "gpu": gpu, "run": tail("/tmp/run.log", 80), "live": tail("/tmp/live.log", 12),
            "result": json.load(open("/tmp/run.json")) if done and os.path.exists("/tmp/run.json") else None}


uvicorn.run(app, host="0.0.0.0", port=8080)

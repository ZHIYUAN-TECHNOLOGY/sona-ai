"""Serve the fine-tuned Sona Laya over laya-serve's /v1/systemone (Jev wire protocol), for the json-render adapter.

HF_TOKEN=... LAYA_PORT=8000 python serve.py   # SONA_LAYA=<local dir or repo> to override
Requests must send "model": "multilingual" so the router never auto-routes to the stock English checkpoint.
"""
import os
import uvicorn
from laya.router import Router
from laya.serve import create_app

router = Router(device=os.environ.get("LAYA_DEVICE") or None)
router.models["multilingual"] = os.path.expanduser(os.environ.get("SONA_LAYA", "zhiyuantechnology/sona-laya"))
router.preload(["multilingual"])
uvicorn.run(create_app(router), host=os.environ.get("LAYA_HOST", "127.0.0.1"), port=int(os.environ.get("LAYA_PORT", "8000")))

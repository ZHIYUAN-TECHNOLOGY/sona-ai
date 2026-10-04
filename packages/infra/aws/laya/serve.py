"""laya-serve as packages/infra/baseten/laya starts it, under SageMaker's two routes: /ping is its /health and
/invocations its /v1/systemone. SageMaker passes "serve" as an argument (unused); the weights are at /opt/ml/model."""
import uvicorn
from laya.router import Router
from laya.serve import create_app

ROUTES = {"/ping": "/health", "/invocations": "/v1/systemone"}

router = Router(device="cpu")
router.models["multilingual"] = "/opt/ml/model"
router.preload(["multilingual"])
laya = create_app(router)


async def app(scope, receive, send):
    if scope["type"] == "http" and scope["path"] in ROUTES:
        scope = {**scope, "path": ROUTES[scope["path"]], "raw_path": ROUTES[scope["path"]].encode()}
    await laya(scope, receive, send)


uvicorn.run(app, host="0.0.0.0", port=8080)

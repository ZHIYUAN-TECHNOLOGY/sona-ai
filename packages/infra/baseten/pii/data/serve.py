"""OpenMed's own REST service (openmed.service) as the PII box runs it.

The service answers only requests addressed to localhost, its guard against DNS rebinding. Baseten's proxy forwards
each request under another host name, and only callers holding a Baseten API key get that far, so every request is
presented to the service as local.
"""
import uvicorn
from openmed.service import create_app

app = create_app()


async def local(scope, receive, send):
    if scope["type"] in ("http", "websocket"):
        scope = {**scope, "headers": [(k, b"localhost") if k == b"host" else (k, v) for k, v in scope["headers"]]}
    await app(scope, receive, send)


uvicorn.run(local, host="0.0.0.0", port=8000)

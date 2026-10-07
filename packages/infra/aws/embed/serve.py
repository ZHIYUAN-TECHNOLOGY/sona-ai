"""EmbeddingGemma-300M, the library's embedder, under SageMaker's two routes. /invocations takes what the Worker sent
Workers AI, {"text": [...]} with the retrieval prompts already on each text, and answers {"data": [[768 floats], ...]}
in the same order, so the Worker's embedder changes only where it sends. A CPU box: the linear layers in int8
(2x the speed of fp32 on 2 vCPUs, vectors within ~0.01 cosine of fp32), the first 1,024 tokens of a text, four
texts at a time (16 long ones ran the 4 GB out). SageMaker passes "serve" as an argument (unused); the weights are at
/opt/ml/model."""
import asyncio

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import torch
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("/opt/ml/model", device="cpu")
model.max_seq_length = 1024
model[0].auto_model = torch.quantization.quantize_dynamic(model[0].auto_model, {torch.nn.Linear}, dtype=torch.qint8)
app = FastAPI()
one_at_a_time = asyncio.Lock()  # torch already uses every core for one batch; two batches at once only thrash


class Texts(BaseModel):
    text: list[str]


@app.get("/ping")
def ping():
    return {"ok": True}


@app.post("/invocations")
async def embed(body: Texts):
    if not body.text or len(body.text) > 100: raise HTTPException(400, "1 to 100 texts a call")
    async with one_at_a_time:
        vectors = await asyncio.to_thread(model.encode, body.text, batch_size=4, normalize_embeddings=True)
    return {"data": vectors.tolist()}


uvicorn.run(app, host="0.0.0.0", port=8080)

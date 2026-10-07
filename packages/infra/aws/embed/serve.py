"""EmbeddingGemma-300M, the library's embedder, and BiomedCLIP, the films' embedder, under SageMaker's two routes.
/invocations takes what the Worker sent Workers AI, {"text": [...]} with the retrieval prompts already on each text, and
answers {"data": [[768 floats], ...]} in the same order, so the Worker's embedder changes only where it sends. The
same route takes {"image": ["<base64 jpeg/png>", ...]} (20 at most) and {"image_text": ["effusion on the left", ...]}
and answers BiomedCLIP's 512-d vectors from its image and text towers, normalised, so a film and a phrase compare by
cosine (packages/api/src/routers/xray.ts, xray.similar). A CPU box (ml.c6i.xlarge, 4 vCPU, 8 GB, since 7 Oct: the two
models ran 4 GB out at start): the linear layers in int8 (2x the speed of fp32, vectors within ~0.01 cosine of fp32),
the first 1,024 tokens of a text, four texts at a time. SageMaker passes "serve" as an argument (unused); the weights are
at /opt/ml/model, BiomedCLIP's under biomedclip/ there with its text tower's BERT config and tokenizer under
biomedclip/bert/, so nothing is fetched at start."""
import asyncio
import base64
import gc
import io
import json
import os

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image
import torch
import torch.nn.functional as F
from sentence_transformers import SentenceTransformer
import open_clip

torch.set_num_threads(int(os.environ.get("OMP_NUM_THREADS", "2")))
model = SentenceTransformer("/opt/ml/model", device="cpu")
model.max_seq_length = 1024
int8 = lambda m: torch.quantization.quantize_dynamic(m, {torch.nn.Linear}, dtype=torch.qint8)
model[0].auto_model = int8(model[0].auto_model)
gc.collect()  # the fp32 Gemma goes before BiomedCLIP loads: both at once ran 4 GB out at start (7 Oct)

# BiomedCLIP from its files, not the hub: its config names the hub BERT for the text tower and tokenizer, so those are
# pointed at the local copy (the HF model card's offline recipe, with the BERT made local too). The checkpoint is built
# empty and loaded from an mmap of the file, so its 780 MB are never held twice.
CLIP_DIR = "/opt/ml/model/biomedclip"
with open(f"{CLIP_DIR}/open_clip_config.json") as f: clip_cfg = json.load(f)
clip_cfg["model_cfg"]["text_cfg"]["hf_model_name"] = clip_cfg["model_cfg"]["text_cfg"]["hf_tokenizer_name"] = f"{CLIP_DIR}/bert"
open_clip.factory._MODEL_CONFIGS["biomedclip"] = clip_cfg["model_cfg"]
# pretrained_hf=False: the BERT's weights are in the checkpoint, not under bert/.
clip, _, preprocess = open_clip.create_model_and_transforms("biomedclip", pretrained_hf=False, **{f"image_{k}": v for k, v in clip_cfg["preprocess_cfg"].items()})
state = torch.load(f"{CLIP_DIR}/open_clip_pytorch_model.bin", map_location="cpu", mmap=True, weights_only=True)
state.pop("text.transformer.embeddings.position_ids", None)  # a buffer newer transformers no longer keep (open_clip drops it too)
clip.load_state_dict(state)
clip = int8(clip.eval())
gc.collect()
tokenize = open_clip.get_tokenizer("biomedclip")

app = FastAPI()
one_at_a_time = asyncio.Lock()  # torch already uses every core for one batch; two batches at once only thrash


class Body(BaseModel):
    text: list[str] | None = None
    image: list[str] | None = None
    image_text: list[str] | None = None


@torch.inference_mode()
def films(images: list[str]):
    pixels = torch.stack([preprocess(Image.open(io.BytesIO(base64.b64decode(b))).convert("RGB")) for b in images])
    return F.normalize(clip.encode_image(pixels), dim=-1).tolist()


@torch.inference_mode()
def phrases(texts: list[str]):
    return F.normalize(clip.encode_text(tokenize(texts)), dim=-1).tolist()


@app.get("/ping")
def ping():
    return {"ok": True}


@app.post("/invocations")
async def embed(body: Body):
    if body.text:
        if len(body.text) > 100: raise HTTPException(400, "1 to 100 texts a call")
        async with one_at_a_time:
            vectors = await asyncio.to_thread(model.encode, body.text, batch_size=4, normalize_embeddings=True)
        return {"data": vectors.tolist()}
    if body.image:
        if len(body.image) > 20: raise HTTPException(400, "1 to 20 images a call")
        async with one_at_a_time:
            try: return {"data": await asyncio.to_thread(films, body.image)}
            except (OSError, ValueError): raise HTTPException(400, "not an image")  # PIL and base64 errors both
    if body.image_text:
        if len(body.image_text) > 100: raise HTTPException(400, "1 to 100 image_text a call")
        async with one_at_a_time:
            return {"data": await asyncio.to_thread(phrases, body.image_text)}
    raise HTTPException(400, "send text, image or image_text")


uvicorn.run(app, host="0.0.0.0", port=8080)

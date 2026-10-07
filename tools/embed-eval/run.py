"""EmbeddingGemma 1 (300M, what the library uses today on Workers AI) against EmbeddingGemma 2 (text only), on the
library's own job: a patient's question in, the right leaflet out. The 21 demo leaflets (7 topics in English, Malay and
Chinese, packages/db seedLeaflets) sit among 1,800 nurse lines on the same subjects (tools/tts-eval/scripts), which
make wrong answers look close (some of them answer the question too, so the leaflets-only rank, among the 21, is the
cleaner reading). 56 questions (questions.json), 2 per topic in English, Malay, Chinese and code-switched
Manglish; a hit is a leaflet on the right topic in any language. Each model gets its own retrieval prompts, as the
Worker sends them (old) and its model card gives them (new), and the new one also with the old prompts. Also: seconds
for one question on this CPU.

  ~/zyt/venvs/embed/bin/python tools/embed-eval/run.py <leaflets.json>
"""
import json, sys, time
from pathlib import Path

import numpy as np, torch
from sentence_transformers import SentenceTransformer

HERE = Path(__file__).parent
leaflets = json.load(open(sys.argv[1]))
nurse = [r["text"] for lang in ("en", "ms", "zh") for r in json.load(open(HERE.parent / "tts-eval/scripts" / f"{lang}.json"))]
questions = json.load(open(HERE / "questions.json"))
docs = [(l["id"].split(":")[2], l["title"], l["text"]) for l in leaflets] + [(None, "none", t) for t in nurse]

MODELS = {
    "EmbeddingGemma 1 (300M)": ("google/embeddinggemma-300m", {}, lambda q: f"task: search result | query: {q}", lambda t, x: f"title: none | text: {t}\n{x}"),
    # Text only: the vision and audio encoders are not loaded (its model card).
    "EmbeddingGemma 2 (text)": ("google/embeddinggemma-2", {"config_kwargs": {"vision_config": None, "audio_config": None}},
                                lambda q: f"task: question answering | query: {q}", lambda t, x: f"title: {t} | text: {x}"),
    "EmbeddingGemma 2, old prompts": ("google/embeddinggemma-2", {"config_kwargs": {"vision_config": None, "audio_config": None}},
                                      lambda q: f"task: search result | query: {q}", lambda t, x: f"title: none | text: {t}\n{x}"),
}


for name, (repo, kw, query, doc) in MODELS.items():
    m = SentenceTransformer(repo, device="cpu", **kw)
    D = m.encode([doc(t, x) for _, t, x in docs], batch_size=64, normalize_embeddings=True, convert_to_numpy=True)
    Q = m.encode([query(q["q"]) for q in questions], normalize_embeddings=True, convert_to_numpy=True)
    ranks, alone = [], []
    for qi, q in enumerate(questions):
        order = np.argsort(-(D @ Q[qi]))
        ranks.append(next((r for r, i in enumerate(order) if docs[i][0] == q["topic"]), 999))
        among = [i for i in order if docs[i][0]]  # the leaflets alone, in the same order
        alone.append(next(r for r, i in enumerate(among) if docs[i][0] == q["topic"]))
    t = time.time()
    for q in questions[:20]: m.encode(query(q["q"]), normalize_embeddings=True)
    per = (time.time() - t) / 20
    print(f"\n{name}: one question {per * 1000:.0f} ms on this CPU")
    for lang in ("en", "ms", "zh", "mix", None):
        r = np.array([k for k, q in zip(ranks, questions) if lang is None or q["lang"] == lang])
        a = np.array([k for k, q in zip(alone, questions) if lang is None or q["lang"] == lang])
        print(f"  {lang or 'all':4} top-1 {np.mean(r == 0):.0%}  top-3 {np.mean(r < 3):.0%}  top-5 {np.mean(r < 5):.0%}  MRR {np.mean(1 / (r + 1)):.3f}"
              f"   | leaflets only: top-1 {np.mean(a == 0):.0%}  MRR {np.mean(1 / (a + 1)):.3f}  (n={len(r)})")
    del m; torch.mps.empty_cache() if torch.backends.mps.is_available() else None

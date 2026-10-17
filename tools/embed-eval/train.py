"""Fine-tunes EmbeddingGemma 2 (text only) for the library's job, a patient's question in and the document that answers
it out, on the corpus write.py made: a question (or a leaflet sentence) is the anchor, its leaflet the positive, and
the hard negative is whichever wrong leaflet or spoken clinician line the base model ranks closest, so the loss works
on near misses (MultipleNegativesRankingLoss with explicit negatives, the model card's prompts). Earlier attempts that
trained on the consultations' patient turn and doctor reply scored worse than stock: they taught that a question
belongs with a spoken line, the shape of the search's distractors. Only the "train" split is trained on; at the end
the held-out leaflets are searched with their own questions and the result printed.

  python train.py <corpus.json> <base model: dir or hf id> <out dir>
Runs the same on a Mac (about 40 minutes for 10,000 pairs) and in the SageMaker training image
(packages/infra/aws/embed, where the three paths are the job's channels and model dir).
"""
import json, random, re, sys

import numpy as np, torch
from datasets import Dataset
from sentence_transformers import SentenceTransformer, SentenceTransformerTrainer, SentenceTransformerTrainingArguments
from sentence_transformers.losses import MultipleNegativesRankingLoss

corpus_path, base, out = sys.argv[1:4]
QUERY, DOC = "task: question answering | query: ", "title: {title} | text: {text}"
rng = random.Random(11)
corpus = json.load(open(corpus_path))
docs = {d["id"]: DOC.format(title=d["title"], text=d["text"]) for d in corpus["docs"]}
train_ids = {d["id"] for d in corpus["docs"] if d["split"] == "train"}

pairs = [(q["q"], docs[q["doc"]]) for q in corpus["questions"] if q["doc"] in train_ids]
for d in corpus["docs"]:
    if d["id"] in train_ids:
        pairs += [(s, docs[d["id"]]) for s in re.split(r"(?<=[.!?。？！])\s*", d["text"]) if len(s) > 20]
rng.shuffle(pairs)
print(len(pairs), "training pairs over", len(train_ids), "leaflets")

device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
model = SentenceTransformer(base, device=device, config_kwargs={"vision_config": None, "audio_config": None})
model.max_seq_length = 256
# Hard negatives from the base model: the closest wrong training leaflet or spoken line.
spoken = [DOC.format(title=s["condition"], text=s["text"]) for s in corpus["spoken"]]
pool = sorted({docs[i] for i in train_ids}) + spoken
P = model.encode(pool, batch_size=128, normalize_embeddings=True, convert_to_numpy=True)
Q = model.encode([QUERY + q for q, _ in pairs], batch_size=128, normalize_embeddings=True, convert_to_numpy=True)
negatives = [next(pool[j] for j in np.argsort(-(P @ Q[k])) if pool[j] != p) for k, (_, p) in enumerate(pairs)]

train = Dataset.from_dict({"anchor": [QUERY + q for q, _ in pairs], "positive": [p for _, p in pairs], "negative": negatives})
args = SentenceTransformerTrainingArguments(output_dir=f"{out}/checkpoints", num_train_epochs=2, per_device_train_batch_size=16, learning_rate=2e-5,
                                            warmup_ratio=0.1, bf16=device == "cuda", logging_steps=50, save_strategy="no", report_to=[], dataloader_num_workers=0)
SentenceTransformerTrainer(model=model, args=args, train_dataset=train, loss=MultipleNegativesRankingLoss(model)).train()
model.save_pretrained(out)

# The held-out leaflets, searched with their own questions among all leaflets and the spoken lines, per language.
held = [q for q in corpus["questions"] if q["doc"] not in train_ids]
all_docs = list(docs.items())
D = model.encode([t for _, t in all_docs] + spoken, batch_size=128, normalize_embeddings=True, convert_to_numpy=True)
H = model.encode([QUERY + q["q"] for q in held], batch_size=128, normalize_embeddings=True, convert_to_numpy=True)
ids = [i for i, _ in all_docs] + [None] * len(spoken)
for lang in ("en", "ms", "zh", "mix", None):
    r = np.array([next(r for r, j in enumerate(np.argsort(-(D @ H[k]))) if ids[j] == q["doc"]) for k, q in enumerate(held) if lang is None or q["lang"] == lang])
    print(f"held-out {lang or 'all':4} top-1 {np.mean(r == 0):.0%}  top-5 {np.mean(r < 5):.0%}  MRR {np.mean(1 / (r + 1)):.3f}  (n={len(r)})")
print("saved", out)

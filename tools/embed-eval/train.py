"""Fine-tunes EmbeddingGemma 2 (text only) for the library's job, a patient's question in and the passage that answers
it out. Training pairs, all synthetic: the consultations' patient turn and the doctor's reply after it
(tools/asr-data/scripts, Malay, English and Mandarin, Manglish throughout), the reply titled with the consultation's
condition the way a library passage carries its document's title (v1 titled them "none", which taught the model that a
question belongs with any untitled spoken line, the very shape of the search's distractors, and scored worse than
stock); two hand-written questions per demo leaflet and language (leaflet-questions.json, not the 56 run.py judges
with); and each leaflet sentence as a question for its leaflet. Every anchor also gets a hard negative, the doctor
reply from another consultation that the stock model ranks closest, so the loss works on near misses rather than
random ones (MultipleNegativesRankingLoss with explicit negatives). A twentieth of the consultations is held out.
Batches of 16: with the negatives a batch of 32 ran out of GPU memory on the M1 Ultra and crawled. About 20 minutes.

  ~/zyt/venvs/embed/bin/python tools/embed-eval/train.py <leaflets.json> [out dir]   # default ~/zyt/data/sona-embed/eg2-sona
"""
import glob, json, random, re, sys
from pathlib import Path

import numpy as np, torch
from datasets import Dataset
from sentence_transformers import SentenceTransformer, SentenceTransformerTrainer, SentenceTransformerTrainingArguments
from sentence_transformers.losses import MultipleNegativesRankingLoss

HERE = Path(__file__).parent
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.home() / "zyt/data/sona-embed/eg2-sona"
QUERY, DOC = "task: question answering | query: ", "title: {title} | text: {text}"
rng = random.Random(11)

pairs, held = [], []  # (question, passage, consultation index or None)
convs = [c for f in sorted(glob.glob(str(HERE.parent / "asr-data/scripts/*/*.json"))) for c in json.load(open(f))]
rng.shuffle(convs)
for i, c in enumerate(convs):
    t = c["turns"]
    for a, b in zip(t, t[1:]):
        if a["speaker"] == "Patient" and b["speaker"] == "Doctor" and len(a["text"]) > 15 and len(b["text"]) > 30:
            (held if i % 20 == 0 else pairs).append((a["text"], DOC.format(title=c["condition"], text=b["text"]), i))
leaflets = {l["id"].split(":", 2)[2]: l for l in json.load(open(sys.argv[1]))}
for key, l in leaflets.items():
    doc = DOC.format(title=l["title"], text=l["text"])
    for q in json.load(open(HERE / "leaflet-questions.json"))[key]: pairs.append((q, doc, None))
    for s in re.split(r"(?<=[.!?。？！])\s*", l["text"]):
        if len(s) > 20: pairs.append((s, doc, None))
rng.shuffle(pairs)
print(len(pairs), "training pairs,", len(held), "held-out consultation pairs")

model = SentenceTransformer("google/embeddinggemma-2", device="mps" if torch.backends.mps.is_available() else "cpu",
                            config_kwargs={"vision_config": None, "audio_config": None})
model.max_seq_length = 256
# Hard negatives from the stock model: the closest passage from a different consultation (or any, for a leaflet question).
passages = [p for _, p, _ in pairs]
P = model.encode(passages, batch_size=64, normalize_embeddings=True, convert_to_numpy=True)
Q = model.encode([QUERY + q for q, _, _ in pairs], batch_size=64, normalize_embeddings=True, convert_to_numpy=True)
negatives = []
for k, (_, p, conv) in enumerate(pairs):
    order = np.argsort(-(P @ Q[k]))
    negatives.append(next(passages[j] for j in order if passages[j] != p and (conv is None or pairs[j][2] != conv)))

train = Dataset.from_dict({"anchor": [QUERY + q for q, _, _ in pairs], "positive": passages, "negative": negatives})
args = SentenceTransformerTrainingArguments(output_dir=str(OUT / "checkpoints"), num_train_epochs=2, per_device_train_batch_size=16, learning_rate=2e-5,
                                            warmup_ratio=0.1, fp16=False, bf16=False, logging_steps=20, save_strategy="no", report_to=[], dataloader_num_workers=0)
SentenceTransformerTrainer(model=model, args=args, train_dataset=train, loss=MultipleNegativesRankingLoss(model)).train()
model.save_pretrained(str(OUT))
json.dump({"query_prompt": QUERY, "held": [[q, p] for q, p, _ in held]}, open(OUT / "held-out.json", "w"), ensure_ascii=False)
print("saved", OUT)

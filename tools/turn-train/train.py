"""Fine-tunes Smart Turn v3.2 to judge "has the speaker finished?" in our patients' languages, on this machine (a Mac's
GPU is enough: 8 M parameters). As published it calls nearly every mid-sentence pause in Malay, Chinese and Manglish
"finished" (tools/turn-eval, 4 Oct 2026), so the early turn it was meant to gate would still cut patients off.

Data, all from speech we already hold: each clip of zhiyuantechnology/sona-manglish-asr (its train and fleurs_train
splits) is used whole, with a moment of quiet after it (finished), and cut at the quietest point of its middle
(not finished: the speaker did go on). Smart Turn's own training clips are mixed in so it keeps what it knew (English
fillers like "um"). Scored before and after every epoch on clips never trained on: the set's test split, FLEURS test in
Malay, English and Chinese (tools/turn-eval's sets), and Smart Turn's own test set.

  HF_TOKEN=... uv run --with torch --with transformers --with onnx --with onnxruntime --with onnxscript --with librosa --with datasets --with pyarrow --with soundfile python train.py
Env: WORK (cache and output, default ~/.cache/sona-turn), CLIPS (ours to train on, default 12000), THEIRS (Smart Turn's
own, default 6000), EPOCHS (3), LR (2e-5), BATCH (32). Output: WORK/sona-turn.onnx (fp32, the published file's interface).
ponytail: the cut is the quietest point, not a word boundary from an aligner, and the quiet after it is digital silence;
real pauses have room noise. Record real calls' pauses before trusting the numbers beyond these sets.
"""
import io
import os
import random
import time
from pathlib import Path

import librosa
import numpy as np
import pyarrow.parquet as pq
import torch
from datasets import Audio, load_dataset
from huggingface_hub import hf_hub_download
from torch.utils.data import DataLoader, Dataset
from transformers import WhisperFeatureExtractor

from model import published

SR = 16_000
WORK = Path(os.environ.get("WORK", Path.home() / ".cache/sona-turn"))
CLIPS, THEIRS = int(os.environ.get("CLIPS", 12_000)), int(os.environ.get("THEIRS", 6_000))
EPOCHS, LR, BATCH = int(os.environ.get("EPOCHS", 3)), float(os.environ.get("LR", 2e-5)), int(os.environ.get("BATCH", 32))
token = os.environ.get("HF_TOKEN")
features = WhisperFeatureExtractor(chunk_length=8)


def decoded(row) -> np.ndarray:
    return librosa.load(io.BytesIO(row["audio"]["bytes"]), sr=SR)[0]


def halves(audio: np.ndarray, rng: random.Random):
    """A clip as (finished, not finished): whole, and cut where its middle is quietest; None when too short to cut."""
    audio = librosa.effects.trim(audio, top_db=35)[0]
    if len(audio) < 2 * SR:
        return None
    lo, hi, hop = int(len(audio) * rng.uniform(0.25, 0.45)), int(len(audio) * rng.uniform(0.6, 0.8)), SR // 20
    cut = min(range(lo, hi, hop), key=lambda i: float(np.mean(audio[i:i + hop] ** 2)))
    return audio[-8 * SR:], audio[:cut][-8 * SR:]


def built(name: str, rows, limit: int, seed: int):
    """(audio, label, set) for up to `limit` clips of `rows`, cached as one file: finished and not finished of each."""
    path = WORK / f"{name}.npz"
    if not path.exists():
        rng, out = random.Random(seed), []
        for i in rng.sample(range(len(rows)), min(limit, len(rows))):
            pair = halves(decoded(rows[i]), rng)
            if pair:
                out += [(pair[0], 1), (pair[1], 0)]
        np.savez(path, audio=np.array([(a * 32767).astype(np.int16) for a, _ in out], dtype=object), label=np.array([l for _, l in out]), allow_pickle=True)
    z = np.load(path, allow_pickle=True)
    return [(a, int(l), name) for a, l in zip(z["audio"], z["label"])]


def theirs(split: str, shards: tuple, limit: int):
    """Smart Turn's own clips (already labelled, a moment of quiet already after them) from a few of its files, cached."""
    path, of = WORK / f"theirs-{split}.npz", 83 if split == "train" else 10
    if not path.exists():
        rows = []
        for n in shards:
            file = hf_hub_download(f"pipecat-ai/smart-turn-data-v3.2-{split}", f"data/train-{n:05d}-of-{of:05d}.parquet", repo_type="dataset")
            rows += pq.read_table(file, columns=["audio", "endpoint_bool", "language"]).to_pylist()
        rows = random.Random(1).sample(rows, min(limit, len(rows)))
        print(f"theirs-{split}:", {l: sum(r["language"] == l for r in rows) for l in sorted({r["language"] for r in rows})}, flush=True)
        np.savez(path, audio=np.array([(decoded(r)[-8 * SR:] * 32767).astype(np.int16) for r in rows], dtype=object),
                 label=np.array([int(r["endpoint_bool"]) for r in rows]), allow_pickle=True)
    z = np.load(path, allow_pickle=True)
    return [(a, int(l), f"theirs-{split}") for a, l in zip(z["audio"], z["label"])]


class Clips(Dataset):
    def __init__(self, rows, train: bool):
        self.rows, self.train = rows, train

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        audio, label, name = self.rows[i]
        audio = audio.astype(np.float32) / 32767
        if not name.startswith("theirs"):  # ours end at the last word: the quiet a pause detector waits for
            audio = np.concatenate([audio, np.zeros(int(SR * (random.uniform(0.2, 0.5) if self.train else 0.2)), np.float32)])
        audio = audio[-8 * SR:] if len(audio) > 8 * SR else np.pad(audio, (8 * SR - len(audio), 0))
        x = features(audio, sampling_rate=SR, return_tensors="np", padding="max_length", max_length=8 * SR, truncation=True, do_normalize=True)
        return torch.from_numpy(x.input_features[0].astype(np.float32)), float(label), name


def scored(model, loader, device):
    """By set: how often finished is heard as finished, and not finished as not finished."""
    model.eval()
    seen: dict = {}
    with torch.no_grad():
        for x, y, names in loader:
            said = (model(x.to(device)) > 0).cpu()
            for ok, label, name in zip(said == (y > 0.5), y, names):
                s = seen.setdefault(name, [0, 0, 0, 0])
                s[int(label) * 2] += 1
                s[int(label) * 2 + 1] += int(ok)
    return " | ".join(f"{name} {s[3] / max(s[2], 1):.0%}/{s[1] / max(s[0], 1):.0%}" for name, s in sorted(seen.items()))


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    ours = lambda split: load_dataset("zhiyuantechnology/sona-manglish-asr", split=split, token=token).cast_column("audio", Audio(decode=False))
    train = built("manglish", ours("train"), CLIPS * 2 // 3, 1) + built("fleurs", ours("fleurs_train"), CLIPS // 3, 2) + theirs("train", (0, 27, 55, 82), THEIRS)
    test = built("manglish-test", ours("test"), 445, 3) + theirs("test", (0, 5), 1000)
    for lang in ("ms_my", "en_us", "cmn_hans_cn"):
        rows = pq.read_table(hf_hub_download("google/fleurs", f"parquet-data/{lang}/test-00000-of-00001.parquet", repo_type="dataset")).to_pylist()
        test += built(f"fleurs-{lang[:2]}-test", rows, 150, 4)
    print(f"train {len(train)} clips ({sum(l for _, l, _ in train)} finished), test {len(test)}", flush=True)

    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    model = published().to(device)
    loader = DataLoader(Clips(train, True), batch_size=BATCH, shuffle=True, num_workers=6, persistent_workers=True, drop_last=True)
    held = DataLoader(Clips(test, False), batch_size=64, num_workers=4)
    print("finished/not finished heard right, as published:", scored(model, held, device), flush=True)
    steps = EPOCHS * len(loader)
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)
    schedule = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=LR, total_steps=steps, pct_start=0.1)
    loss_of, t = torch.nn.BCEWithLogitsLoss(), time.time()
    for epoch in range(EPOCHS):
        model.train()
        for n, (x, y, _) in enumerate(loader):
            loss = loss_of(model(x.to(device)), y.float().to(device))
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            schedule.step()
            if n % 100 == 0:
                print(f"epoch {epoch + 1} step {n}/{len(loader)} loss {loss.item():.3f} ({(time.time() - t) / 60:.0f} min)", flush=True)
        print(f"after epoch {epoch + 1}:", scored(model, held, device), flush=True)
        torch.save(model.state_dict(), WORK / "sona-turn.pt")

    class Probability(torch.nn.Module):  # the published file's interface: features in, the probability of "finished" out
        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, input_features):
            return torch.sigmoid(self.inner(input_features)).reshape(-1, 1)

    torch.onnx.export(Probability(model.cpu().eval()), torch.zeros(1, 80, 800), str(WORK / "sona-turn.onnx"), input_names=["input_features"],
                      output_names=["logits"], dynamic_axes={"input_features": {0: "batch"}}, opset_version=18)
    import onnx

    onnx.save(onnx.load(str(WORK / "sona-turn.onnx")), str(WORK / "sona-turn.onnx"), save_as_external_data=False)  # one file, as published
    (WORK / "sona-turn.onnx.data").unlink(missing_ok=True)
    print("wrote", WORK / "sona-turn.onnx", flush=True)


if __name__ == "__main__":
    main()

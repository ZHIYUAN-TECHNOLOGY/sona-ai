"""Find clips where Gemini read the instruction aloud and cut it off.

Pass 1 transcribes every clip in batches (no length shortcut: at scale most clips leaked, so a
leaked clip looks typical). Pass 2 aligns only the leaked clips with Qwen3-ForcedAligner and trims
the audio just after the instruction's last word ("Chinese"). Clips that still leak or repeat the
line go to bad.txt.
"""
import re, torch, librosa, soundfile as sf
from qwen_asr import Qwen3ASRModel
from voice import AUDIO, DATA
LEAK = re.compile(r"malaysian (accent|doctor|patient|mandarin)|say this", re.I)
def repeated(h):
    h = re.sub(r"\W+", "", h.lower()); n = len(h) // 2
    return n > 10 and h[:n] == h[n:2 * n]
def load16(p): return librosa.load(p, sr=16000)[0]

asr = Qwen3ASRModel.from_pretrained("Qwen/Qwen3-ASR-1.7B", dtype=torch.float32, device_map="mps", max_inference_batch_size=16)
todo = [p for p in sorted(AUDIO.glob("*.wav")) if not p.with_suffix(".asr2").exists()]
for i in range(0, len(todo), 16):
    chunk = todo[i:i + 16]
    for p, r in zip(chunk, asr.transcribe([(load16(p), 16000) for p in chunk])):
        p.with_suffix(".asr2").write_text(r.text)
    if i % 800 == 0: print("pass 1", i, "/", len(todo), flush=True)

leaked = [p for p in sorted(AUDIO.glob("*.wav")) if LEAK.search(p.with_suffix(".asr2").read_text())]
print("leaked", len(leaked), flush=True)
del asr
al = Qwen3ASRModel.from_pretrained("Qwen/Qwen3-ASR-1.7B", dtype=torch.float32, device_map="mps",
                                   forced_aligner="Qwen/Qwen3-ForcedAligner-0.6B", forced_aligner_kwargs={"dtype": torch.float32, "device_map": "mps"})
trimmed = 0
for i in range(0, len(leaked), 16):  # batched: one clip at a time takes ~4 s
    chunk = leaked[i:i + 16]
    audio = [librosa.load(p, sr=None) for p in chunk]
    res = al.transcribe([(librosa.resample(x, orig_sr=sr, target_sr=16000), 16000) for x, sr in audio], return_time_stamps=True)
    for p, (x, sr), r in zip(chunk, audio, res):
        ends = [w.end_time for w in r.time_stamps.items if re.sub(r"\W", "", w.text).lower() == "chinese"]
        if not ends: continue
        start = int((ends[0] + 0.15) * sr); tail = r.text.split("Chinese", 1)[-1].lstrip(" .,")
        sf.write(p, x[start:], sr); p.with_suffix(".asr2").write_text(tail); trimmed += 1
    if i % 800 == 0: print("pass 2", i, "/", len(leaked), flush=True)
bad = [p.stem for p in sorted(AUDIO.glob("*.wav")) if LEAK.search(t := p.with_suffix(".asr2").read_text()) or repeated(t)]
(DATA / "bad.txt").write_text("\n".join(bad))
print(f"clips {len(list(AUDIO.glob('*.wav')))}, leaked {len(leaked)}, trimmed {trimmed}, still bad {len(bad)}")

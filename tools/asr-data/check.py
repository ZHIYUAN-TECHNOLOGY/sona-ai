"""Flag clips where Gemini read the instruction aloud, repeated the line, or ran long; delete them so `voice.py submit --plain` redoes them."""
import glob, re, statistics, sys, librosa, soundfile as sf, torch
from pathlib import Path
from qwen_asr import Qwen3ASRModel
from voice import AUDIO

LEAK = re.compile(r"malaysian (accent|doctor|patient|mandarin)|say this|natural malaysian", re.I)
def units(t): return len(re.findall(r"[一-鿿]", t)) * 0.6 + len(re.findall(r"[A-Za-z0-9]+", t))
def repeated(h):
    h = re.sub(r"\W+", "", h.lower()); n = len(h) // 2
    return n > 10 and h[:n] == h[n:2 * n]

clips = sorted(glob.glob(str(AUDIO / "*.wav")))
ratio = {c: sf.info(c).duration / max(units(Path(c).with_suffix(".txt").read_text()), 1) for c in clips}
med = statistics.median(ratio.values())
asr = Qwen3ASRModel.from_pretrained("Qwen/Qwen3-ASR-1.7B", dtype=torch.float32, device_map="mps")
bad = []
for c in clips:
    if ratio[c] <= 1.3 * med: continue  # normal length: leaks and repeats always add length
    h = Path(c).with_suffix(".asr")
    if not h.exists(): h.write_text(asr.transcribe((librosa.load(c, sr=16000)[0], 16000))[0].text)
    if ratio[c] > 1.8 * med or LEAK.search(h.read_text()) or repeated(h.read_text()): bad.append(c)
print(f"clips {len(clips)}, bad {len(bad)}")
Path(AUDIO.parent / "bad.txt").write_text("\n".join(Path(c).stem for c in bad))
if "--delete" in sys.argv:
    for c in bad: Path(c).unlink(); Path(c).with_suffix(".asr").unlink(missing_ok=True)

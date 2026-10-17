"""Scene augmentation: waiting room, AC/fan room, phone call, quiet room. 16 kHz in, 16 kHz out."""
import glob, os, random, numpy as np, librosa
from pathlib import Path
from scipy.signal import fftconvolve, butter, sosfilt
R = os.environ.get("RIRS_NOISES", str(Path.home() / "zyt/data/RIRS_NOISES"))
RIRS = {k: glob.glob(f"{R}/simulated_rirs/{k}/*/*.wav") for k in ("smallroom", "mediumroom")}
NOISES = glob.glob(f"{R}/real_rirs_isotropic_noises/*noise*.wav") + glob.glob(f"{R}/pointsource_noises/*.wav")
SR = 16000
def load(p): return librosa.load(p, sr=SR)[0]
def rms(x): return np.sqrt(np.mean(x ** 2) + 1e-12)
def at_snr(speech, noise, snr):
    if len(noise) < len(speech): noise = np.tile(noise, len(speech) // len(noise) + 1)
    s = random.randint(0, len(noise) - len(speech)); noise = noise[s:s + len(speech)]
    return noise * rms(speech) / (rms(noise) * 10 ** (snr / 20))
def reverb(x, room):
    h = load(random.choice(RIRS[room])); h = h / (np.abs(h).max() + 1e-9)
    y = fftconvolve(x, h)[:len(x)]; return y * rms(x) / rms(y)
def babble(n, pool):
    b = np.zeros(n)
    for p in random.sample(pool, 5):
        v = load(p); v = np.tile(v, n // len(v) + 1)[:n]; b += np.roll(v, random.randint(0, n))
    return b
def scene(x, kind, babble_pool):
    if kind == "quiet": y = reverb(x, "smallroom")
    elif kind == "waiting_room": y = reverb(x, "mediumroom"); y = y + at_snr(y, reverb(babble(len(y), babble_pool), "mediumroom"), random.uniform(12, 20))
    elif kind == "ac_room": y = reverb(x, "smallroom"); y = y + at_snr(y, load(random.choice(NOISES)), random.uniform(12, 22))
    elif kind == "phone":
        y = librosa.resample(sosfilt(butter(4, [300, 3400], "bandpass", fs=SR, output="sos"), x), orig_sr=SR, target_sr=8000)
        y = librosa.resample(np.tanh(2 * y) / 2, orig_sr=8000, target_sr=SR); y = y + at_snr(y, np.random.randn(len(y)), 30)
    return (y / max(1.0, np.abs(y).max() / 0.95)).astype(np.float32)

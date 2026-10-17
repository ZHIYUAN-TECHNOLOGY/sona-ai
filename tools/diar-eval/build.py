"""Synthetic consultations with 2-8 people, for scoring who-spoke-when (run.py).

Stitched from the Manglish turns already voiced for the ASR (tools/asr-data: one Gemini voice per persona), so who
spoke when is known exactly. Each person keeps one voice, one seat in the room (their own echo) and one loudness; some
turns start before the last one ends. The recorded lines in real_voice are one of the people in half of them, so a real
microphone voice is in the mix. Those 15 clips are one person in two registers (08-12 near 120 Hz, the rest near
165 Hz; the user confirmed it, 6 Oct): the model hears them as two people in 3 recordings of 10, the set's hard case.
Writes <out>/<name>.wav (16 kHz mono), .rttm and .json (the turns: speaker, start, end, text).

  ~/zyt/venvs/diar/bin/python tools/diar-eval/build.py [out dir]   # default ~/zyt/data/sona-diar/set1
"""
import glob, json, os, random, sys, zlib
from pathlib import Path

import librosa, numpy as np, soundfile as sf
from scipy.signal import fftconvolve

SR = 16000
HERE = Path(__file__).parent
ASR = Path(os.environ.get("ASR_DATA_DIR", Path.home() / "zyt/data/sona-asr"))
RIRS = Path(os.environ.get("RIRS_NOISES", Path.home() / "zyt/data/RIRS_NOISES"))
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "zyt/data/sona-diar/set1"
# tools/asr-data/voice.py's voices and its rule for who gets which (not imported: it reads the Gemini key).
MALE = ["Charon", "Orus", "Algenib", "Iapetus", "Umbriel", "Fenrir", "Enceladus", "Rasalgethi"]
FEMALE = ["Kore", "Gacrux", "Zephyr", "Leda", "Aoede", "Despina", "Callirrhoe", "Autonoe"]
TEST = {"male": ["Achird", "Zubenelgenubi"], "female": ["Sulafat", "Pulcherrima"]}
REAL = "real-user"
# How many people, how many consultations of that size.
SIZES = {2: 2, 3: 4, 4: 4, 5: 4, 6: 4, 8: 2}
SECONDS = (180, 240)


def voice_for(conv, who):
    gender = conv[f"{who}_persona"].get("gender", "female")
    if conv.get("split") == "test": return TEST[gender][0 if who == "doctor" else 1]
    pool = MALE if gender == "male" else FEMALE
    return pool[(zlib.crc32(conv["id"].encode()) + (0 if who == "doctor" else 3)) % len(pool)]


def clips():
    """Every voiced turn by voice: {voice: [(wav path, text)]}."""
    by = {}
    for f in sorted(glob.glob(str(HERE.parent / "asr-data/scripts/*/*.json"))):
        for conv in json.load(open(f)):
            for j, turn in enumerate(conv["turns"]):
                wav = ASR / "audio" / f"{conv['id']}_{j:02d}.wav"
                if wav.exists(): by.setdefault(voice_for(conv, "doctor" if turn["speaker"] == "Doctor" else "patient"), []).append((wav, turn["text"]))
    lines = {l["id"]: l["text"] for l in json.load(open(HERE.parent / "asr-data/real_voice_lines.json"))}
    by[REAL] = [(w, lines.get(w.stem, "")) for w in sorted((ASR / "real_voice").glob("*.wav"))]
    return by


def rms(x): return float(np.sqrt(np.mean(x ** 2) + 1e-12))


def consultation(rng, by, people, real):
    voices = rng.sample([v for v in by if v != REAL], people - real) + ([REAL] if real else [])
    rng.shuffle(voices)
    room = rng.choice(sorted((RIRS / "simulated_rirs/smallroom").iterdir()))
    seats = rng.sample(sorted(room.glob("*.wav")), people)
    # The doctor and the patient do most of the talking; the others come in later and say less.
    share = [0.4, 0.35] + [0.25 / max(1, people - 2)] * (people - 2)
    arrives = [0, 0] + sorted(rng.uniform(0.1, 0.7) for _ in range(people - 2))
    gain = [1.0, 10 ** (rng.uniform(-4, 0) / 20)] + [10 ** (rng.uniform(-9, -2) / 20) for _ in range(people - 2)]
    length = rng.uniform(*SECONDS)
    mix, turns, at, last = np.zeros(int((length + 30) * SR), dtype=np.float32), [], 0.5, -1
    while at < length:
        here = [i for i in range(people) if arrives[i] * length <= at and i != last]
        new = [i for i in here if all(t["speaker"] != i for t in turns)]  # whoever has just come in speaks first
        who = new[0] if new else rng.choices(here, [share[i] for i in here])[0]
        wav, text = rng.choice(by[voices[who]])
        x, _ = librosa.load(wav, sr=SR)
        x, _ = librosa.effects.trim(x, top_db=35)
        if len(x) < SR * 0.3: continue
        h, _ = librosa.load(seats[who], sr=SR)
        wet = fftconvolve(x, h / (np.abs(h).max() + 1e-9))
        wet = wet * (0.05 * gain[who] / rms(wet[:len(x)]))
        start = int(at * SR)
        mix[start:start + len(wet)] += wet[:len(mix) - start]
        # Where the voice is really sounding: a pause inside the turn of a quarter second or more is not speech.
        spans = []
        for a, b in librosa.effects.split(x, top_db=35):
            if spans and a / SR - spans[-1][1] < 0.25: spans[-1][1] = b / SR
            else: spans.append([a / SR, b / SR])
        turns.append({"speaker": who, "voice": voices[who], "start": round(at, 2), "end": round(at + len(x) / SR, 2), "text": text,
                      "speech": [[round(at + a, 2), round(at + b, 2)] for a, b in spans]})
        # Mostly a short pause; about one turn in eight starts before this one has ended.
        at += len(x) / SR + (-rng.uniform(0.2, 0.8) if rng.random() < 0.12 else rng.uniform(0.15, 0.9))
        last = who
    mix = mix[:int((turns[-1]["end"] + 1) * SR)]
    noises = glob.glob(str(RIRS / "real_rirs_isotropic_noises/*noise*.wav"))
    if noises and rng.random() < 0.5:  # an air-conditioned room
        n, _ = librosa.load(rng.choice(noises), sr=SR)
        n = np.tile(n, len(mix) // len(n) + 1)[:len(mix)]
        mix += n * (0.05 / rms(n)) * 10 ** (-rng.uniform(15, 25) / 20)
    return (mix / max(1.0, np.abs(mix).max() / 0.95)).astype(np.float32), turns


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    by, rng = clips(), random.Random(7)
    print({v: len(c) for v, c in by.items()})
    for people, count in SIZES.items():
        for k in range(count):
            name = f"p{people}_{k + 1}"
            audio, turns = consultation(rng, by, people, real=k % 2 == 1)
            sf.write(OUT / f"{name}.wav", audio, SR)
            (OUT / f"{name}.json").write_text(json.dumps(turns, ensure_ascii=False, indent=1))
            (OUT / f"{name}.rttm").write_text("".join(f"SPEAKER {name} 1 {a:.2f} {b - a:.2f} <NA> <NA> spk{t['speaker']} <NA> <NA>\n" for t in turns for a, b in t["speech"]))
            heard = sorted({t["speaker"] for t in turns})
            print(name, f"{len(audio) / SR:.0f}s", len(turns), "turns", len(heard), "of", people, "people spoke")

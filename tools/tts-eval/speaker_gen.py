"""Does the fine-tuned VoxCPM2 keep one speaker across the sentences of an answer? Makes every sentence of
scripts/answers.json in its own generate call, the way production does (tts_server.py: cfg 2.0, 10 steps, no seed).

Arm `none` is today's call with no reference audio; arm `ref` is the same call plus reference_wav_path=<anchor>, the
reference-only mode (timbre, no transcript; not the prompt_wav continuation mode, which swapped drug names).
The one anchor for all three languages is ~/zyt/data/sona-tts/kore/audio/family_048_00.wav: a clean 7.5 s clip of the
training voice itself, so it is the voice the fine-tune is meant to speak in, and the model's own eval output has
nothing longer than 6.1 s.
The one anchor cost words (a Malay sentence came out as garbled English: the clip is mostly English), so three more arms:
`none2` is `none` again, to see how much two unseeded runs differ by themselves; `seed` starts every call from the same
noise (torch.manual_seed, the engine's `seed`); `reflang` gives each language a reference clip in that language
(clone_refs.json); `seedreflang` is both.
Writes ~/zyt/data/sona-tts/speaker/<arm>/<id>_<n>.wav, skipping files that exist; score with speaker_score.py.
Run with the VoxCPM venv:  ~/zyt/venvs/voxcpm/bin/python speaker_gen.py <arm> [anchor wav]
"""
import json, sys
from pathlib import Path
import soundfile as sf, torch
from voxcpm import VoxCPM

DATA = Path.home() / "zyt/data/sona-tts"
ANCHOR = DATA / "kore/audio/family_048_00.wav"
arm = sys.argv[1]
assert arm in ("none", "none2", "ref", "seed", "reflang", "seedreflang"), "unknown arm"
anchor = str(sys.argv[2] if len(sys.argv) > 2 else ANCHOR) if arm == "ref" else None
by_lang = {lang: ref["audio"] for lang, ref in json.load(open(DATA / "clone_refs.json")).items()} if "reflang" in arm else {}
out = DATA / "speaker" / arm; out.mkdir(parents=True, exist_ok=True)
model = VoxCPM.from_pretrained(str(DATA / "full/step1000"), load_denoiser=False, optimize=False, device="mps")
answers = json.load(open(Path(__file__).parent / "scripts/answers.json"))
for i, a in enumerate(answers):
    for n, text in enumerate(a["sentences"]):
        p = out / f"{a['id']}_{n}.wav"
        if not p.exists():
            if "seed" in arm: torch.manual_seed(7)
            sf.write(p, model.generate(text=text, cfg_value=2.0, inference_timesteps=10, reference_wav_path=by_lang.get(a["lang"], anchor)), model.tts_model.sample_rate)
    print(i + 1, "/", len(answers), a["id"], flush=True)
print("DONE", flush=True)

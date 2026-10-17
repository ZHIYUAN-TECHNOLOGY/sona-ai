"""Can MiniCPM-o 4.5, untrained, speak Malay? (docs/minicpm-o-finetune.md, stage 3)

It reads sentences aloud in Sona's cloned voice: 20 Malay, with 10 English, 10 Mandarin and 5 Manglish to compare.
score.py then checks its speech against the text it wrote, so the test is of its voice, not its reading.
Runs on the Mac (MPS, half precision); its speech decoder is t2w.py because init_tts() needs CUDA.
Needs `minicpmo-utils[tts]==1.0.6`. Usage: python speak.py [out_dir]   (default ~/zyt/data/sona-omni/speak)
Env: VOICE=<wav> to clone another voice (default: Sona's VoxCPM2 voice reading English);
     TALKER=<talker.safetensors> to speak with a trained talker instead of the base one;
     BRAIN=<model dir> for a fine-tuned brain (a talker reads its brain's states, so test it with the one it trained on).
"""
import json, os, random, sys
from pathlib import Path

import torch
from huggingface_hub import snapshot_download
from transformers import AutoModel, AutoTokenizer

from t2w import ASSETS, REVISION, Token2wav, load

DATA = Path.home() / "zyt/data"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else DATA / "sona-omni/speak"
VOICE = os.environ.get("VOICE") or str(DATA / "sona-tts/eval-full1000/audio/en_22.wav")

lines = [json.loads(l) for l in (DATA / "sona-tts/eval-full1000/manifest.jsonl").read_text().splitlines()]
pick = lambda lang, n: random.Random(1).sample([l["text"] for l in lines if l["lang"] == lang], n)
MANGLISH = [  # how a Malaysian nurse mixes languages in one sentence
    "Auntie, ubat ni kena makan after food, okay? Jangan skip ah.",
    "Kalau demam tak turun dalam tiga hari, please come back to the clinic.",
    "这个药一天吃两次, pagi dan malam, after makan.",
    "Your next appointment is on Monday, jangan lupa bawa kad temujanji.",
    "Kalau rasa sesak nafas, terus call 999, don't wait.",
]
SETS = {"ms_speak": pick("ms", 20), "en_speak": pick("en", 10), "zh_speak": pick("zh", 10), "manglish_speak": MANGLISH}
if os.environ.get("SPEAK_LINES"):  # the hard speaking test instead: voice3/test.jsonl (numbers as words, Manglish with Chinese)
    SETS = {}
    for r in map(json.loads, Path(os.environ["SPEAK_LINES"]).read_text().splitlines()):
        SETS.setdefault(r["cat"], []).append(r["text"])

repo = os.environ.get("BRAIN") or snapshot_download("openbmb/MiniCPM-o-4_5", revision=REVISION, allow_patterns=["*.safetensors", "*.json", "*.py", "*.txt", *ASSETS])
device = "mps" if torch.backends.mps.is_available() else "cpu"
model = AutoModel.from_pretrained(repo, trust_remote_code=True, attn_implementation="sdpa", torch_dtype=torch.float16,
                                  init_vision=False, init_audio=True, init_tts=True).eval().to(device)
tokenizer = AutoTokenizer.from_pretrained(repo, trust_remote_code=True)
model.tts.audio_tokenizer = Token2wav(repo)  # what init_tts() would load, without CUDA
if os.environ.get("TALKER"):  # a trained voice: talker weights from tools/omni-voice-train (talker.safetensors)
    from safetensors.torch import load_file
    model.tts.load_state_dict(load_file(os.environ["TALKER"]), strict=True)
    print("talker weights from", os.environ["TALKER"], flush=True)

# Stage 1 (LLaMA-Factory, plain chat turns) ends a reply with <|im_end|>, not <|tts_eos|>, so chat() reads to the end
# and hands the talker one token more than it has states for. The reply ends at <|im_end|>, as the talker learnt it.
speech, im_end = model._generate_speech_non_streaming, tokenizer.convert_tokens_to_ids("<|im_end|>")
def _ended(outputs, tts_bound, *a, **k):
    seq = list(outputs["full_sequences"][0])
    if tts_bound[1] is None and im_end in seq[tts_bound[0]:]:
        tts_bound = (tts_bound[0], tts_bound[0] + seq[tts_bound[0]:].index(im_end))
    return speech(outputs, tts_bound, *a, **k)
model._generate_speech_non_streaming = _ended

system = {"role": "system", "content": [
    "Clone the voice in the provided audio prompt.", load(VOICE, 16000),
    "Read the user's text aloud exactly as written, word for word, keeping its language or mix of languages. Say nothing else."]}
(OUT / "audio").mkdir(parents=True, exist_ok=True)
with open(OUT / "manifest.jsonl", "w") as log:
    for name, sentences in SETS.items():
        for i, s in enumerate(sentences):
            out = OUT / "audio" / f"{name}_{i:02d}.wav"
            said = model.chat(msgs=[system, {"role": "user", "content": [f"Read this aloud exactly: {s}"]}], tokenizer=tokenizer,
                              do_sample=False, max_new_tokens=160, use_tts_template=True, generate_audio=True, output_audio_path=str(out))
            if device == "mps": torch.mps.empty_cache()
            log.write(json.dumps({"key": f"{name}_{i:02d}", "set": name, "id": i, "target": s, "text": said, "resynth": str(out)}, ensure_ascii=False) + "\n")
            log.flush()
            print(name, i, "|", said, flush=True)

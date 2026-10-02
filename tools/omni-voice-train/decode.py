"""Speak given sentences with MiniCPM-o's chat path (its usual sampling), base talker or a trained one, for score.py.

Usage: python decode.py <rows.jsonl> <out_dir> <set name> [talker.safetensors]
Rows are {text} (extra keys ignored). Writes <out_dir>/audio/<set>_NN.wav and appends to <out_dir>/manifest.jsonl.
"""
import json, sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path[:0] = [str(HERE), str(HERE.parent / "omni-eval")]
import torch
from safetensors.torch import load_file

import talker
from t2w import Token2wav, load as load_audio

rows, out, name = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
model, tokenizer, repo = talker.load()
if len(sys.argv) > 4:
    print("loaded talker:", model.tts.load_state_dict({k: v.to(torch.float16) for k, v in load_file(sys.argv[4]).items()}))
model.tts.audio_tokenizer = Token2wav(repo)
model._decode_text = lambda ids, tok: [""] * len(ids)  # the reply text is given; its decode fails on a new token of id 0
voice = load_audio(str(Path.home() / "zyt/data/sona-tts/eval-full1000/audio/en_22.wav"), 16000)
system = {"role": "system", "content": ["Clone the voice in the provided audio prompt.", voice,
                                        "Read the user's text aloud exactly as written, word for word, keeping its language. Say nothing else."]}
(out / "audio").mkdir(parents=True, exist_ok=True)
with open(out / "manifest.jsonl", "a") as log:
    for i, line in enumerate(rows.read_text().splitlines()):
        text = json.loads(line)["text"]
        wav = out / "audio" / f"{name}_{i:02d}.wav"
        torch.manual_seed(i)
        model.chat(msgs=[system, {"role": "user", "content": [f"Read this aloud exactly: {text}"]},
                         {"role": "assistant", "content": [f"<|tts_bos|>{text}<|tts_eos|>"]}],
                   tokenizer=tokenizer, teacher_forcing=True, use_tts_template=True, generate_audio=True, output_audio_path=str(wav),
                   do_sample=False)  # the one LLM token; sampled it can be id 0, which chat() cannot decode
        torch.mps.empty_cache()
        log.write(json.dumps({"key": f"{name}_{i:02d}", "set": name, "id": i, "text": text, "resynth": str(wav)}, ensure_ascii=False) + "\n")
        log.flush()
        print(name, i, flush=True)

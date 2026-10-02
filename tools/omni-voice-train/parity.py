"""Parity gate for talker training: our teacher-forced talker (talker.py) must reproduce MiniCPM-o's own generation.

Chat layout: chat(teacher_forcing=True) speaks 3 sentences (ms, en, zh); duplex layout: a live session hears a spoken
question and answers. Both run greedy (TTS temperature 1e-5, no repetition penalty). Hooks record the condition the model
built, every code it kept and the raw logits of every talker step; we rebuild the same input teacher-forced and compare.
Runs on the Mac (MPS, fp16). Usage: python parity.py   Exit code 0 only if every check passes.
"""
import sys, tempfile
from pathlib import Path

HERE = Path(__file__).parent
sys.path[:0] = [str(HERE), str(HERE.parent / "omni-eval")]
import numpy as np, torch

import talker
from t2w import Token2wav, load as load_audio

DATA = Path.home() / "zyt/data"
VOICE = DATA / "sona-tts/eval-full1000/audio/en_22.wav"  # Sona's voice reading English
QUESTION = DATA / "sona-asr/real_voice/01.wav"  # "Doktor, saya batuk sampai 睡不着, dah makan Panadol tapi still demam."
SENTENCES = ["Sila ambil ubat ini selepas makan malam.", "Please take one tablet twice a day after food.", "这个药一天吃两次，饭后吃。"]
SYSTEM = "Read the user's text aloud exactly as written, word for word, keeping its language. Say nothing else."

model, tokenizer, repo = talker.load()
tts = model.tts
tts.audio_tokenizer = Token2wav(repo)  # init_tts() would load stepaudio2's, which needs CUDA
mod = sys.modules[type(model).__module__]
EOS = tts.num_audio_tokens - 1
ref = load_audio(str(VOICE), 16000)

steps = []  # raw logits of each recorded talker step
hook = tts.head_code[0].register_forward_hook(lambda m, i, o: steps.append(o[0, -1].float().cpu()) if recording else None)
recording = False


def compare(name, ours, theirs_logits, kept, eos_masked_before, ends_in_eos):
    """ours: teacher-forced logits at the positions that made each recorded step; kept: the codes the model kept."""
    ours = ours.float().cpu()
    diff = (ours - torch.stack(theirs_logits)).abs()
    masked = ours.clone()
    masked[: eos_masked_before, EOS] = -torch.inf
    want = torch.cat([kept.cpu(), torch.tensor([EOS] if ends_in_eos else [], dtype=torch.long)])
    got = masked.argmax(-1)[: len(want)]
    same = int((got == want).sum())
    top2 = torch.stack(theirs_logits)[: len(want)].topk(2, -1).values
    ties = int(((got != want) & ((top2[:, 0] - top2[:, 1]) < 0.1)).sum())
    ok = same + ties == len(want)
    print(f"{name}: {same}/{len(want)} steps reproduced ({ties} near-ties), logits max |Δ| {diff.max():.4f}, mean {diff.mean():.5f}  {'PASS' if ok else 'FAIL'}")
    return ok


passed = True
# --- chat layout ---
orig_generate = tts.generate
seen = {}


def generate(*a, **k):
    seen["cond"] = k["inputs_embeds"][0].clone()
    out = orig_generate(*a, **k)
    seen["codes"], seen["finished"] = out.new_ids[0, :, 0].clone(), bool(out.finished)
    return out


tts.generate = generate
greedy = mod.TTSSamplingParams(temperature=1e-5, repetition_penalty=1.0)
for s in SENTENCES:
    msgs = [{"role": "system", "content": ["Clone the voice in the provided audio prompt.", ref, SYSTEM]},
            {"role": "user", "content": [f"Read this aloud exactly: {s}"]}]
    steps.clear(); recording = True
    with tempfile.NamedTemporaryFile(suffix=".wav") as f:
        model.chat(msgs=[*msgs, {"role": "assistant", "content": [f"<|tts_bos|>{s}<|tts_eos|>"]}], tokenizer=tokenizer, teacher_forcing=True,
                   use_tts_template=True, generate_audio=True, output_audio_path=f.name, tts_sampling_params=greedy, do_sample=False)
    recording = False
    ids, hidden = talker.reply_hidden(model, msgs, s)
    with torch.inference_mode():
        x, y = talker.chat_inputs(tts, ids, hidden, seen["codes"])
        n_cond = len(x) - len(seen["codes"])
        cond_diff = (x[:n_cond] - seen["cond"]).abs().max().item()
        lg = talker.logits(tts, x)[n_cond - 1 : n_cond - 1 + len(steps)]
    ends = seen["finished"]  # False when it hit max_new_token: the last sampled code is dropped, not an EOS
    print(f"chat '{s[:24]}': condition {n_cond} embeds, max |Δ| {cond_diff:.5f}; {len(seen['codes'])} codes")
    passed &= cond_diff < 1e-2 and compare("  chat", lg, list(steps), seen["codes"], 50, ends)
tts.generate = orig_generate

# --- duplex layout ---
model.init_tts = lambda *a, **k: tts.audio_tokenizer  # as_duplex calls it; stepaudio2 Token2wav needs CUDA
duplex = model.as_duplex(tts_temperature=1e-5, tts_repetition_penalty=1.0)
duplex._generate_waveform_from_tokens = lambda *a, **k: None  # no audio needed, only codes
duplex._reset_token2wav_for_new_turn = lambda *a, **k: None
units, calls = [], []
orig_convert, orig_chunk = duplex._convert_results_to_tts_input, tts.generate_chunk


def convert(results):
    units.append((torch.tensor([r[0] for r in results], dtype=torch.long), torch.cat([r[1].squeeze(0) for r in results]) if results else torch.zeros(0, 4096)))
    return orig_convert(results)


def chunk(*a, **k):
    n0 = len(steps)
    new, kv = orig_chunk(*a, **k)
    calls.append({"cond": k["inputs_embeds"][0].clone(), "codes": new[0, :, 0].clone(), "start": k["text_start_pos"],
                  "min": k["min_new_tokens"], "steps": steps[n0:], "unit": units[-1]})
    return new, kv


duplex._convert_results_to_tts_input, tts.generate_chunk = convert, chunk
duplex.prepare(prefix_system_prompt="Streaming Omni Conversation.", ref_audio=ref)
q = load_audio(str(QUESTION), 16000)
audio = np.concatenate([q, np.zeros(16000 * 20, dtype=np.float32)])
recording = True
for i, start in enumerate(range(0, len(audio) - 16560, 16000)):
    duplex.streaming_prefill(audio_waveform=audio[start : start + (16560 if i == 0 else 16000)])
    r = duplex.streaming_generate(max_new_speak_tokens_per_chunk=20, decode_mode="sampling")
    print(f"  unit {i}: {'listen' if r['is_listen'] else 'speak> ' + r['text']}{'  [end of turn]' if r['end_of_turn'] else ''}")
    if r["end_of_turn"] and len(calls) >= 2:
        break
recording = False
turns, cur = [], []
for c in calls:
    if c["start"] == 0 and cur:
        turns.append(cur); cur = []
    cur.append(c)
if cur:
    turns.append(cur)
if not calls:
    print("duplex: the model never spoke"); passed = False
for t, turn in enumerate(turns):
    with torch.inference_mode():
        x, y = talker.duplex_inputs(tts, [(c["unit"][0].to(model.device), c["unit"][1].to(model.device), c["codes"],
                                           len(c["codes"]) < talker.CODES_PER_UNIT) for c in turn])
        lg = talker.logits(tts, x)
    pos, cond_diff, ours, theirs, kept, masked_before = 0, 0.0, [], [], [], []
    for c in turn:
        n = len(c["cond"])
        cond_diff = max(cond_diff, (x[pos : pos + n] - c["cond"]).abs().max().item())
        ours.append(lg[pos + n - 1 : pos + n - 1 + len(c["steps"])])
        theirs += c["steps"]
        pos += n + len(c["codes"])
    text_per_unit = [len(c["unit"][0]) for c in turn]
    print(f"duplex turn {t}: {len(turn)} units, text tokens per unit {text_per_unit}, codes per unit {[len(c['codes']) for c in turn]}, condition max |Δ| {cond_diff:.5f}")
    for k, c in enumerate(turn):  # per unit, since EOS masking (min_new_tokens) differs per unit
        ends = len(c["codes"]) < talker.CODES_PER_UNIT  # stopped by EOS before its 25 codes
        passed &= compare(f"  unit {k}", ours[k], c["steps"], c["codes"], c["min"], ends) and cond_diff < 1e-2
hook.remove()
print("PARITY:", "PASS" if passed else "FAIL")
sys.exit(0 if passed else 1)

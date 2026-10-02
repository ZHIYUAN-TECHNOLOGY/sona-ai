"""Parity gate for live-format training: layout.example must feed the brain exactly what a live call feeds it.

A real live session (greedy, text only) hears a recorded question and answers. Its decoder is wrapped to keep every
embedding it was fed and the logits it returned. layout.build then rebuilds the same call from the question and what
the session wrote each second, and one forward pass over it must match:
  1. the embeddings, position by position (the layout is the live one);
  2. the logits at every point the session decided or wrote (one pass equals the live, cache-by-cache feeding);
  3. the labels, which must be the tokens the session wrote there.
Runs on the Mac (MPS, fp16). Usage: python parity.py [model dir] [question.wav]   Exit 0 only if every check passes.
"""
import os, sys
from pathlib import Path

import librosa, numpy as np, torch
from transformers import AutoModel

sys.path.insert(0, str(Path(__file__).parent))
import layout

DATA = Path.home() / "zyt/data"
repo = sys.argv[1] if len(sys.argv) > 1 else next((Path.home() / ".cache/huggingface/hub/models--openbmb--MiniCPM-o-4_5/snapshots").glob("503e754*"))
wav = sys.argv[2] if len(sys.argv) > 2 else str(DATA / "sona-asr/real_voice/01.wav")
BRIEF = "You are Sona Care, a hospital's assistant. Answer in at most 3 short sentences."

model = AutoModel.from_pretrained(str(repo), trust_remote_code=True, attn_implementation="sdpa", init_vision=False,
                                  torch_dtype=torch.float16).eval().to("mps")
model.init_tts = lambda **_: None  # text only: the voice decoder needs CUDA
duplex = model.as_duplex(generate_audio=False)
voice = librosa.load(str(DATA / "sona-tts/eval-full1000/audio/en_22.wav"), sr=16_000)[0]
question = librosa.load(wav, sr=16_000)[0]

# 1. The live session, recorded.
fed, logits_at = [], []
real = duplex.decoder.feed
def feed(embeds, return_logits=False):
    fed.append(embeds.detach().clone())
    out = real(embeds, return_logits=return_logits)
    if return_logits:
        logits_at.append((sum(len(e) for e in fed) - 1, out[0][0].float().cpu()))
    return out
duplex.decoder.feed = feed
duplex.prepare(prefix_system_prompt=BRIEF, ref_audio=voice)
audio = np.concatenate([question, np.zeros(12 * layout.UNIT, np.float32)])
units = []
for k in range(len(audio) // layout.UNIT):
    duplex.streaming_prefill(audio_waveform=audio[k * layout.UNIT:(k + 1) * layout.UNIT])
    r = duplex.streaming_generate(prompt_wav_path=None, decode_mode="greedy")
    units.append(r)
    if r["end_of_turn"]:
        break
duplex.decoder.feed = real
live = torch.cat(fed)
spoken = [x for x in duplex.total_hidden if x]  # the talker's inputs, kept before the rebuild's prepare() clears them
schemas = duplex.get_unit_schemas()
print("\n".join(schemas))

# 2. The same call rebuilt from what the session wrote each second.
unit_end, ids_listen = duplex.tokenizer.convert_tokens_to_ids("</unit>"), duplex.tokenizer.convert_tokens_to_ids("<|listen|>")
per_unit, cur = [], []
for t in duplex.total_ids:
    if t == unit_end:
        per_unit.append(cur); cur = []
    else:
        cur.append(t)
embeds, labels, where = layout.assemble(duplex, *layout.heard_call(duplex, BRIEF, voice, question, len(per_unit)), per_unit)
assert torch.equal(embeds, layout.build(duplex, BRIEF, voice, question, per_unit)[0])

ok = True
n = min(len(live), len(embeds))
diff = (live[:n].float() - embeds[:n].float()).abs().max().item()
print(f"1. embeddings: live {len(live)}, rebuilt {len(embeds)}, max diff {diff:.2e}")
ok &= len(live) == len(embeds) and diff == 0

with torch.no_grad():
    pos = torch.arange(len(embeds), device=embeds.device)[None]
    out = model.llm(inputs_embeds=embeds[None].to(model.llm.dtype), position_ids=pos, output_hidden_states=True)
one = out.logits[0].float().cpu()
states = out.hidden_states[-1][0].float().cpu()
worst, agree = 0.0, 0
for p, lg in logits_at:
    worst = max(worst, (one[p] - lg).abs().max().item())
    agree += one[p].argmax().item() == lg.argmax().item()
print(f"2. logits at {len(logits_at)} decision points: argmax agree {agree}/{len(logits_at)}, max diff {worst:.3f}")
ok &= agree == len(logits_at) and worst < 1.0  # fp16 on MPS

targets = [labels[p].item() for p in range(len(labels)) if labels[p] != -100]
expected = [t for u in per_unit for t in u]
print(f"3. labels: {len(targets)} written tokens; match the session's: {targets == expected}")
ok &= targets == expected

# 4. What the talker reads each spoken second (MiniCPMODuplex.total_hidden: each written token after the unit's first,
#    up to its end mark, with the brain's state after feeding it), against the one pass at assemble's positions.
ends = set(duplex.chunk_terminator_token_ids)
ours = [[(u[i], where[k][i]) for i in range(1, len(u)) if u[i] not in ends] for k, u in enumerate(per_unit) if u[0] != ids_listen]
ours, theirs = [u for u in ours if u], spoken
same_tokens = [[t for t, _ in u] for u in ours] == [[t for t, _, _ in u] for u in theirs]
worst = max((states[p] - h[0, 0].float().cpu()).abs().max().item() for u, v in zip(ours, theirs) for (_, p), (_, h, _) in zip(u, v))
print(f"4. talker inputs: {sum(map(len, ours))} tokens in {len(ours)} spoken seconds, tokens match {same_tokens}, state max diff {worst:.3f}")
ok &= same_tokens and worst < 0.5
print("PARITY", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)

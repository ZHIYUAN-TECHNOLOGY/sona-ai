"""Live-format LoRA for MiniCPM-o's brain (docs/minicpm-o-finetune.md, live format), then a held-out live test.

Stage 1 learnt chat turns; box ④ runs the brain live, a second at a time, where it answered worse (2 Oct, Mac). This
trains it in the live layout itself (layout.py, proven against a real call by parity.py): each spoken question from
sft/hear_answer.json, heard a second at a time, then Sona's answer written a second at a time at her pace. Only the
brain's LoRA learns; the ear, eyes and voice stay as they are.

Then the held-out calls are run live (greedy, text only), with and without the new LoRA, so stage 1 and this run are
compared on the same questions: when she starts (seconds after the question ends), what she says, in which language.
Usage (Baseten, 1×H100): python train.py --brain DIR --data sft/hear_answer.json --voice sona_voice.wav --out DIR
"""
import argparse, json, math, random, re, shutil, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import librosa, numpy as np, torch
import torch.nn.functional as F
from peft import LoraConfig, get_peft_model
from transformers import AutoModel

import layout

p = argparse.ArgumentParser()
p.add_argument("--brain", required=True)
p.add_argument("--data", required=True)
p.add_argument("--voice", required=True)
p.add_argument("--out", required=True)
p.add_argument("--epochs", type=float, default=2)
p.add_argument("--lr", type=float, default=1e-4)
p.add_argument("--accum", type=int, default=8)
p.add_argument("--rank", type=int, default=16)
p.add_argument("--held", type=int, default=60)
p.add_argument("--limit", type=int, default=0, help="rows, for a smoke run")
p.add_argument("--relang", type=float, default=0.0, help="share of single-language questions whose brief names another\n               fallback language, the answer staying in the spoken one (sft/hear_answer_spoken.json)")
a = p.parse_args()
torch.manual_seed(0)
dev = "cuda" if torch.cuda.is_available() else "mps"
dtype = torch.bfloat16 if dev == "cuda" else torch.float16

# The whole model (eyes and voice included), so the saved result is complete; as_duplex's voice decoder is not needed.
model = AutoModel.from_pretrained(a.brain, trust_remote_code=True, attn_implementation="sdpa", torch_dtype=dtype,
                                  init_vision=True, init_audio=True, init_tts=True).eval().to(dev)
init_tts, model.init_tts = model.init_tts, lambda **_: None
duplex = model.as_duplex(generate_audio=False)
model.init_tts = init_tts
tok = duplex.tokenizer
voice = librosa.load(a.voice, sr=16_000)[0]

rows = json.loads(Path(a.data).read_text())
random.Random(0).shuffle(rows)
held, train = rows[: a.held], rows[a.held:]
if a.limit:
    held, train = held[: max(2, a.limit // 10)], train[: a.limit]
root = Path(a.data).parent
question = lambda r: librosa.load(str(root / r["audios"][0]), sr=16_000)[0]
# What each question was spoken in (en, ms, zh or mixed), from its transcript; with --relang a single-language one may be
# briefed with another fallback language, so the brain learns the spoken language wins (live1 followed the brief: 2 Oct).
spoken_file = root / "hear_answer_spoken.json"
SPOKEN = {k: v["spoken"] for k, v in json.loads(spoken_file.read_text()).items()} if spoken_file.exists() else {}
NAME = {"en": "English", "ms": "Malay", "zh": "Chinese"}


def brief(r, swap=False):
    b, lang = r["messages"][0]["content"], r["lang"]
    if swap and SPOKEN.get(r["audios"][0]) == lang:
        other = random.choice([n for k, n in NAME.items() if k != lang])
        b = b.replace(f"answer in {NAME[lang]}.", f"answer in {other}.")
    return b


relang = random.Random(3)
print(f"train {len(train)}, held out {len(held)}", flush=True)

# Only the brain's attention learns (the ear has its own q/k/v; wrapping model.llm keeps it out).
for prm in model.parameters():
    prm.requires_grad_(False)
model.llm = get_peft_model(model.llm, LoraConfig(r=a.rank, lora_alpha=2 * a.rank, lora_dropout=0.05,
                                                 target_modules=["q_proj", "k_proj", "v_proj", "o_proj"]))
lora = [prm for n, prm in model.llm.named_parameters() if "lora_" in n]
for prm in lora:
    prm.data = prm.data.float()
opt = torch.optim.AdamW(lora, lr=a.lr, weight_decay=0.0)
steps = math.ceil(len(train) * a.epochs / a.accum)
sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1, (s + 1) / 20) * 0.5 * (1 + math.cos(math.pi * min(s, steps) / steps)))


def loss_of(r):
    with torch.no_grad():
        x, y = layout.example(duplex, brief(r, relang.random() < a.relang), voice, question(r), r["messages"][2]["content"], r["lang"])
    pos = torch.arange(len(x), device=x.device)[None]
    with torch.autocast(dev, dtype=dtype):
        logits = model.llm(inputs_embeds=x[None].to(dtype), position_ids=pos).logits[0]
    return F.cross_entropy(logits.float(), y.to(logits.device), ignore_index=-100)


t0, run, n = time.time(), 0.0, 0
model.llm.train()
order = [train[i % len(train)] for i in range(math.ceil(len(train) * a.epochs))]
random.Random(1).shuffle(order)
for i, r in enumerate(order, 1):
    l = loss_of(r) / a.accum
    l.backward()
    run = 0.98 * run + 0.02 * l.item() * a.accum if n else l.item() * a.accum
    n += 1
    if i % a.accum == 0 or i == len(order):
        torch.nn.utils.clip_grad_norm_(lora, 1.0)
        opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
    if i % 100 == 0:
        print(f"example {i}/{len(order)} loss {run:.4f} ({time.time() - t0:.0f} s)", flush=True)
model.llm.eval()

# The held-out calls, live: stage 1 (LoRA off) and this run (LoRA on), same questions, greedy.
CJK = re.compile(r"[一-鿿]")
MALAY = re.compile(r"\b(anda|saya|sila|ubat|dengan|untuk|jika|tidak|boleh|makan|hari|ini|itu|yang|dan|ke|di)\b", re.I)


def language(text):
    return "zh" if len(CJK.findall(text)) > len(text) / 4 else "ms" if len(MALAY.findall(text)) >= 2 else "en"


def call(r, swap=False):
    q = question(r)
    model.reset_session()
    duplex.prepare(prefix_system_prompt=brief(r, swap), ref_audio=voice)
    audio, start = np.concatenate([q, np.zeros(30 * layout.UNIT, np.float32)]), None
    for k in range(len(audio) // layout.UNIT):
        duplex.streaming_prefill(audio_waveform=audio[k * layout.UNIT:(k + 1) * layout.UNIT])
        u = duplex.streaming_generate(prompt_wav_path=None, decode_mode="greedy")
        if not u["is_listen"] and start is None:
            start = k
        if u["end_of_turn"] or (start is not None and k - start > 25):
            break
    text = tok.decode(duplex.res_ids, skip_special_tokens=True).strip()
    end = float(layout.speech_end(q))
    return {"reply": text, "starts_after_s": None if start is None else round(start + 1 - end, 2), "language": language(text)}


results = []
with torch.no_grad():
    for r in held:
        with model.llm.disable_adapter():
            before = call(r)
        after = call(r)
        x = {"lang": r["lang"], "triage": r.get("triage"), "spoken": SPOKEN.get(r["audios"][0]), "reference": r["messages"][2]["content"], "stage1": before, "live1": after}
        if x["spoken"] == r["lang"]:  # the brief names another fallback language: the reply should still be in the spoken one
            with model.llm.disable_adapter():
                x["stage1_swapped"] = call(r, swap=True)
            x["live1_swapped"] = call(r, swap=True)
        results.append(x)
        print(json.dumps(results[-1], ensure_ascii=False), flush=True)


def summary(name):
    rs = [x[name] for x in results]
    starts = [x["starts_after_s"] for x in rs if x["starts_after_s"] is not None]
    return {"answered": f"{len(starts)}/{len(rs)}", "spoke_over_patient": int(sum(s < 0 for s in starts)),
            "median_start_s": float(np.median(starts)) if starts else None,
            "right_language": f"{sum(x[name]['language'] == x['lang'] for x in results)}/{len(rs)}",
            "urgent_999": f"{sum('999' in x[name]['reply'] for x in results if x['triage'] == 'urgent')}/{sum(x['triage'] == 'urgent' for x in results)}"}


swapped = [x for x in results if "live1_swapped" in x]
report = {"stage1": summary("stage1"), "live1": summary("live1"),
          "spoken_language_wins": {k: f"{sum(x[k + '_swapped']['language'] == x['lang'] for x in swapped)}/{len(swapped)}" for k in ("stage1", "live1")}}
print("summary", json.dumps(report), flush=True)

# Save: the LoRA merged into the brain, the rest of the model as it was, and the files the model needs beside it.
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
for prm in lora:  # back to the brain's precision, so the merge adds like to like
    prm.data = prm.data.to(dtype)
model.llm = model.llm.merge_and_unload()
model.save_pretrained(out, safe_serialization=True)
for f in Path(a.brain).iterdir():
    if f.is_file() and not f.name.endswith(".safetensors") and f.name != "model.safetensors.index.json" and not (out / f.name).exists():
        shutil.copy(f, out / f.name)
if (Path(a.brain) / "assets").exists() and not (out / "assets").exists():
    shutil.copytree(Path(a.brain) / "assets", out / "assets")
(out / "live_eval.json").write_text(json.dumps({"summary": report, "calls": results}, ensure_ascii=False, indent=1))
print("saved", out, flush=True)

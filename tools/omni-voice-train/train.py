"""Full fine-tune of MiniCPM-o 4.5's talker (model.tts) on Sona's voice; the LLM, ear, flow and vocoder stay frozen.

Each clip is (text, audio). The frozen LLM reads "Read this aloud exactly: <text>" with Sona's voice prompt and writes the
text teacher-forced (talker.reply_hidden); the audio's S3 tokens are the targets. Steps alternate the chat layout and
the live duplex layout (talker.py; parity.py proves both match the model's own generation). Languages are sampled
evenly so Malay is learnt without English and Mandarin drifting.

Usage:
  python train.py --data hf:zhiyuantechnology/sona-minicpmo-data:voice --device cuda --dtype bf16 --out /ckpt   (Baseten)
  python train.py --data kore-ms20.jsonl --device mps --steps 300 --out /tmp/talker                                (Mac)
A local --data is JSONL rows {text, audio: wav path, lang?}. Saves talker.safetensors (model.tts weights) in --out.
"""
import argparse, json, math, random, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import numpy as np, torch
from safetensors.torch import save_file

import talker

p = argparse.ArgumentParser()
p.add_argument("--data", required=True)
p.add_argument("--out", required=True)
p.add_argument("--repo", default=None, help="local MiniCPM-o snapshot (Baseten mounts it); default: HF cache")
p.add_argument("--voice", default=None, help="Sona voice prompt wav; default: the dataset's first English clip")
p.add_argument("--device", default="cuda")
p.add_argument("--dtype", default="bf16", choices=["bf16", "fp16"])
p.add_argument("--steps", type=int, default=6000)
p.add_argument("--lr", type=float, default=3e-5)
p.add_argument("--duplex", type=float, default=0.5, help="share of steps in the live duplex layout")
p.add_argument("--limit", type=int, default=0)
p.add_argument("--save-every", type=int, default=2000)
p.add_argument("--layout", default="chat", choices=["chat", "live"],
               help="live: the brain's states come from a live call (tools/omni-live-train/layout.py), as box ④ feeds the talker")
p.add_argument("--contexts", default=None, help="live: spoken questions to set each call in (sft/hear_answer.json, audio beside it)")
p.add_argument("--init", default=None, help="talker.safetensors to start from (e.g. voice-v1); default: the model's own talker")
a = p.parse_args()
dtype = {"bf16": torch.bfloat16, "fp16": torch.float16}[a.dtype]
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
torch.manual_seed(0); random.seed(0)


def rows():
    """(text, lang, audio 16 kHz float32) per clip."""
    import librosa, soundfile as sf
    if a.data.startswith("hf:"):
        from datasets import Audio, load_dataset
        repo, config = a.data[3:].split(":")
        d = load_dataset(repo, config, split="train").cast_column("audio", Audio(sampling_rate=16000))
        for r in d.select(range(min(len(d), a.limit))) if a.limit else d:
            yield r["text"], r.get("lang") or "?", np.asarray(r["audio"]["array"], dtype=np.float32)
    else:
        for i, line in enumerate(Path(a.data).read_text().splitlines()):
            if a.limit and i >= a.limit: break
            r = json.loads(line)
            x, sr = sf.read(r["audio"], dtype="float32")
            x = x.mean(1) if x.ndim > 1 else x
            yield r["text"], r.get("lang") or "?", librosa.resample(x, orig_sr=sr, target_sr=16000) if sr != 16000 else x


model, tokenizer, repo = talker.load(a.device, dtype, a.repo)
tts = model.tts
if a.init:
    from safetensors.torch import load_file
    tts.load_state_dict(load_file(a.init), strict=True)
    print("talker from", a.init, flush=True)
import s3tokenizer
s3 = s3tokenizer.load_model(f"{repo}/assets/token2wav/speech_tokenizer_v2_25hz.onnx").to(a.device).eval()


@torch.inference_mode()
def speech_tokens(x16):
    """S3 tokens of 16 kHz audio, as t2w.Token2wav.tokens makes them, on the training device."""
    mels, lens = s3tokenizer.padding([s3tokenizer.log_mel_spectrogram(torch.from_numpy(x16))])
    t, tl = s3.quantize(mels.to(a.device), lens.to(a.device))
    return t[0, : int(tl[0])].long()


if a.layout == "live":
    sys.path[:0] = [str(Path(__file__).parent.parent / "omni-live-train"), str(Path(__file__).parent)]  # repo, or the job's flat code/
    import layout
    from layout import assemble, heard_call, speech_end

    model.init_tts, init_tts = (lambda **_: None), model.init_tts  # as_duplex() would load the voice decoder: not needed
    duplex = model.as_duplex(generate_audio=False)
    model.init_tts = init_tts
    tid = tokenizer.convert_tokens_to_ids
    LISTEN, SPEAK, CHUNK_EOS, TURN_EOS = map(tid, ["<|listen|>", "<|speak|>", "<|chunk_eos|>", "<|turn_eos|>"])
    LONGEST = 25  # spoken seconds a call holds; longer clips are skipped

    def live_calls(voice, n=64):
        """Calls to set clips in: a patient's spoken question with its brief, heard once (heard_call), then quiet."""
        import librosa
        rows_ = json.loads(Path(a.contexts).read_text())
        out = []
        for r in random.Random(2).sample(rows_, min(n, len(rows_))):
            q = librosa.load(str(Path(a.contexts).parent / r["audios"][0]), sr=16000)[0]
            first = max(0, math.ceil(speech_end(q) + layout.SPEAK_AFTER_S) - 1)
            out.append((first, r["messages"][0]["content"], *heard_call(duplex, r["messages"][0]["content"], voice, q, first + LONGEST + 1)))
        # The reference clip's embeddings, cut out of the first call's system part, for system_for (checked equal there).
        global REF
        first, brief, system, _ = out[0]
        pre = len(tokenizer.encode(PRE.format(brief), add_special_tokens=False))
        REF = system[pre: len(system) - len(SUF)]
        assert torch.equal(system_for(brief), system), "system_for differs from prepare()"
        return out

    # prepare()'s system part with the reference clip (MiniCPMODuplex.prepare): the brief's tokens, the clip, the end.
    PRE, SUF, REF = "<|im_start|>system\n{}\n<|audio_start|>", tokenizer.encode("<|audio_end|><|im_end|>", add_special_tokens=False), None

    def system_for(brief):
        pre = tokenizer.encode(PRE.format(brief), add_special_tokens=False)
        return torch.cat([duplex.decoder.embed_tokens(pre), REF, duplex.decoder.embed_tokens(SUF)]).detach()

    @torch.no_grad()  # not inference_mode: these tensors feed the talker's training (autograd refuses inference tensors)
    def live_units(call, ids, codes, text_):
        """The clip as box ④ speaks it: the brain writes its text a second at a time, a second per 25 codes, then a
        <|turn_eos|> second that says the rest and ends; the talker reads each written token with the brain's state
        after it (layout.assemble's positions, as MiniCPMODuplex hands them to generate_chunk). The brief tells the brain
        the words: in a real call it writes its own answer, sure of it; forced to write a stranger's words its states are
        unsure (2 Oct: 4-6 nats a token against 0.8-4 told), and voice v2's first run learnt from those and got worse."""
        first, brief, _, heard = call
        system = system_for(f"{brief}\nYour next answer, word for word: {text_}")
        n = max(1, len(codes) // talker.CODES_PER_UNIT)
        ends = [math.ceil((k + 1) * len(ids) / n) for k in range(n)]
        text = [ids[s:e].tolist() for s, e in zip([0, *ends[:-1]], ends)]
        writes = [[LISTEN]] * first + [[SPEAK, *t, CHUNK_EOS] for t in text] + [[SPEAK, TURN_EOS, CHUNK_EOS]]
        x, _, where = assemble(duplex, system, heard[: len(writes)], writes)
        pos = torch.arange(len(x), device=x.device)[None]
        states = model.llm(inputs_embeds=x[None].to(model.llm.dtype), position_ids=pos, output_hidden_states=True).hidden_states[-1][0]
        units = []
        for k, w in enumerate(writes[first:]):
            keep = [i for i in range(1, len(w)) if w[i] != CHUNK_EOS]  # after the unit's <|speak|>, up to its end mark
            unit_ids = torch.tensor([w[i] for i in keep], dtype=torch.long, device=x.device)
            last = k == len(writes) - first - 1
            c = codes[k * talker.CODES_PER_UNIT:] if last else codes[k * talker.CODES_PER_UNIT:(k + 1) * talker.CODES_PER_UNIT]
            units.append((unit_ids, states[[where[first + k][i] for i in keep]].to(dtype).clone(), c.clone(), last))
        return units


# Prepare once: the LLM's view of each text and the speech tokens of its audio (everything frozen here).
data, voice, calls = [], None, None
t0 = time.time()
for text, lang, x in rows():
    if voice is None and (a.voice or lang in ("en", "?")):
        import librosa
        voice = librosa.load(a.voice, sr=16000)[0] if a.voice else x
    if a.layout == "live":
        calls = calls or live_calls(voice, n=4 if a.limit else 64)
        codes = speech_tokens(x)
        ids = tokenizer.encode(text, add_special_tokens=False, return_tensors="pt")[0]
        if len(codes) < 30 or len(codes) > LONGEST * talker.CODES_PER_UNIT:
            continue
        data.append({"lang": lang, "units": live_units(random.choice(calls), ids, codes, text)})
        continue
    msgs = [{"role": "system", "content": ["Clone the voice in the provided audio prompt.", voice,
                                           "Read the user's text aloud exactly as written, word for word, keeping its language. Say nothing else."]},
            {"role": "user", "content": [f"Read this aloud exactly: {text}"]}]
    ids, hidden = talker.reply_hidden(model, msgs, text)
    # clones made here, outside inference mode, so autograd may use them
    data.append({"lang": lang, "ids": ids.clone(), "hidden": hidden.to(dtype).clone(), "codes": speech_tokens(x).clone()})
print(f"prepared {len(data)} clips in {time.time() - t0:.0f} s", flush=True)
s3 = None

random.shuffle(data)
held = data[: max(1, len(data) // 50)] if len(data) >= 50 else []
train = data[len(held):]
by_lang = {}
for d in train:
    by_lang.setdefault(d["lang"], []).append(d)
langs = sorted(by_lang)
print("train clips by language:", {k: len(v) for k, v in by_lang.items()}, "held out:", len(held), flush=True)

# Only the talker learns; it trains in fp32 (autocast bf16 on CUDA), the LLM keeps its precision.
for prm in model.parameters():
    prm.requires_grad_(False)
tts.float().train()
for prm in tts.parameters():
    prm.requires_grad_(True)
opt = torch.optim.AdamW([p_ for p_ in tts.parameters() if p_.requires_grad], lr=a.lr, weight_decay=0.01)
warm = max(1, min(200, a.steps // 10))
sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1, (s + 1) / warm) * 0.5 * (1 + math.cos(math.pi * min(s, a.steps) / a.steps)))
autocast = torch.autocast("cuda", dtype=torch.bfloat16) if a.device == "cuda" else torch.autocast("cpu", enabled=False)


def inputs(d, duplex):
    if "units" in d:  # --layout live: every step is a live turn, as box ④ speaks it
        return talker.duplex_inputs(tts, d["units"])
    if not duplex:
        return talker.chat_inputs(tts, d["ids"], d["hidden"], d["codes"])
    spans = talker.units_of(len(d["ids"]), len(d["codes"]))
    return talker.duplex_inputs(tts, talker.duplex_units([(d["ids"][s:e], d["hidden"][s:e]) for s, e in spans], d["codes"]))


def evaluate():
    if not held: return float("nan")
    tts.eval()
    with torch.no_grad(), autocast:
        v = sum(talker.loss(tts, *inputs(d, k % 2 == 1)).item() for k, d in enumerate(held)) / len(held)
    tts.train()
    return v


def save(tag):
    sd = {k: v.detach().to(torch.float16 if a.dtype == "fp16" else torch.bfloat16).contiguous() for k, v in tts.state_dict().items()}
    save_file(sd, str(out / f"talker{tag}.safetensors"))


print(f"step 0 held-out loss {evaluate():.4f}", flush=True)
run, t0 = 0.0, time.time()
for step in range(1, a.steps + 1):
    d = random.choice(by_lang[random.choice(langs)])  # languages evenly, whatever their clip counts
    with autocast:
        l = talker.loss(tts, *inputs(d, random.random() < a.duplex))
    l.backward()
    torch.nn.utils.clip_grad_norm_(tts.parameters(), 1.0)
    opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
    run = 0.98 * run + 0.02 * l.item() if step > 1 else l.item()
    if step % 20 == 0:
        print(f"step {step} loss {run:.4f} lr {sched.get_last_lr()[0]:.2e} {time.time() - t0:.0f} s", flush=True)
    if step % a.save_every == 0 or step == a.steps:
        print(f"step {step} held-out loss {evaluate():.4f}", flush=True)
        save("" if step == a.steps else f"-{step}")
print("saved", out / "talker.safetensors")

"""Box ④ Live: Sona's MiniCPM-o 4.5 in full-duplex mode, one call per replica (docs/minicpm-o-plan.md#architecture).

The model hears the patient one second at a time and, every second, either listens or speaks up to 20 tokens of text
with about a second of Sona's voice (her trained talker from tools/omni-voice-train; timbre from her reference clip).

WebSocket /v1/live, one call per connection:
  in   1. JSON {"type": "start", "system": str, optional "listen_prob_scale", "temperature", "force_listen",
          "max_speak_tokens" (tokens a unit, the brain's pace), "voice" ("v1", Sona's trained talker, or "base"),
          "turn_silence_ms" (QUIET below: her turn starts that soon after the patient stops)}
       2. binary frames: the patient's audio, 16 kHz mono PCM16 little-endian, any length
          JSON {"type": "hold", "on": bool}: from now she only listens (a "say" is still said), or is free again
       3. JSON {"type": "stop"}, or just close
  out  JSON {"type": "ready"} once the call is set up; then for each second heard
       JSON {"type": "unit", "i", "listen", "text", "end_of_turn", "ms" (model time), "cost" (ms by part: brain, talker,
       voice), "behind" (seconds queued), "scripted" (true when the second's words were a "say", not her own)}, followed, when Sona speaks, by one binary frame: 24 kHz mono PCM16
       little-endian. On two GPUs (VOICE_GPU below) her voice for a second comes when it is made, after a JSON
       {"type": "voice", "i", "ms"}, and the next second's unit may come before it.
Off CUDA (a Mac, for tests) the voice decoder cannot run, so the box answers in text only.
"""
import asyncio
import contextlib
from concurrent.futures import Future, ThreadPoolExecutor
import json
import os
import time

import librosa
import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, Response, WebSocket, WebSocketDisconnect

MODEL = os.environ.get("MODEL", "/app/models/live")
TALKER = os.environ.get("TALKER", "/app/models/voice/talker.safetensors")
# Sona's reference clip, the one her talker trained with (tools/omni-voice-train/run.sh); kept out of git, like the data
VOICE = os.environ.get("VOICE") or __import__("huggingface_hub").hf_hub_download(
    "zhiyuantechnology/sona-minicpmo-data", "code/sona_voice.wav", repo_type="dataset",
    token=open("/secrets/hf_access_token").read().strip())
DEVICE = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
AUDIO = DEVICE == "cuda"  # stepaudio2's Token2wav is CUDA only
UNIT = 16_000  # one second at 16 kHz (chunk_ms 1000; the model pads the first unit to 1035 ms itself)
MAX_SPEAK = int(os.environ.get("MAX_SPEAK", 20))  # the model's own default; a call's start may set max_speak_tokens
talkers: dict = {}  # "base" (the model's own voice) and "v1" (Sona's trained talker), each a state dict on the GPU
# One-ear test: with "transcribe" in a call's start, each patient turn is also written down by this same model, the ear's
# training task (tools/omni-train/eval.py), and sent as a "heard" event; box ② keeps transcribing beside it to compare.
TRANSCRIBE = "Write down exactly what was said."
TURN_MAX = 30 * UNIT  # the last 30 s of a turn at most
# QUIET: the model hears in whole seconds, and takes its turn after a second of silence: the second the patient stopped
# in has to end, then a silent one, so her first words wait 1-2 s for audio alone (4 Oct: 1.4 s of 2.7). With
# "turn_silence_ms" in a call's start, once the patient has spoken and then been quiet that long, a judge of turns
# (TURN: Smart Turn v3.2 fine-tuned on our languages, tools/turn-train; 14 ms on a CPU) hears the last 8 s:
#   finished      the second they stopped in is filled with silence and a silent second follows, both at once, so she
#                 hears the pause without waiting for it;
#   not finished  she is kept listening (the patient is thinking) until they speak and pause again, or have been quiet
#                 for WAIT_S, when she may take the turn as she would have.
# From the patient's first word to that verdict she only listens, so she no longer starts over a pause by herself.
# Without the judge every pause counts as finished: on the H100 (4 Oct) that brought first sound from 2.9 s to 1.8 s
# on a question said in one breath, but she took every pause for the end ("Hi Sona." then her greeting over the
# question), which is why the judge is here. ponytail: loudness alone tells speech from quiet (a noisy room never goes
# quiet, and the call then works as before; her own voice from a loudspeaker would count as the patient's).
# Measured (4 Oct, H100, from Malaysia): "Hi Sona." and its pause no longer start her; a question said through to its end
# got first sound at 2.3 s (300 ms) and 2.8 s (500 ms) against 3.0 s. The judge on 15 real recorded voices: cut
# mid-sentence heard as not finished 15 of 15, whole heard as finished 12 of 15 (as published: 2 and 13). A whole
# question heard as not finished costs the wait below; on three questions read by a computer voice it misjudged four
# pauses of seven, so real calls decide whether this goes on by default.
TURN = os.environ.get("TURN", "/app/models/turn/sona-turn.onnx")
WAIT_S = 1.5  # near what she waits by herself (a silent second after the one the patient stopped in)
LOUD = 0.01  # RMS of a frame, about -40 dBFS
# Two GPUs (packages/infra/aws/live: no GPU in Malaysia holds the whole model; on one 24 GB L4 it ran out of memory
# setting up her voice, 4 Oct). VOICE_GPU=1 puts her voice on that GPU: the talker, the voice decoder (Token2wav: flow,
# HiFT and their caches) and the spare talker copies, about 7 GB. The brain and ear stay on GPU 0, everything at full
# precision. Her voice then also works in its own thread while the brain goes on to the next second (sound() below).
# Unset, everything is on one GPU and in one line, as before.
VOICE_GPU = os.environ.get("VOICE_GPU")
THERE = f"cuda:{VOICE_GPU}" if VOICE_GPU else None


def vocoder_on(gpu: int):
    """stepaudio2's Token2wav places everything with .cuda() and device='cuda', the current GPU: each of its calls runs
    with `gpu` as the current one. The model code imports the class when it loads the decoder, so it gets this one."""
    import stepaudio2

    def there(method):
        def call(self, *a, **k):
            with torch.cuda.device(gpu):
                return method(self, *a, **k)
        return call

    names = ("__init__", "__call__", "_prepare_prompt", "set_stream_cache", "stream")
    stepaudio2.Token2wav = type("Token2wav", (stepaudio2.Token2wav,), {n: there(getattr(stepaudio2.Token2wav, n)) for n in names})


def load():
    from transformers import AutoModel

    if VOICE_GPU:
        vocoder_on(int(VOICE_GPU))
    model = AutoModel.from_pretrained(MODEL, trust_remote_code=True, attn_implementation="sdpa", init_vision=False,
                                      torch_dtype=torch.bfloat16 if AUDIO else torch.float16).eval().to(DEVICE)
    if THERE:
        model.tts.to(THERE)
    # Both voices stay loaded, so a call can pick one ("voice" in its start): Sona's trained talker, or the model's own.
    talkers["base"] = {k: v.detach().clone() for k, v in model.tts.state_dict().items()}
    if os.path.exists(TALKER):
        from safetensors.torch import load_file

        talkers["v1"] = load_file(TALKER, device=str(next(model.tts.parameters()).device))
        model.tts.load_state_dict(talkers["v1"], strict=True)
        print("talker:", TALKER, flush=True)
    if not AUDIO:
        model.init_tts = lambda **_: None  # as_duplex() calls it; nothing to load without the voice decoder
    # basic window: past 8000 tokens the oldest seconds drop and the system prompt (Sona's brief, the plan) stays
    return model.as_duplex(generate_audio=AUDIO, sliding_window_mode="basic")


duplex = load()
judge = None
if os.path.exists(TURN):
    import onnxruntime
    from transformers import WhisperFeatureExtractor

    judge, mel = onnxruntime.InferenceSession(TURN, providers=["CPUExecutionProvider"]), WhisperFeatureExtractor(chunk_length=8)
    print("turn judge:", TURN, flush=True)


def finished(audio: np.ndarray) -> float:
    """The judge's probability that the speaker of these last seconds is done (Smart Turn's inference.py)."""
    audio = audio[-8 * UNIT:] if len(audio) > 8 * UNIT else np.pad(audio, (8 * UNIT - len(audio), 0))
    x = mel(audio, sampling_rate=UNIT, return_tensors="np", padding="max_length", max_length=8 * UNIT, truncation=True, do_normalize=True)
    return float(judge.run(None, {"input_features": x.input_features.astype(np.float32)})[0].item())

# Her voice in its own thread (two GPUs only). On an L4 a spoken second took 1.25 s: the brain 0.44 s, the talker
# 0.44 s, the voice decoder 0.23 s, one after the other, so she fell behind her own voice (4 Oct). Here the brain's
# second ends when its words are written, and the talker and decoder make that second's voice on the other GPU while
# the brain hears the next: a second costs the slower of the two, not their sum. One thread, so her voice's seconds
# stay in order.
voicing = ThreadPoolExecutor(1)


def sound(hidden: list, end_of_turn: bool, now: int):
    """One spoken second's voice from the brain's states for it: the end of the model's streaming_generate (its "TTS
    generate" and token2wav steps, modeling_minicpmo.py), with the states moved to the talker's GPU."""
    t, d, tts = time.time(), duplex, duplex.model.tts
    there = tts.emb_text.weight.device
    bos = tts.emb_text(torch.tensor([tts.audio_bos_token_id], device=there, dtype=torch.long))
    if hidden:
        states = torch.nn.functional.normalize(tts.projector_semantic(torch.cat([h[1].squeeze(0) for h in hidden], dim=0).to(there)), p=2, dim=-1)
        bos = torch.cat([tts.emb_text(torch.tensor([h[0] for h in hidden], device=there, dtype=torch.long)) + states, bos], dim=0)
    condition, first = bos.unsqueeze(0), d.tts_text_start_pos == 0  # a turn's first second may be under a second of audio
    if d.tts_current_turn_start_time is None:
        d.tts_current_turn_start_time = now
    tokens, kv = tts.generate_chunk(
        inputs_embeds=condition, temperature=d.tts_temperature, repetition_penalty=d.tts_repetition_penalty,
        eos_token=d.tts_eos_token, force_no_stop=False, max_new_token=26, min_new_tokens=0 if end_of_turn or first else 26,
        past_key_values=d.tts_past_key_values, logits_processors=d.tts_logits_processors, text_start_pos=d.tts_text_start_pos)
    if end_of_turn:
        d.tts_text_start_pos, d.tts_past_key_values, d.tts_current_turn_start_time = 0, None, None
    else:
        d.tts_past_key_values, d.tts_text_start_pos = kv, d.tts_text_start_pos + condition.shape[1] + tokens.shape[1]
    wave = d._generate_waveform_from_tokens(tokens, VOICE, end_of_turn, force_flush=first)
    if end_of_turn:
        d._reset_token2wav_for_new_turn()
    return wave, round((time.time() - t) * 1000)


def generate(**opts) -> tuple[dict, object]:
    """One second: what the brain decided, and her voice for it (on two GPUs a Future of (samples, ms))."""
    if not THERE:
        r = duplex.streaming_generate(prompt_wav_path=VOICE, **opts)
        return r, r.get("audio_waveform")
    duplex.generate_audio = False  # the model's second then ends at the brain's words
    try:
        r = duplex.streaming_generate(prompt_wav_path=VOICE, **opts)
    finally:
        duplex.generate_audio = True
    return r, None if r["is_listen"] else voicing.submit(sound, list(duplex.total_hidden[-1]), r["end_of_turn"], r["current_time"])


def prepare(**kw):
    """duplex.prepare with the brief fed in one pass. The model's own feeds the system prompt a token at a time (one
    forward each, ~35 ms): a patient's plan in the brief took 15 s, and the call's first seconds queued behind it
    (3 Oct: first words 12 s after the question). What it feeds is held and goes in together before the cache length is
    read; attention is causal, so the cache is the same."""
    d, held = duplex.decoder, []

    def flush():
        if held:
            feed(torch.cat(held, dim=0))
            held.clear()

    def hold(embeds, return_logits=False):
        assert not return_logits
        held.append(embeds)

    def then(register):
        return lambda *a, **k: (flush(), register(*a, **k))[1]

    feed, names = d.feed, ("register_system_prompt", "register_system_prompt_with_context")
    d.feed = hold
    for name in names:
        setattr(d, name, then(getattr(d, name)))
    try:
        return duplex.prepare(**kw)
    finally:
        flush()
        for name in ("feed", *names):
            delattr(d, name)
voice = librosa.load(VOICE, sr=16_000, mono=True)[0]
busy = asyncio.Lock()


def warm():
    """One call before /health answers: a box's first spoken second took 28.7 s (2 Oct, CUDA's first kernels in the
    voice), so the first patient after a cold start would wait that long. The call hears Sona's reference clip, then
    quiet, and she answers it; nothing is sent anywhere."""
    duplex.model.reset_session(reset_token2wav_cache=True)
    duplex.prepare(prefix_system_prompt="Streaming Omni Conversation.", ref_audio=voice, prompt_wav_path=VOICE if AUDIO else None)
    audio, t, spoke = np.concatenate([voice, np.zeros(8 * UNIT, np.float32)]), time.time(), 0
    for k in range(len(audio) // UNIT):
        duplex.streaming_prefill(audio_waveform=audio[k * UNIT:(k + 1) * UNIT])
        r, said = generate()
        if isinstance(said, Future):
            said.result()
        spoke += not r["is_listen"]
        if r["end_of_turn"]:
            break
    duplex._reset_streaming_state()
    duplex.decoder.reset()
    print(f"warm: {spoke} seconds spoken in {time.time() - t:.1f} s", flush=True)


warm()
app = FastAPI()


@app.get("/health")
def health():
    return Response(status_code=200)


def transcribe(audio: np.ndarray) -> dict:
    """The patient's turn in words, by the live model itself. A plain chat call writes none of the live session's caches
    (only the streaming calls and reset_session do, in modeling_minicpmo.py), and greedy decoding draws no random
    numbers, so the call carries on as if it had not run."""
    t = time.time()
    text = duplex.model.chat(msgs=[{"role": "user", "content": [audio, TRANSCRIBE]}], tokenizer=duplex.tokenizer,
                             do_sample=False, max_new_tokens=200)
    return {"type": "heard", "text": text.strip(), "seconds": round(len(audio) / UNIT, 1), "ms": round((time.time() - t) * 1000)}


def script(text: str, rate: int) -> list[list[int]]:
    """Words for Sona to say as written (a "say" message: an answer another model wrote), in the live layout the brain
    was trained in (tools/omni-live-train/layout.py): each second <|speak|>, `rate` text tokens, <|chunk_eos|>; then a
    second that ends the turn."""
    ids = duplex.tokenizer.encode(text, add_special_tokens=False)
    units = [[duplex.speak_token_id, *ids[i:i + rate], duplex.chunk_eos_token_id] for i in range(0, len(ids), rate)]
    return units + [[duplex.speak_token_id, duplex.turn_eos_token_id, duplex.chunk_eos_token_id]]


def pcm(wave) -> bytes | None:
    if wave is None or not len(wave):
        return None
    wave = wave.float().cpu().numpy() if isinstance(wave, torch.Tensor) else np.asarray(wave, dtype=np.float32)
    return (np.clip(wave.reshape(-1), -1, 1) * 32767).astype("<i2").tobytes()


def step(audio: np.ndarray, opts: dict, call: dict) -> tuple[dict, bytes | Future | None]:
    t, scripted = time.time(), bool(call.get("script"))
    duplex.streaming_prefill(audio_waveform=audio)
    if scripted:  # this second's tokens are given, not chosen: the brain's states still drive her voice
        forced = iter(call["script"].pop(0))
        choose, duplex.decoder.decode, duplex.force_listen_count = duplex.decoder.decode, lambda **_: torch.tensor(
            [next(forced)], dtype=torch.long, device=duplex.device), 0
        try:
            r, wave = generate(**{**opts, "max_new_speak_tokens_per_chunk": 64})
        finally:
            duplex.decoder.decode = choose
        if not call["script"] and call.get("release"):
            call["hold"] = False
    else:
        # "hold" in a call's start: she only listens until told what to say (her own answers are not wanted)
        duplex.force_listen_count = 10 ** 9 if call.get("hold") or call.get("wait") else call.get("force_listen", 0)
        r, wave = generate(**opts)
    # On two GPUs her voice for this second is still being made: the caller sends it when it is done.
    speech = None if r["is_listen"] else wave if isinstance(wave, Future) else pcm(wave)
    # The new part of everything said this call: one second's own decode splits words at the edge ("up" + " sets"),
    # and a character cut mid-byte waits for the next second.
    said = duplex.tokenizer.decode(duplex.res_ids, skip_special_tokens=True).rstrip("�")
    text = said[len(call["said"]):] if said.startswith(call["said"]) else said
    call["said"], call["speaking"] = said, not r["is_listen"]
    return {"type": "unit", "i": r["current_time"], "listen": r["is_listen"], "text": text,
            "end_of_turn": r["end_of_turn"], "ms": round((time.time() - t) * 1000), "scripted": scripted,
            "cost": {k[5:]: round(r[k] * 1000) for k in ("cost_llm", "cost_tts", "cost_token2wav") if r.get(k)}}, speech


@app.websocket("/v1/live")
async def live(ws: WebSocket):
    await ws.accept()
    if busy.locked():  # one call per replica; Baseten's concurrency target sends the next call to another
        await ws.close(code=1013, reason="busy")
        return
    async with busy:
        units: asyncio.Queue = asyncio.Queue()
        speaker = voice_out = None
        voices: asyncio.Queue = asyncio.Queue()  # on two GPUs: each spoken second's voice, to send in order
        call = {"said": "", "transcribe": False, "turn": []}
        try:
            start = json.loads(await ws.receive_text())
            opts = {k: float(start[k]) for k in ("listen_prob_scale", "temperature") if k in start}
            # Words a second the brain may write: her voice speaks about a second a unit and drops what is unsaid at
            # the end of the turn, so a brain writing ahead of it is cut off (2 Oct, stage 1: up to 16 tokens a unit).
            # The unit's <|speak|> and its forced <|chunk_eos|> count too, so 6 allows 4 words.
            opts["max_new_speak_tokens_per_chunk"] = int(start.get("max_speak_tokens", MAX_SPEAK))
            call["force_listen"], call["hold"] = int(start.get("force_listen", 0)), bool(start.get("hold"))
            voice_name = start.get("voice") if start.get("voice") in talkers else "v1" if "v1" in talkers else "base"
            duplex.model.tts.load_state_dict(talkers[voice_name], strict=True)
            # prepare() leaves the ear's streaming cache (audio_past_key_values) from the last call; reset_session clears it,
            # as OpenBMB's demo does between calls (tools/omni-live-train/layout.py builds training calls the same way).
            duplex.model.reset_session(reset_token2wav_cache=True)
            await asyncio.to_thread(prepare, prefix_system_prompt=start.get("system") or "Streaming Omni Conversation.",
                                    ref_audio=voice, prompt_wav_path=VOICE if AUDIO else None)
            await ws.send_text(json.dumps({"type": "ready", "audio": AUDIO, "voice": voice_name}))

            call["transcribe"] = bool(start.get("transcribe"))
            if "seed" in start:  # same seed, same replies: how the one-ear test shows its side job changes nothing
                torch.manual_seed(int(start["seed"]))

            async def speak():  # one second at a time, in order, while the socket keeps reading
                while (audio := await units.get()) is not None:
                    if isinstance(audio, tuple):  # held to listening, and the patient has finished: their turn in words
                        await ws.send_text(json.dumps(await asyncio.to_thread(transcribe, audio[1]), ensure_ascii=False))
                        continue
                    unit, speech = await asyncio.to_thread(step, audio, opts, call)
                    unit["behind"] = units.qsize()
                    await ws.send_text(json.dumps(unit, ensure_ascii=False))
                    if isinstance(speech, Future):
                        voices.put_nowait((unit["i"], speech))
                    elif speech:
                        await ws.send_bytes(speech)
                    if not call["transcribe"] or call["hold"]:
                        continue
                    # The seconds it listened to are the patient's turn; once it starts to speak, the turn is written down.
                    if unit["listen"]:
                        call["turn"].append(audio)
                    elif call["turn"]:
                        turn, call["turn"] = np.concatenate(call["turn"])[-TURN_MAX:], []
                        await ws.send_text(json.dumps(await asyncio.to_thread(transcribe, turn), ensure_ascii=False))

            async def voice_later():
                while (item := await voices.get()) is not None:
                    wave, ms = await asyncio.wrap_future(item[1])
                    if speech := pcm(wave):
                        await ws.send_text(json.dumps({"type": "voice", "i": item[0], "ms": ms}))
                        await ws.send_bytes(speech)

            speaker, voice_out = asyncio.create_task(speak()), asyncio.create_task(voice_later())
            heard = np.zeros(0, dtype=np.float32)
            quiet, spoke, still, recent = int(start.get("turn_silence_ms", 0)) * UNIT // 1000, False, 0, np.zeros(0, dtype=np.float32)
            # Held to listening (another model answers) with "transcribe": she never starts an answer, which is when
            # she writes a turn down, so the turn is written down when the judge hears it finish (or WAIT_S of quiet).
            ear, turn = call["hold"] and call["transcribe"], np.zeros(0, dtype=np.float32)

            def heard_turn():
                nonlocal turn
                if len(turn) > UNIT // 2:
                    units.put_nowait(("heard", turn[-TURN_MAX:]))
                turn = turn[:0]
            while True:
                m = await ws.receive()
                note = json.loads(m["text"]) if m.get("text") else {}
                if m["type"] == "websocket.disconnect" or note.get("type") == "stop":
                    break
                if note.get("type") == "hold":  # another model has this turn: she waits for its words (or is free again)
                    call["hold"] = bool(note.get("on"))
                if note.get("type") == "say":  # from the next second on; "release" lets her answer by herself after it
                    call["script"], call["release"] = script(note["text"], int(note.get("rate", 4))), bool(note.get("release"))
                if m.get("bytes"):
                    frame = np.frombuffer(m["bytes"], "<i2").astype(np.float32) / 32768
                    heard = np.concatenate([heard, frame])
                    while len(heard) >= UNIT:
                        units.put_nowait(heard[:UNIT])
                        heard = heard[UNIT:]
                    if quiet and len(frame):
                        recent = np.concatenate([recent, frame])[-8 * UNIT:]
                        if ear and (spoke or len(turn) or float(np.sqrt(np.mean(frame ** 2))) > LOUD):
                            turn = np.concatenate([turn if len(turn) else recent[-len(frame) - UNIT // 3:-len(frame)], frame])
                        if float(np.sqrt(np.mean(frame ** 2))) > LOUD:
                            # The patient is speaking: she waits for the verdict (not while she speaks herself: her
                            # own listening decides whether to give way, as before).
                            spoke, still, call["wait"] = True, 0, call.get("wait") or (judge is not None and not call.get("speaking"))
                        else:
                            still += len(frame)
                        if spoke and still >= quiet:  # a pause: finished?
                            p = finished(recent) if judge else 1.0
                            await ws.send_text(json.dumps({"type": "turn", "finished": round(p, 2)}))
                            spoke = False
                            if p > 0.5 and ear:
                                heard_turn()
                            elif p > 0.5:  # the pause, now
                                if len(heard):
                                    units.put_nowait(np.concatenate([heard, np.zeros(UNIT - len(heard), np.float32)]))
                                units.put_nowait(np.zeros(UNIT, np.float32))
                                heard, call["wait"] = heard[:0], False
                        elif call.get("wait") and still >= WAIT_S * UNIT:
                            call["wait"] = False  # quiet this long: her turn after all
                            if ear:
                                heard_turn()
        except WebSocketDisconnect:
            pass
        finally:
            # Queued seconds return at once (the stop check opens each model call); the one running finishes first,
            # so the cache is never reset under it.
            duplex.set_session_stop()
            units.put_nowait(None)
            if speaker:
                with contextlib.suppress(Exception):
                    await speaker
            voices.put_nowait(None)  # what is still being made is sent, or dropped with the socket
            if voice_out:
                with contextlib.suppress(Exception):
                    await voice_out
            await asyncio.to_thread(voicing.submit(lambda: None).result)  # her voice is idle before its state is reset
            if call["transcribe"] and call["turn"]:  # a turn she never answered is written down too
                with contextlib.suppress(Exception):
                    await ws.send_text(json.dumps(await asyncio.to_thread(
                        transcribe, np.concatenate(call["turn"])[-TURN_MAX:]), ensure_ascii=False))
            duplex._reset_streaming_state()
            duplex.decoder.reset()
            if AUDIO:
                torch.cuda.empty_cache()
            with contextlib.suppress(Exception):
                await ws.close()


uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))

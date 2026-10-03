"""Box ④ Live: Sona's MiniCPM-o 4.5 in full-duplex mode, one call per replica (docs/minicpm-o-plan.md#architecture).

The model hears the patient one second at a time and, every second, either listens or speaks up to 20 tokens of text
with about a second of Sona's voice (her trained talker from tools/omni-voice-train; timbre from her reference clip).

WebSocket /v1/live, one call per connection:
  in   1. JSON {"type": "start", "system": str, optional "listen_prob_scale", "temperature", "force_listen",
          "max_speak_tokens" (tokens a unit, the brain's pace), "voice" ("v1", Sona's trained talker, or "base")}
       2. binary frames: the patient's audio, 16 kHz mono PCM16 little-endian, any length
       3. JSON {"type": "stop"}, or just close
  out  JSON {"type": "ready"} once the call is set up; then for each second heard
       JSON {"type": "unit", "i", "listen", "text", "end_of_turn", "ms" (model time), "behind" (seconds queued)},
       followed, when Sona speaks, by one binary frame: 24 kHz mono PCM16 little-endian.
Off CUDA (a Mac, for tests) the voice decoder cannot run, so the box answers in text only.
"""
import asyncio
import contextlib
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


def load():
    from transformers import AutoModel

    model = AutoModel.from_pretrained(MODEL, trust_remote_code=True, attn_implementation="sdpa", init_vision=False,
                                      torch_dtype=torch.bfloat16 if AUDIO else torch.float16).eval().to(DEVICE)
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
        r = duplex.streaming_generate(prompt_wav_path=VOICE)
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


def step(audio: np.ndarray, opts: dict, call: dict) -> tuple[dict, bytes | None]:
    t = time.time()
    duplex.streaming_prefill(audio_waveform=audio)
    if call.get("script"):  # this second's tokens are given, not chosen: the brain's states still drive her voice
        forced = iter(call["script"].pop(0))
        choose, duplex.decoder.decode, duplex.force_listen_count = duplex.decoder.decode, lambda **_: torch.tensor(
            [next(forced)], dtype=torch.long, device=duplex.device), 0
        try:
            r = duplex.streaming_generate(prompt_wav_path=VOICE, **{**opts, "max_new_speak_tokens_per_chunk": 64})
        finally:
            duplex.decoder.decode = choose
        if not call["script"] and call.get("release"):
            call["hold"] = False
    else:
        # "hold" in a call's start: she only listens until told what to say (her own answers are not wanted)
        duplex.force_listen_count = 10 ** 9 if call.get("hold") else call.get("force_listen", 0)
        r = duplex.streaming_generate(prompt_wav_path=VOICE, **opts)
    wave, speech = r.get("audio_waveform"), None
    if not r["is_listen"] and wave is not None and len(wave):
        wave = wave.float().cpu().numpy() if isinstance(wave, torch.Tensor) else np.asarray(wave, dtype=np.float32)
        speech = (np.clip(wave.reshape(-1), -1, 1) * 32767).astype("<i2").tobytes()
    # The new part of everything said this call: one second's own decode splits words at the edge ("up" + " sets"),
    # and a character cut mid-byte waits for the next second.
    said = duplex.tokenizer.decode(duplex.res_ids, skip_special_tokens=True).rstrip("�")
    text = said[len(call["said"]):] if said.startswith(call["said"]) else said
    call["said"] = said
    return {"type": "unit", "i": r["current_time"], "listen": r["is_listen"], "text": text,
            "end_of_turn": r["end_of_turn"], "ms": round((time.time() - t) * 1000)}, speech


@app.websocket("/v1/live")
async def live(ws: WebSocket):
    await ws.accept()
    if busy.locked():  # one call per replica; Baseten's concurrency target sends the next call to another
        await ws.close(code=1013, reason="busy")
        return
    async with busy:
        units: asyncio.Queue = asyncio.Queue()
        speaker = None
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
                    unit, speech = await asyncio.to_thread(step, audio, opts, call)
                    unit["behind"] = units.qsize()
                    await ws.send_text(json.dumps(unit, ensure_ascii=False))
                    if speech:
                        await ws.send_bytes(speech)
                    if not call["transcribe"]:
                        continue
                    # The seconds it listened to are the patient's turn; once it starts to speak, the turn is written down.
                    if unit["listen"]:
                        call["turn"].append(audio)
                    elif call["turn"]:
                        turn, call["turn"] = np.concatenate(call["turn"])[-TURN_MAX:], []
                        await ws.send_text(json.dumps(await asyncio.to_thread(transcribe, turn), ensure_ascii=False))

            speaker = asyncio.create_task(speak())
            heard = np.zeros(0, dtype=np.float32)
            while True:
                m = await ws.receive()
                note = json.loads(m["text"]) if m.get("text") else {}
                if m["type"] == "websocket.disconnect" or note.get("type") == "stop":
                    break
                if note.get("type") == "say":  # from the next second on; "release" lets her answer by herself after it
                    call["script"], call["release"] = script(note["text"], int(note.get("rate", 4))), bool(note.get("release"))
                if m.get("bytes"):
                    heard = np.concatenate([heard, np.frombuffer(m["bytes"], "<i2").astype(np.float32) / 32768])
                    while len(heard) >= UNIT:
                        units.put_nowait(heard[:UNIT])
                        heard = heard[UNIT:]
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

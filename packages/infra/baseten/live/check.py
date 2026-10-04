"""Live check of box ④ (data/live.py): plays a recorded question to it in real time, as the phone would, then prints
what Sona decided each second and saves what she said. Synthetic data only.

  python check.py question.wav                       # a local server: python data/live.py (text only off CUDA)
  BASETEN_API_KEY=... python check.py question.wav wss://model-<id>.api.baseten.co/environments/production/websocket
Env: SYSTEM (the call's system prompt), LISTEN (listen_prob_scale), PACE (max_speak_tokens: tokens a unit), TALKER
(v1 or base: which voice), OUT (reply wav, default reply.wav), TAIL (seconds of silence after the question, default 8).
One-ear test: TRANSCRIBE=1 (the box also writes down the patient's turn: "heard"), SEED (same seed, same replies),
FAST=1 (send the audio at once, not in real time), JSON (write what was said, heard and each second's ms there).
Speak test: HOLD=1 (she only listens until told), SAY (words for her to say as written), SAY_AT (seconds into the
call, default when the first question ends), RATE (text tokens a second, default 4), RELEASE=1 (she answers by herself after).
Fast turn: TURN_MS (turn_silence_ms: her turn starts that many ms after the patient stops).
"""
import asyncio
import contextlib
import json
import os
import sys
import time

import librosa
import numpy as np
import soundfile as sf
import websockets

# The brief the model learnt (liveBrief in packages/api/src/voice-agent/live.ts) with a synthetic plan, as planText lays it out.
SYSTEM = os.environ.get("SYSTEM") or """You are Sona Care, a hospital's assistant for its patients, talking with one patient by voice. Answer whatever they ask: their own care, any other health or medicine question, or anything else. For their own medicines, doses and appointments, use their discharge plan below: it is their record.
How to answer:
- Plain and kind, at a reading age of about 12, at most 3 short sentences. The first has at most 10 words: it is spoken while you write the rest. No lists, symbols or markdown: they are read aloud.
- In the language the patient spoke (Malay, English or Chinese).
- If urgent, tell them to call 999 now.
When they mix languages, or you cannot tell, answer in English.

Discharge plan:
Discharged: 2026-09-30T02:05:00.000Z
Medicines:
- Amoxicillin 500mg (new): Antibiotic for the chest infection. Take 1 tablet three times a day after food for 5 days.; After meals
- Paracetamol 500mg (new): For fever and pain. Take 2 tablets every 6 hours if fever is above 38°C.; Every 6 hours
Come back or call if:
- Chest pain or difficulty breathing
- Fever that does not come down after 3 days
Follow-up: Klinik Pakar Perubatan on Thu Oct 08 2026"""


async def main(wav: str, url: str):
    audio = librosa.load(wav, sr=16_000, mono=True)[0]
    audio = np.concatenate([audio, np.zeros(int(float(os.environ.get("TAIL", 8)) * 16_000), np.float32)])
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
    key = os.environ.get("BASETEN_API_KEY")
    async with websockets.connect(url, additional_headers={"Authorization": f"Api-Key {key}"} if key else None,
                                  max_size=None) as ws:
        start = {"type": "start", "system": SYSTEM}
        if os.environ.get("LISTEN"):
            start["listen_prob_scale"] = float(os.environ["LISTEN"])
        if os.environ.get("PACE"):
            start["max_speak_tokens"] = int(os.environ["PACE"])
        if os.environ.get("TALKER"):
            start["voice"] = os.environ["TALKER"]
        if os.environ.get("TRANSCRIBE") == "1":
            start["transcribe"] = True
        if os.environ.get("SEED"):
            start["seed"] = int(os.environ["SEED"])
        if os.environ.get("HOLD") == "1":
            start["hold"] = True
        if os.environ.get("TURN_MS"):
            start["turn_silence_ms"] = int(os.environ["TURN_MS"])
        await ws.send(json.dumps(start))
        print(json.loads(await ws.recv()))
        speech, said, heard, ms, t0, spoke, said_it, sound = [], [], [], [], time.time(), None, [], None
        question_ends = t0 + (len(audio) / 16_000 - float(os.environ.get("TAIL", 8)))
        units, heard_all = len(audio) // 16_000, asyncio.Event()

        say_at = float(os.environ.get("SAY_AT", 0)) * 32_000 if os.environ.get("SAY") else None

        async def play():  # 100 ms frames at the speed a phone sends them, then hang up once every second is answered
            for i in range(0, len(pcm), 3200):
                if say_at is not None and i >= say_at and not said_it:
                    said_it.append(1)
                    await ws.send(json.dumps({"type": "say", "text": os.environ["SAY"], "rate": int(os.environ.get("RATE", 4)),
                                              "release": os.environ.get("RELEASE") == "1"}))
                await ws.send(pcm[i:i + 3200])
                if os.environ.get("FAST") != "1":
                    await asyncio.sleep(max(0, t0 + (i + 3200) / 32_000 - time.time()))
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(heard_all.wait(), 120)
            await ws.send(json.dumps({"type": "stop"}))

        player = asyncio.create_task(play())
        try:
            async for m in ws:
                if isinstance(m, bytes):
                    sound = sound or time.time()
                    speech.append(np.frombuffer(m, "<i2"))
                    continue
                u = json.loads(m)
                at = time.time() - t0
                if u.get("type") == "heard":
                    heard.append(u)
                    print(f"{at:5.1f}s HEARD ({u['seconds']} s of audio, {u['ms']} ms): {u['text']!r}")
                    continue
                if u.get("type") == "turn":
                    print(f"{at:5.1f}s pause: finished {u['finished']}")
                    continue
                if u.get("type") == "voice":
                    print(f"{at:5.1f}s voice of unit {u['i']:3d}, made in {u['ms']} ms")
                    continue
                ms.append(u["ms"])
                if not u["listen"] and spoke is None:
                    spoke = time.time()
                said.append(u["text"])
                if u["i"] >= units - 1:
                    heard_all.set()
                print(f"{at:5.1f}s unit {u['i']:3d} {'listen' if u['listen'] else 'SPEAK '} {u['ms']:4d} ms "
                      f"behind {u['behind']} {u.get('cost') or ''} {u['text']!r}{' [end of turn]' if u['end_of_turn'] else ''}")
        except websockets.ConnectionClosed:
            pass
        player.cancel()
    print("Sona said:", "".join(said).strip())
    if heard:
        print("heard:", " | ".join(h["text"] for h in heard))
    if ms:
        print(f"seconds: {len(ms)}, slowest {max(ms)} ms, over 900 ms: {sum(m > 900 for m in ms)}")
    if os.environ.get("JSON"):
        with open(os.environ["JSON"], "w") as f:
            json.dump({"said": "".join(said).strip(), "heard": heard, "ms": ms,
                       "first_words": round(spoke - question_ends, 2) if spoke else None,
                       "first_sound": round(sound - question_ends, 2) if sound else None}, f, ensure_ascii=False)
    if spoke:
        print(f"first words {spoke - question_ends:+.1f} s after the question ended" + (f", first sound {sound - question_ends:+.1f} s" if sound else ""))
    if speech:
        sf.write(os.environ.get("OUT", "reply.wav"), np.concatenate(speech), 24_000)
        print("audio:", os.environ.get("OUT", "reply.wav"), f"{sum(map(len, speech)) / 24_000:.1f} s")


asyncio.run(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "ws://localhost:8000/v1/live"))

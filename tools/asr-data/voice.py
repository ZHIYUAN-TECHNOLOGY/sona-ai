"""Voice every script turn with Gemini TTS through the Batch API.

  python voice.py submit   # queue every turn that has no audio yet (chunks of 500)
  python voice.py poll     # wait for queued jobs and save their audio
  python voice.py all      # both, round after round, until every turn has audio

Turns are voiced with a short Malaysian-accent instruction first. Gemini sometimes reads
that instruction aloud, so check.py flags those clips and `submit --plain` redoes them as
plain text, which never leaked in the pilot.
"""
import json, base64, glob, os, re, sys, time, urllib.request, zlib
from pathlib import Path

KEY = Path.home().joinpath(".config/gemini_key").read_text().strip()
API = "https://generativelanguage.googleapis.com/v1beta"
MODEL = "gemini-3.8-flash-tts"
DATA = Path(os.environ.get("ASR_DATA_DIR", Path.home() / "zyt/data/sona-asr"))
AUDIO, JOBS = DATA / "audio", DATA / "jobs.json"
# These test voices are never used for training scripts: they voice the test split only.
MALE = ["Charon", "Orus", "Algenib", "Iapetus", "Umbriel", "Fenrir", "Enceladus", "Rasalgethi"]
FEMALE = ["Kore", "Gacrux", "Zephyr", "Leda", "Aoede", "Despina", "Callirrhoe", "Autonoe"]
TEST = {"male": ["Achird", "Zubenelgenubi"], "female": ["Sulafat", "Pulcherrima"]}

def call(method, url, body=None):
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, method=method,
                               headers={"x-goog-api-key": KEY, "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(r, timeout=300))

def scripts():
    for f in sorted(glob.glob(str(Path(__file__).parent / "scripts/*/*.json"))):
        yield from json.load(open(f))

def voice_for(conv, who):
    gender = conv[f"{who}_persona"].get("gender", "female")
    if conv.get("split") == "test": return TEST[gender][0 if who == "doctor" else 1]
    pool = MALE if gender == "male" else FEMALE
    return pool[(zlib.crc32(conv["id"].encode()) + (0 if who == "doctor" else 3)) % len(pool)]  # stable across runs

def request(conv, j, turn, plain):
    who = "doctor" if turn["speaker"] == "Doctor" else "patient"
    text = turn["text"] if plain else f"Say this as a Malaysian {who}, with a natural Malaysian accent and Malaysian Mandarin for any Chinese:\n{turn['text']}"
    return {"request": {"contents": [{"parts": [{"text": text}]}], "generationConfig": {"responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice_for(conv, who)}}}}},
            "metadata": {"key": f"{conv['id']}_{j:02d}"}}

def submit(plain):
    """Queue missing clips. Call only after poll() has emptied jobs.json, or clips get queued twice."""
    AUDIO.mkdir(parents=True, exist_ok=True)
    reqs = []
    for c in scripts():
        for j, t in enumerate(c["turns"]):
            clip = AUDIO / f"{c['id']}_{j:02d}"
            if clip.with_suffix(".wav").exists(): continue
            clip.with_suffix(".txt").write_text(t["text"])
            reqs.append(request(c, j, t, plain))
    jobs = json.loads(JOBS.read_text()) if JOBS.exists() else []
    for i in range(0, len(reqs), 500):
        try:
            j = call("POST", f"{API}/models/{MODEL}:batchGenerateContent",
                     {"batch": {"display_name": f"sona-asr-{int(time.time())}", "input_config": {"requests": {"requests": reqs[i:i + 500]}}}})
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
            print("queue full; the rest waits for the next round", flush=True); break
        jobs.append(j["name"]); JOBS.write_text(json.dumps(jobs)); print("submitted", len(reqs[i:i + 500]), j["name"], flush=True)
    return len(reqs)

def poll():
    jobs = json.loads(JOBS.read_text()) if JOBS.exists() else []
    for name in jobs:
        while not (j := call("GET", f"{API}/{name}")).get("done"): time.sleep(60)
        saved = 0
        for r in j.get("response", {}).get("inlinedResponses", {}).get("inlinedResponses", []):
            try: data = r["response"]["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
            except (KeyError, IndexError): print("no audio", r["metadata"]["key"]); continue
            (AUDIO / f"{r['metadata']['key']}.wav").write_bytes(base64.b64decode(data)); saved += 1
        print(name, "saved", saved, flush=True)
    JOBS.write_text("[]")

if __name__ == "__main__":
    if sys.argv[1] == "submit": submit("--plain" in sys.argv)
    elif sys.argv[1] == "all":  # submit and poll until every turn has audio
        for _ in range(30):  # a clip that never returns audio must not loop forever
            if not submit("--plain" in sys.argv): break
            if not json.loads(JOBS.read_text()): time.sleep(300)  # queue still full: wait before retrying
            poll()
    else: poll()

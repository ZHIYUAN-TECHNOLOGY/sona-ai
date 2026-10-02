"""Manglish in Sona's base voice: Gemini TTS "Kore" (the voice Sona's VoxCPM2 voice was trained from) reads every
Manglish line from lines.py as plain text (no instruction, so none is read aloud), through the Batch API of
tools/asr-data/voice.py. Clips go to ~/zyt/data/sona-omni/voice/manglish/audio/<id>.wav (24 kHz).
  python manglish.py submit   # queue every Manglish line without audio
  python manglish.py poll     # wait for the queued jobs and save their audio
Then read them back with tools/omni-eval/score.py on manglish/manifest.jsonl (written by poll).
"""
import base64, json, re, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "asr-data"))
from voice import API, MODEL, call  # noqa: E402  (the Gemini key and request shape the ASR data used)
from lines import OUT, assemble  # noqa: E402

DIR = OUT / "manglish"; AUDIO = DIR / "audio"; JOBS = DIR / "jobs.json"
# Only lines that really mix: some of Gemma's "Manglish" is Malaysian English with no Malay or Chinese word.
MIXED = re.compile(r"[一-鿿]|\b(tak|nak|ni|tu|lah|kena|makan|ubat|jangan|boleh|dah|sikit|dengan|untuk|dia|kita|saya|awak|nanti|pergi|balik|minum|ambil)\b", re.I)
rows = [r for r in assemble() if r["lang"] == "manglish" and MIXED.search(r["text"])]

if sys.argv[1] == "submit":
    AUDIO.mkdir(parents=True, exist_ok=True)
    todo = [r for r in rows if not (AUDIO / f"{r['id']}.wav").exists()]
    reqs = [{"request": {"contents": [{"parts": [{"text": r["text"]}]}], "generationConfig": {"responseModalities": ["AUDIO"],
             "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": "Kore"}}}}}, "metadata": {"key": r["id"]}} for r in todo]
    jobs = json.loads(JOBS.read_text()) if JOBS.exists() else []
    for i in range(0, len(reqs), 500):
        j = call("POST", f"{API}/models/{MODEL}:batchGenerateContent",
                 {"batch": {"display_name": f"sona-manglish-{int(time.time())}", "input_config": {"requests": {"requests": reqs[i:i + 500]}}}})
        jobs.append(j["name"]); JOBS.write_text(json.dumps(jobs)); print("submitted", len(reqs[i:i + 500]), j["name"], flush=True)
else:
    for name in json.loads(JOBS.read_text()):
        while not (j := call("GET", f"{API}/{name}")).get("done"): time.sleep(60)
        for r in j.get("response", {}).get("inlinedResponses", {}).get("inlinedResponses", []):
            try: data = r["response"]["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
            except (KeyError, IndexError): print("no audio", r["metadata"]["key"]); continue
            (AUDIO / f"{r['metadata']['key']}.wav").write_bytes(base64.b64decode(data))
        print(name, "done", flush=True)
    JOBS.write_text("[]")
    (DIR / "manifest.jsonl").write_text("\n".join(json.dumps({"key": r["id"], "set": "manglish", "id": r["id"], "text": r["text"],
                                                             "resynth": str(AUDIO / f"{r['id']}.wav")}, ensure_ascii=False)
                                                  for r in rows if (AUDIO / f"{r['id']}.wav").exists()) + "\n")

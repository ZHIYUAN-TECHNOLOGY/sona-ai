"""Voice the TTS fine-tuning scripts (scripts/{ms,en,zh}.json) with Gemini as one voice, Kore, via the Batch API.

Reuses the ASR pipeline: audio goes to $ASR_DATA_DIR (default ~/zyt/data/sona-tts/gemini)/audio, and the same
accent instruction ends in "Chinese" so tools/asr-data/trim.py can cut it off when Gemini reads it aloud:
  python tts_voice.py        # submit missing lines, poll, repeat until all have audio
  ASR_DATA_DIR=~/zyt/data/sona-tts/gemini python ../asr-data/trim.py
"""
import json, os, sys, time, urllib.error
from pathlib import Path
os.environ.setdefault("ASR_DATA_DIR", str(Path.home() / "zyt/data/sona-tts/gemini"))
sys.path.insert(0, str(Path(__file__).parents[1] / "asr-data"))
import voice

VOICE = "Kore"
PROMPT = "Say this as a calm Malaysian nurse, with a natural Malaysian accent and Malaysian Mandarin for any Chinese:\n"

def lines():
    for f in ("ms", "en", "zh"):
        yield from json.load(open(Path(__file__).parent / "scripts" / f"{f}.json"))

def submit():
    voice.AUDIO.mkdir(parents=True, exist_ok=True)
    reqs = []
    for l in lines():
        clip = voice.AUDIO / l["id"]
        if clip.with_suffix(".wav").exists(): continue
        clip.with_suffix(".txt").write_text(l["text"])
        reqs.append({"request": {"contents": [{"parts": [{"text": PROMPT + l["text"]}]}], "generationConfig": {"responseModalities": ["AUDIO"],
                     "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": VOICE}}}}}, "metadata": {"key": l["id"]}})
    jobs = json.loads(voice.JOBS.read_text()) if voice.JOBS.exists() else []
    for i in range(0, len(reqs), 500):
        try:
            j = voice.call("POST", f"{voice.API}/models/{voice.MODEL}:batchGenerateContent",
                           {"batch": {"display_name": f"sona-tts-{int(time.time())}", "input_config": {"requests": {"requests": reqs[i:i + 500]}}}})
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
            print("queue full; the rest waits for the next round", flush=True); break
        jobs.append(j["name"]); voice.JOBS.write_text(json.dumps(jobs)); print("submitted", len(reqs[i:i + 500]), j["name"], flush=True)
    return len(reqs)

if __name__ == "__main__":
    for _ in range(30):  # a line that never returns audio must not loop forever
        if not submit(): break
        if not json.loads(voice.JOBS.read_text()): time.sleep(300)
        voice.poll()

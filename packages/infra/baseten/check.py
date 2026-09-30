"""Day-1 smoke check for the Baseten boxes: real requests with their latency (the first one includes any wake-up).
Boxes scale to zero, so running this wakes them and bills until the 5-minute idle delay passes.

  BASETEN_API_KEY=... python3 packages/infra/baseten/check.py brain voice
Laya is checked through the app's own client instead:
  cd packages/api && LAYA_URL=https://model-qe2dp10q.api.baseten.co/environments/production/sync bun -e '...'
"""
import json, os, sys, time, urllib.request, uuid
from pathlib import Path

MODELS = {"brain": "q9p7zn63", "voice": "qvmgk79q", "xray": "wdlp8jm3"}
KEY = os.environ["BASETEN_API_KEY"]
OUT = Path(os.environ.get("CHECK_OUT", "/tmp"))


def call(box, path, body=None, data=None, ctype="application/json"):
    url = f"https://model-{MODELS[box]}.api.baseten.co/environments/production/sync{path}"
    req = urllib.request.Request(url, data=data if data is not None else json.dumps(body).encode(),
                                 headers={"Authorization": f"Api-Key {KEY}", "Content-Type": ctype})
    t = time.time()
    with urllib.request.urlopen(req, timeout=1800) as r:
        return r.read(), time.time() - t


def chat(messages, **extra):
    raw, s = call("brain", "/v1/chat/completions", {"model": "gemma-4-26b-a4b", "messages": messages, "max_tokens": 256, **extra})
    return json.loads(raw)["choices"][0]["message"], s


def brain():
    for label in ("first", "warm"):
        m, s = chat([{"role": "user", "content": "Patient batuk tiga hari, demam malam. In one short English sentence, what should the doctor check first?"}])
        print(f"brain chat ({label}) {s:.1f}s: {m.get('content')!r}")
    # Route with an instruction and tool_choice auto: "required" is not enforced while the gemma4 reasoning parser is on.
    tool = {"type": "function", "function": {"name": "pick_card", "description": "Open the Sona card that answers the doctor's request",
            "parameters": {"type": "object", "properties": {"card": {"type": "string", "enum": ["briefing", "note", "xray", "medication", "evidence"]}}, "required": ["card"]}}}
    route = {"role": "system", "content": "You route a doctor's request to one Sona card. Always call pick_card; never answer the question yourself."}
    m, s = chat([route, {"role": "user", "content": "Tolong semak interaction warfarin dengan azithromycin"}], tools=[tool])
    print(f"brain tool call {s:.1f}s: {json.dumps([t['function'] for t in m.get('tool_calls') or []])}")


def voice():
    wav = Path.home() / "zyt/data/sona-asr/real_voice/01.wav"  # "Doktor, saya batuk sampai 睡不着, dah makan Panadol tapi still demam."
    b = uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nsona-asr\r\n"
            f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"01.wav\"\r\nContent-Type: audio/wav\r\n\r\n").encode() + wav.read_bytes() + f"\r\n--{b}--\r\n".encode()
    for label in ("first", "warm"):
        raw, s = call("voice", "/v1/audio/transcriptions", data=body, ctype=f"multipart/form-data; boundary={b}")
        print(f"voice asr ({label}) {s:.1f}s: {json.loads(raw).get('text')!r}")
    for lang, text in (("ms", "Sila makan paracetamol lima ratus miligram setiap enam jam jika demam."), ("zh", "请每六小时服用一次扑热息痛。")):
        raw, s = call("voice", "/v1/tts", {"text": text})
        (OUT / f"sona-tts-{lang}.wav").write_bytes(raw)
        print(f"voice tts {lang} {s:.1f}s: {len(raw) // 1024} KB -> {OUT / f'sona-tts-{lang}.wav'}")
    raw, s = call("voice", "/v1/rerank", {"query": "steroid untuk pneumonia", "passages": [
        "Corticosteroids are not recommended routinely in adults with non-severe community-acquired pneumonia.",
        "Paracetamol 500 mg to 1 g every 4 to 6 hours, maximum 4 g a day."]})
    print(f"voice rerank {s:.1f}s: {json.loads(raw)}")


def xray():
    import base64
    img = Path(__file__).parents[3] / "apps/native/features/imaging/assets/normal-pa-chest.jpg"  # the app's licensed normal film
    url = "data:image/jpeg;base64," + base64.b64encode(img.read_bytes()).decode()
    for q in ("What type of image is this? Answer in a few words.", "Describe the key findings of this chest radiograph in two sentences."):
        raw, s = call("xray", "/v1/chat/completions", {"model": "medgemma-1.5-4b", "max_tokens": 200, "messages": [
            {"role": "user", "content": [{"type": "image_url", "image_url": {"url": url}}, {"type": "text", "text": q}]}]})
        print(f"xray {s:.1f}s: {json.loads(raw)['choices'][0]['message']['content']!r}")


if __name__ == "__main__":
    for box in sys.argv[1:] or ["brain", "voice", "xray"]:
        globals()[box]()

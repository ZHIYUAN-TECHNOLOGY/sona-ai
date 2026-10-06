"""speaker_gen.py's sentences spoken by the box itself (SageMaker `sona-voice`, the production engine), one call each as
the app makes them, so speaker_prints.py and speaker_heard.py can score the box beside the Mac's arms. Writes
~/zyt/data/sona-tts/speaker/box/<id>_<n>.wav (16 kHz), skipping files that exist.

  AWS_PROFILE=sona python3 tools/tts-eval/speaker_box.py [endpoint]
"""
import json, subprocess, sys, tempfile
from pathlib import Path

OUT = Path.home() / "zyt/data/sona-tts/speaker/box"; OUT.mkdir(parents=True, exist_ok=True)
endpoint = sys.argv[1] if len(sys.argv) > 1 else "sona-voice"
answers = json.load(open(Path(__file__).parent / "scripts/answers.json"))
with tempfile.TemporaryDirectory() as tmp:
    body, mp3 = Path(tmp) / "say.json", Path(tmp) / "say.mp3"
    for a in answers:
        for n, text in enumerate(a["sentences"]):
            wav = OUT / f"{a['id']}_{n}.wav"
            if wav.exists(): continue
            body.write_text(json.dumps({"text": text}, ensure_ascii=False))
            subprocess.run(["aws", "sagemaker-runtime", "invoke-endpoint", "--region", "ap-southeast-5", "--endpoint-name", endpoint,
                            "--content-type", "application/json", "--body", f"fileb://{body}", str(mp3)], check=True, capture_output=True)
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(mp3), "-ar", "16000", "-ac", "1", str(wav)], check=True)
        print(a["id"], flush=True)
print("DONE")

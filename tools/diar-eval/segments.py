"""Step 1 of scoring who-said-what (words.py is step 2): each recording cut as the scribe cuts it, each part's voices as
the box's diarizer would answer them (speaker memory handed on), written to <set>/<name>.parts.json:
[{"from": s, "to": s, "segments": [{"voice": 1.., "from": s into the part, "to": s}]}].

  ~/zyt/venvs/diar/bin/python tools/diar-eval/segments.py [set dir]
"""
import json, sys

import soundfile as sf, torch

sys.argv = sys.argv[:2]  # run.py reads the set from argv[1]
import run

for wav in sorted(run.SET.glob("*.wav")):
    audio, _ = sf.read(wav, dtype="float32")
    edges, blob, out = run.cuts(audio), None, []
    with torch.inference_mode():
        for a, b in zip(edges, edges[1:]):
            inputs = run.processor(audio[a:b], sampling_rate=run.SR, is_streaming=True, is_first_audio_chunk=True, is_last_audio_chunk=True).to(run.device)
            got = run.model(**inputs, speaker_cache=run.unpacked(blob) if blob else run.new_cache())
            blob = run.packed(got.speaker_cache)
            out.append({"from": round(a / run.SR, 2), "to": round(b / run.SR, 2),
                        "segments": [{"voice": s["Speaker"] + 1, "from": s["Start"], "to": s["End"]} for s in run.processor.extract_speaker_dict(got.logits)[0]]})
    (run.SET / f"{wav.stem}.parts.json").write_text(json.dumps(out))
    print(wav.stem, len(out), "parts", sum(len(p["segments"]) for p in out), "segments", flush=True)

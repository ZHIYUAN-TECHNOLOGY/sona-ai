"""Sona's fine-tuned VoxCPM2 (Nano-vLLM-VoxCPM, as on box ②) reads every line, many at once, at the rated settings
(10 steps, cfg 2.0; docs/tts-training.md). Clips go to <out>/audio/<id>.flac at 24 kHz, one row each to <out>/spoken.jsonl.
Resumable. Stops starting new lines after SPEAK_MINUTES (default 240), so the H100 bill has a ceiling.
Runs in the /opt/tts venv of run.sh. Usage: python speak.py <lines.jsonl> <out_dir>
"""
import asyncio, json, os, sys, time
from pathlib import Path

import numpy as np, soundfile as sf, torch, torchaudio


async def main(lines: Path, out: Path):
    from nanovllm_voxcpm import VoxCPM

    voice = VoxCPM.from_pretrained("/app/models/tts", inference_timesteps=10, max_num_seqs=64, max_model_len=2048,
                                   max_num_batched_tokens=16384, gpu_memory_utilization=0.85)
    await voice.wait_for_ready()
    rate = (await voice.get_model_info())["output_sample_rate"]
    (out / "audio").mkdir(parents=True, exist_ok=True)
    log_path = out / "spoken.jsonl"
    done = {json.loads(l)["id"] for l in log_path.read_text().splitlines()} if log_path.exists() else set()
    rows = [r for r in map(json.loads, lines.read_text().splitlines()) if r["id"] not in done]
    gate = asyncio.Semaphore(64)
    deadline = time.time() + float(os.environ.get("SPEAK_MINUTES", 240)) * 60
    with open(log_path, "a") as log:
        async def one(r):
            try:
                async with gate:
                    wav = np.concatenate([c async for c in voice.generate(target_text=r["text"], cfg_value=2.0)])
                w = torchaudio.functional.resample(torch.from_numpy(wav).float(), rate, 24000).numpy()
                sf.write(out / "audio" / f"{r['id']}.flac", w, 24000)
                log.write(json.dumps({**r, "audio": f"{r['id']}.flac", "seconds": round(len(w) / 24000, 2)}, ensure_ascii=False) + "\n")
                log.flush()
            except Exception as e:  # one bad line must not stop the batch
                print("failed", r["id"], e, flush=True)

        for i in range(0, len(rows), 512):  # in slices, so progress shows and memory stays flat
            if time.time() > deadline:
                print("time budget reached; stopping with", len(done) + i, "spoken", flush=True)
                break
            await asyncio.gather(*(one(r) for r in rows[i:i + 512]))
            print("spoken", len(done) + i + len(rows[i:i + 512]), flush=True)
    await voice.stop()


if __name__ == "__main__":  # the engine starts its worker with spawn, which re-imports this file
    asyncio.run(main(Path(sys.argv[1]), Path(sys.argv[2])))

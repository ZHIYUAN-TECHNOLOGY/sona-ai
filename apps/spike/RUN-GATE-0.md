# Gate 0 — On-device spike run card (iPhone 17 Pro Max)

The harness is built and aligned to the locked demo consult. This is the one step only you can do:
build to your phone and run it. Then send me the numbers. That is Gate 0.

## What it measures (thresholds in `thresholds.json`)
- **STT** ≤ 90 s for the sample clip (Whisper Small, on-device)
- **LLM** SOAP note ≤ 30 s **and** ≥ 6 tokens/sec (Qwen3-1.7B quantized, on-device)
- **NER/redaction** recall ≥ 0.90 (deterministic redactor, already verified 1.0 on the locked consult)
- **E2E** ≤ 90 s total
- No OOM / crash

The LLM + redaction benches now run against the **locked demo consult**
(`docs/superpowers/specs/2026-07-05-locked-demo-consult.md`), so a GO here also predicts the
Gate-3 note quality against the gold SOAP.

## Run it (Mac + Xcode + the 17 Pro Max on a cable)
```bash
# from the repo root
npm install                     # pulls native deps incl. react-native-executorch (already declared)
cd apps/native
npx expo run:ios --device       # pick the iPhone 17 Pro Max; first build takes a few minutes
```
1. App opens straight to **"Sona On-Device Spike"** (the home route renders it).
2. **First launch downloads the models to the device over Wi-Fi** (one time): Whisper Small + Qwen3-1.7B. Wait until both read `ready: true (100%)`.
3. Turn **airplane mode ON** (prove it is offline).
4. Tap **"Run all benchmarks."**
5. Read the per-stage **GO / NO-GO** + timings on screen. The metrics JSON path is shown at the bottom (`spike-metrics.json` in the app document directory).

## Send me
Either the on-screen numbers (STT ms, LLM ms + tok/sec, NER recall, E2E ms) or the `spike-metrics.json`
file (pull it from the app container via Xcode → Window → Devices and Simulators → the app → Download Container).

## The decision
- **All stages GO** → Gate 0 passed. We build the real slice on Qwen3-1.7B + Whisper Small. If the LLM
  passed with big headroom (tok/sec well above 6, note reads clean), I will swap up to a 3B model for
  better prose before Day 3 (the 12 GB RAM allows it) and you re-run this once to confirm.
- **LLM NO-GO** (too slow / OOM / missing sections) → we drop the note step to the templated fallback
  (still fully on-device) and keep everything else. The demo still runs offline.
- **STT NO-GO** → smaller Whisper (base/tiny) or a shorter clip.
- I read the result and write `docs/superpowers/decisions/ondevice-runtime-decision.md` (GO/NO-GO + which
  model ships), then we start Day 2.

## Note on models
The Mac proxy bench already passed easily (Qwen2.5-7B: 71 tok/s, 5.6 s SOAP; STT 10 s/60 s). The phone is
slower than the Mac, but the 17 Pro Max is the strongest iPhone, so 1.7B should clear the bar comfortably
and even 3B is likely viable. This run is the real confirmation.

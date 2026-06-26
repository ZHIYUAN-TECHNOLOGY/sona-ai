# Sona — On-Device Spike

**One question:** can a phone run the Sona pipeline (Whisper STT → OpenMed PII de-identify → Qwen2.5 SOAP) **offline, fast enough to be usable?**
Answer it cheaply *before* building the app. Output = **GO / NO-GO**.

## GO/NO-GO gates (`thresholds.json`)
- **STT** ≤ 90 s for a 60 s clip
- **LLM** SOAP note ≤ 30 s **and** ≥ 6 tokens/sec
- **PII** redaction recall ≥ 0.90
- **E2E** ≤ 90 s, **no OOM** across 5 consecutive runs
- **RAM** peak < ~6 GB

---

## Phase 0 — Mac bench (do this first, ~30 min)
No Xcode, no phone. A Mac (Apple silicon ideal) is *faster* than a phone, so it's a quick filter: fail here → fails on phone; pass here → confirm on phone.

```bash
cd apps/spike/mac-bench
bash setup.sh           # installs llama.cpp + whisper.cpp, downloads models (~5 GB, one time)
node bench.mjs          # benches the 7B; or:  node bench.mjs 1.5b
```
Prints a table + verdict, writes `results.json`. **Send me `results.json`.**

> Models pulled are upstream Qwen2.5 / Whisper (directional speed = same as the Malaysian fine-tunes at equal size/quant). Swap in the mesolitica GGUF/ggml builds to also judge *quality*.
> For a real STT number, drop a recorded ~60 s rojak clip at `mac-bench/audio/consult-01.wav` (16 kHz mono). Otherwise setup.sh makes an English smoke-test clip.

## Phase 1 — On-phone harness (the binding test)
React Native / Expo dev-client app (built next): `whisper.rn` + `llama.rn` + ONNX NER.
1. Mac + Xcode + a flagship iPhone (cable).
2. `npm i && npx expo run:ios` → app on device.
3. First launch downloads models to the device (one-time, Wi-Fi).
4. **Airplane mode ON.**
5. Pick a fixture → **Run** → live metrics (STT, PII recall, LLM tok/s, peak RAM, E2E ×5).
6. Send me the on-device `results.json`.

## Fixtures (`fixtures/`)
- `consult-01.raw.txt` — synthetic rojak consult (BM + EN + 中文 + Tamil), with names/IDs.
- `consult-01.pii.json` — labelled identifiers → scores de-identification recall.
- `consult-01.reference-soap.md` — gold note → eyeball LLM quality.

## After the run
I read `results.json` and write **`docs/superpowers/decisions/ondevice-runtime-decision.md`** — GO/NO-GO, which model ships (7B premium vs 1.5B phone), iOS-first call, evidence table. A green spike becomes the centrepiece of the MAIC pitch ("watch it run in airplane mode").

## If NO-GO
The failing metric tells us the fix: smaller/more-quantized model (1.5B, q4→q3), different engine (MLX vs llama.cpp), or shift heavy work to the optional cloud-premium path (de-identified text only). We pivot *before* wasting build time.

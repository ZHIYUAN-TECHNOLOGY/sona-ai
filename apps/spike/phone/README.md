# Sona Spike — Phase 1 (real phone)

Benches the **LLM** (the gating risk) on a real iPhone via **RunAnywhere**: download → load → generate a SOAP note ×5 → tok/s, latency, stability → GO/NO-GO + `results.json`. Also lets us judge the **RunAnywhere runtime itself**.

## Run (your Mac + iPhone)
RunAnywhere needs its own runtime — **not** Expo Go.
1. Install **RunAnywhere AI Studio** (their dev runtime) on the Mac + iPhone (see runanywhere.ai).
2. `cd apps/spike/phone && npm install`
3. Open the project in AI Studio → run on the connected iPhone.
4. In the app: **1 Init → 2 Download** (Wi-Fi, ~1 GB for 1.5b) **→ airplane mode ON → 3 Run bench**.
5. Watch the table + log. **Read peak RAM from Xcode's memory gauge** while it runs (RN can't self-measure).
6. Grab `results.json` (path shown in log; via Xcode → Devices → app container, or Files).
7. Send me `results.json` + the RAM number → I write the decision doc.

## Switches
- `src/models.ts` → `LLM_SIZE = "1.5b" | "7b"`. Bench **both**.
- Swap LLM URL to the **Malaysian-Qwen2.5 GGUF** to judge note *quality* (convert from mesolitica HF with llama.cpp `convert_hf_to_gguf.py` + `llama-quantize` if no GGUF is published).
- STT: point the whisper model at a **multilingual sherpa-onnx** build (or a sherpa export of Malaysian-Whisper) to test rojak. Default is English-only (timing smoke test).

## What this also decides — runtime gate ⚠️
RunAnywhere runs inside **AI Studio**. Before locking RunAnywhere for production, confirm:
1. Can we build a **standalone App-Store binary** (not stuck in AI Studio)?
2. SDK **pricing / license** acceptable?
3. Loads our **Malaysian-Qwen GGUF + OpenMed ONNX** + multilingual whisper?
4. 7B **RAM** ok on target device?

If any fail → fall back to **DIY `llama.rn` + `whisper.rn`** (free, no lock-in). The Mac Phase-0 (`../mac-bench`) is runtime-agnostic and still gives the core tok/s.

## Not measured here
- **PII recall** → OpenMed ONNX, separate small test (fast, low risk).
- **STT WER** → needs a recorded rojak clip + multilingual whisper.

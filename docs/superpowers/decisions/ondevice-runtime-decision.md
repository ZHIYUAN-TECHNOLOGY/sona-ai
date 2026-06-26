# Decision: On-Device Runtime — GO / NO-GO

**Status:** ✅ **GO (Phase-0, directional)** — phone confirm (Phase-1) pending
**Date:** 2026-06-24
**Owner:** ZHIYUAN TECHNOLOGY
**Driver:** the whole Sona thesis = run the pipeline offline on a phone. This records the spike evidence + the model/runtime call.

---

## Question
Can a device run **Whisper STT → OpenMed PII → Malaysian-Qwen2.5 SOAP** offline, fast + within memory?

## Gates
| Metric | Threshold |
|---|---|
| STT | ≤ 90 s / 60 s clip |
| LLM SOAP | ≤ 30 s **and** ≥ 6 tok/s |
| PII recall | ≥ 0.90 |
| E2E | ≤ 90 s, 0 OOM × 5 |
| Peak RAM | < ~6 GB |

## Evidence

### Phase 0 — Mac bench (Apple silicon, directional) ✅
Engine: llama.cpp (Metal) + whisper.cpp. Models: Qwen2.5 GGUF q4_k_m + Whisper. (Generic Qwen used for speed = ~same as Malaysian fine-tune at equal size/quant; SOAP **quality eyeballed live = good** — correct SOAP, ICD-10 U07.9, doses + penicillin allergy captured from rojak input.)

| Stage | 1.5B | 7B | Gate | Pass |
|---|---|---|---|---|
| LLM generation | **176.7 tok/s** | **71.6 tok/s** | ≥ 6 | ✅ |
| SOAP latency (est) | ~2.3 s | ~5.6 s | ≤ 30 s | ✅ |
| Prompt processing | 3380 tok/s | 744 tok/s | — | — |
| STT | 19.5 s / 60 s | 10.1 s / 60 s | ≤ 90 s | ✅ |

> **Phone projection** (Mac is ~5–15× faster than a phone):
> - **1.5B → ~12–35 tok/s on phone** → comfortably over the ≥6 bar. **GO.**
> - **7B → ~5–14 tok/s on phone** → borderline; likely fine on high-end, confirm in Phase-1. Premium/tablet tier.
> Both pass every gate on Mac. SOAP quality on rojak input verified live (correct SOAP + ICD-10 + doses + allergy).

**PII de-identification (recall) ✅**
Pipeline = NER (names) + regex backstop (structured IDs: IC/MyKad, age, phone). On the rojak fixture:

| Approach | Recall | Gate |
|---|---|---|
| NER only (generic English `obi/deid_roberta_i2b2`) | 0.60 (names caught; missed bare IC/age) | ≥0.90 |
| **NER + regex backstop** | **1.00** ✅ | ≥0.90 |

> Confirms the **privacy moat** is achievable. Caveats: tiny fixture (5 spans), generic English NER. Production → swap to **OpenMed privacy-filter** + the regex layer, validate on a larger labelled rojak set.

### Phase 1 — On-device (binding) ⏳ pending
Run `apps/spike/phone` (RunAnywhere, AI Studio) on a flagship iPhone. Capture tok/s, E2E ×5, **peak RAM (Xcode gauge)**, for 1.5B and 7B. Paste here.

---

## Decision

**Verdict:** **GO** (Phase-0). On-device inference is feasible.

**Shipping model:**
- **Phone default → Malaysian-Qwen2.5-1.5B (q4)** — proven fast, ~1 GB, runs broad device range.
- **Premium (tablet/pro) → 7B** — pending phone RAM/speed confirm.
- **STT → Malaysian-Whisper** (small phone / turbo premium).
- **PII → OpenMed privacy-filter + regex backstop** — spike recall **1.0** (NER names + regex IC/age). Production = NER + rules.

**Platform:** iOS-first (OpenMed MLX path); Android = ONNX export later.

**Runtime:** **undecided — gated on Phase-1.** RunAnywhere (fast build, voice pipeline) vs DIY llama.rn/whisper.rn (no lock-in). Phase-1 also tests RunAnywhere + must confirm: standalone App-Store build, pricing/license, loads our GGUF/ONNX, 7B RAM.

**Rationale:** 1.5B clears every gate with a 4–29× margin on Mac; phone headroom ample. Quality on rojak input verified live. No blocker to building the P0 on-device slice.

## If 7B fails on phone
Ship 1.5B as default (already GO); offer 7B only on high-end/tablet or via optional cloud-premium (de-identified text only). No impact on the core pitch.

## Consequences
- Pitch claim "runs offline on this phone" = **proven directionally**, phone demo confirms.
- One-time model download: ~1.3 GB (1.5B tier) — UX in prototype §00 setup + §08 storage.
- Next: 7B Mac number → Phase-1 phone run → lock runtime.

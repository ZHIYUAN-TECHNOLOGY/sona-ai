# Sona — 5-Day On-Device Demo Build Plan

> Written 2026-07-05 after a /grill-me pass. Target completion: **end of Day 5 (~2026-07-09)**.
> Companion to `2026-06-16-scaffold-and-ondevice-spike.md` (the spike thresholds) and
> `2026-06-17-p0-scribe-slice-build.md` (the P0 slice). This plan is the concrete 5-day execution.

## What we are building (and not)

**Building:** ONE flow that genuinely runs **on-device, in airplane mode**, on a single locked phone:
consent → record → live transcript → on-device redaction → on-device SOAP note → review → sign →
export (FHIR + PDF), with the audit log and a "0 bytes transmitted" proof. This is the competition weapon.

**Not building (this week):** the other ~17 prototype screens, Guardian, the web dashboard, the cloud
control-plane, coding/ICD-10, multi-doc, Ask Sona, note-style. They stay in the prototype + deck as the
roadmap. The code we write is **product-grade and cross-platform**, so the public app extends it, never forks it.

## Locked decisions (from the grill)

| # | Decision | Lock |
|---|----------|------|
| 1 | Day-5 deliverable | Live on-device demo. Depth over breadth. ~6 real screens. |
| 2 | Device | **iPhone 17 Pro Max** locked as the demo target (A19 Pro-class NPU, ~12GB RAM). Cross-platform RN, both stores later; iOS is just the live-run target. The RAM headroom lets note-gen run a 3-4B model, not just 1-1.5B. |
| 3 | 5-day focus | On-device slice as the product foundation. Breadth + tiered cloud fallback = immediate roadmap. |
| 4 | Note-gen engine | On-device LLM via `llama.rn`. Primary (17 Pro Max has the RAM): **Qwen2.5-3B-Instruct or Llama-3.2-3B-Instruct, 4-bit**. Floor: 1-1.5B. Stretch: 7-8B 4-bit if Day-1 shows speed. **Day-1 spike gate** decides. Templated note is the built-in fallback. |
| 5 | Scaffold | Better-T-Stack monorepo scaffolded; the 5 days touch only `apps/native` + the on-device pipeline. Server / web / control-plane stay empty stubs behind interfaces (the A-seam). Zero cloud built this week. |
| 6 | Team | You + AI agents. You own the critical path (native ML + device build). Agents run parallel on UI, export, FHIR/PDF, glue, tests. |
| 7 | Demo input | Locked ~90s scripted MY consult audio (BM+EN) as the reproducible default; live-mic "try it" as the encore. Prompt tuned to the locked consult. |

**Non-negotiable moat rule (gates every task):** raw audio, transcript, and the re-identify map never leave the
device. Only de-identified text may ever cross the boundary, and only on the optional cloud path (not built this week).

## The 6 real screens (map from prototype → RN)

| Prototype screen | Builds into | Real data source |
|---|---|---|
| New consult / consent | Consent + audit start | consent line + timestamp written to local audit log |
| Recording (live transcript) | Audio capture + on-device STT stream | `expo-av` mic → `whisper.rn` |
| Privacy gate | Redaction proof | deterministic redactor output + local re-ID map |
| Consult note (review/edit) | Editable generated note | on-device LLM (or templated) SOAP |
| Sign & export | Signature + FHIR/PDF + audio discard | signature capture, `expo-print`/FHIR JSON, delete audio |
| Consult complete | Audit log + 0-bytes proof | local audit rows + network-egress assertion |

## Architecture / stack (this week's surface only)

- **App:** Expo **bare** React Native (native modules required for on-device ML). Expo Router for nav.
- **UI:** NativeWind (Tailwind-in-RN) to port the prototype's white+green tokens fast and faithfully. Reuse the exact palette/spacing from `sona-slice-prototype-green.html`.
- **STT:** `whisper.rn` (whisper.cpp bindings), **base or small multilingual** model (BM+EN), **CoreML-accelerated on the A19 Neural Engine** (fast on the 17 Pro Max).
- **Redaction:** deterministic floor — regex for IC / phone / email / postal address + a name gazetteer/matcher. Emits de-identified text + a re-ID map stored in device secure storage (Keychain / Keystore). ML NER is post-5-day.
- **Note-gen:** `llama.rn`, **Qwen2.5-3B-Instruct or Llama-3.2-3B-Instruct 4-bit GGUF** (the 17 Pro Max has the RAM), strict SOAP prompt with few-shot from a MY consult. De-identified transcript in → SOAP out → re-identify locally. 1-1.5B is the fast floor; 7-8B a Day-1 stretch.
- **Persistence:** local only — `op-sqlite` or `expo-sqlite` for consult / transcript / note / audit; secure storage for the re-ID map.
- **Signing + export:** on-device signature capture; **FHIR R4 DocumentReference** JSON + **PDF** via `expo-print`. On sign: delete the audio file, seal a hash into the audit log.
- **Monorepo:** `apps/native` (all week's work), `apps/server` + `apps/web` = scaffolded empty stubs, `packages/lib` = shared types + the cloud-toggle interface (unused this week).

## Day-by-day (human critical path ∥ agent tracks)

### Day 1 — Spike + scaffold (the make-or-break gate)
> **Status 2026-07-05:** monorepo + on-device spike harness already scaffolded from a prior session
> (`apps/native/spike/` uses `react-native-executorch` = Whisper Small + Qwen3-1.7B; routed as the app
> home screen). Mac proxy bench already GREEN (Qwen2.5-7B: 71 tok/s, 5.6 s SOAP; STT 10 s/60 s) and PII
> combined recall 1.0. Spike fixtures **now aligned to the locked demo consult** and the redactor verified
> at recall 1.0 on it. **Remaining: the on-device run on the 17 Pro Max** — see `apps/spike/RUN-GATE-0.md`.
> That run is the actual Gate-0 decision and is the one step that needs your Xcode build + device.
>
> **Agent tracks landed (2026-07-05):** the three engine-independent tracks are built, tested, and typecheck clean.
> - **Export** — `apps/native/lib/export/` (FHIR R4 DocumentReference + PDF + HTML), 10/10 pure tests.
> - **Persistence + secure store** — `apps/native/lib/db/` + `lib/secure/` (local SQLite + secure re-ID map, moat enforced), 25/25 pure tests.
> - **UI** — the 6 slice screens + 16 components + shared theme under `apps/native/app/(consult)/`, `components/consult/`, `lib/theme.ts`, mapped onto the canonical `lib/db/types.ts`.
> - Deps added: `expo-print`, `expo-sqlite`. Whole-app `tsc --noEmit` exit 0.
> - An adversarial verify pass (17 findings → 8 confirmed) ran; durable defects fixed (FHIR UTF-8 charset, structured `orders` + a re-identification export guard, `clinical_note UNIQUE(consultId)` + deterministic `getNote`, a real re-ID prefix-collision test, sign-gating, and a clean "Next patient" stack reset). Wire-time cleanups deferred to Days 2-4 (privacy-gate count/re-ID map become data-driven; the consult-flow glass tab bar is finalized with the app shell).
>
> **Tracked hardening (post-demo, not the moat):** the raw pre-redaction transcript is stored in plaintext SQLite. The moat holds (nothing leaves the device), but at-rest this should be SQLCipher-encrypted (key in SecureStore), or keep only de-identified text in SQLite with the raw transcript in secure storage.

- **You (critical path):** scaffold the monorepo; stand up the bare RN app on the **target device**; get `whisper.rn` STT and `llama.rn` LLM each loading and running once on-device. Run the **Day-1 gate** below.
- **Agents (parallel):**
  - Port the 6 slice screens from the HTML prototype to RN + NativeWind (static, mocked data, pixel-faithful tokens).
  - Define the local persistence schema (consult / transcript / note / audit) + secure-storage wrapper for the re-ID map.
  - Build the FHIR + PDF export module as pure, unit-tested functions (works with a sample note offline).
- **Gate 0 (end of Day 1):** runtime locked; STT runs; **LLM decision made** — pass the bar → build on the LLM; fail → switch the note step to the templated path. Do not drift past this without deciding.
  - Bar: STT ≤ 90s for 90s audio · LLM ≥ 6 tok/s · a sample note rated "usable with light edits" · no OOM across 5 runs.

### Day 2 — Real capture + redaction (Gate 1, the moat)
- **You:** wire live audio capture → streaming transcript from `whisper.rn`; implement the deterministic redactor (regex + gazetteer) → de-identified text + re-ID map to secure storage. **Instrument each stage to log exactly what it receives**, to prove de-identified text is the model's input.
- **Agents:** bind the recording screen (live transcript, waveform, timer) and the privacy-gate screen to real pipeline output; write a redaction test set (IC, phone, address, names — including a low-confidence case) and assert recall.
- **Prereq done today:** record the locked ~90s scripted MY consult audio (BM+EN).
- **Gate 1:** the summarizer provably sees only de-identified text; re-ID map is device-only. **Block if not true.**

### Day 3 — Note-gen + review + sign (Gate 3 + Gate 2)
- **You:** de-identified transcript → on-device LLM → SOAP note → re-identify locally; tune the prompt to the locked consult until the note is clean. Wire the airplane-mode end-to-end path.
- **Agents:** the consult-note review/edit screen bound to the generated note; the sign screen + signature capture; audio-discard-on-sign; audit-log writes for every step.
- **Gate 2:** record → note fully offline (airplane mode), ≤ ~2 min perceived, no OOM across 5 runs.
- **Gate 3:** a clinician (or proxy) rates the note "usable with light edits."

### Day 4 — Export + hardening + 0-bytes proof
- **You:** wire FHIR DocumentReference + PDF export to the signed note; harden airplane-mode; add the network-egress assertion that backs the "0 bytes" claim; fix OOM / perf.
- **Agents:** the export screen, the consult-complete proof screen (audit log + 0 bytes), the consent screen + audit start; polish all 6 screens to prototype fidelity; loading / empty / error states.
- **Deliverable:** the whole flow runs end to end on the device.

### Day 5 — Rehearse + reproducibility + buffer (Gate 4)
- **You:** run the **3-minute demo script 5 times** on the locked device in airplane mode; lock the build; test the live-mic encore; **record a backup demo video** in case the stage fails.
- **Agents:** final copy/QA pass; prepare the deck slide that references the live demo.
- **Gate 4:** the 3-min script runs 5/5 reproducibly. Definition of Done met.

## Go / No-Go gates (summary)

| Gate | When | Pass condition | If fail |
|------|------|----------------|---------|
| 0 | End Day 1 | runtime + STT + LLM decision locked | LLM no-go → templated note path |
| 1 | Day 2 | model sees only de-identified text; re-ID map device-only | **block, do not proceed** |
| 2 | Day 3 | offline record→note ≤ ~2 min, no OOM ×5 | smaller model / shorter max-tokens / shorter audio |
| 3 | Day 3 | note rated usable | tune prompt; else templated note carries it |
| 4 | Day 5 | 3-min demo runs 5/5 | harden weakest step; fall back to the backup video |

## Cut list (drop in this order if behind schedule)

1. Live-mic encore (keep locked-audio run only)
2. FHIR export (keep PDF only)
3. BM/EN code-switch (fall back to EN-only transcript + note)
4. On-device LLM note (fall back to templated note — Gate 0 fallback)
5. Editable note (show read-only generated note)

The airplane-mode record → redact → note → sign → audit → "0 bytes" core is **never cut** — it is the demo.

## Risks + fallbacks

| Risk | Fallback |
|------|----------|
| On-device LLM too slow / OOM | templated note (already the Gate-0 floor); or smaller model / fewer tokens |
| STT slow or inaccurate on BM | whisper tiny/base; shorten locked audio; EN-only |
| Redaction misses an identifier | deterministic-only + the low-confidence "tap to confirm" flow from the prototype; never present sample recall as production recall |
| Device build breaks on demo day | the locked backup video (recorded Day 5) |
| iOS signing / provisioning eats a day | switch demo target to the Android device (code is cross-platform) |

## Prerequisites / blockers (need from you before Day 1)

- **Device: locked — iPhone 17 Pro Max.** ✓
- **Toolchain (iOS): a Mac with Xcode + an Apple Developer account.** A free account works for on-device deploy but re-provisions every 7 days (fine across a 5-day window); the paid $99/yr account gives a stable build with no mid-week re-sign. **Confirm you have a Mac + Xcode installed.** If Mac access is a problem, we pivot the target to an Android device (code is cross-platform) — flag it now, not Day 3.
- **A clinician or proxy** available Day 3 to rate the note (Gate 3).
- **The scripted consult text** — I can draft a realistic MY GP consult in BM+EN for you to approve on Day 1-2.

## Definition of Done

On the locked device, in airplane mode, a run of **consent → record (locked audio) → live transcript →
redaction proof → on-device SOAP note → review → sign → export (FHIR + PDF)** completes with the audio
discarded on sign, the audit log and "0 bytes transmitted" shown, **reproducible 5 out of 5**, in **≤ 3 minutes** —
built as clean, cross-platform code inside the monorepo, ready for the breadth + cloud-fallback roadmap.

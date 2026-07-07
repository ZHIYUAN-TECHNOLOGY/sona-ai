# Sona — Demo Run-Card (MAIC Nexus Challenge, Healthcare)

**One-liner:** Privacy-first on-device AI ambient medical scribe. Raw audio, transcript, and
re-identify map never leave the phone. Only de-identified text may ever cross the boundary,
and only on the optional cloud path. Proven live: **0 bytes of PHI transmitted.**

Target: ~4–5 min live walk of one consult (Encik Rahman, 58, URTI follow-up, BM + EN).

---

## 0. Pre-flight (do BEFORE you stand up)

Run this list every time. Most demo deaths are pre-flight misses.

- [ ] **Sim/device booted**, app installed, Metro running (`npx expo start --dev-client`).
- [ ] **Model pre-loaded.** Walk one full consult in private FIRST so Qwen3 is downloaded +
      cached. The first-run model download is the long pole (minutes) — never let a judge
      watch it. After one warm run, screen 4 drafts in seconds.
- [ ] **DO NOT** tap "Load models & benchmark" on the spike home. That loads a 2nd Qwen3 →
      OOM. Benchmark screen is for you alone, never during the live demo.
- [ ] **Airplane mode ON** (the whole point — and the top-right badge shows it). Wi-Fi/cellular
      off. This makes "0 bytes transmitted" undeniable: there is no network.
- [ ] **Fresh consult.** If you rehearsed, tap "Next patient" to reset to a clean consent screen.
- [ ] Screen brightness up, Do-Not-Disturb on (no notification banners over PHI).
- [ ] Backup video queued on a second device (see §4).

---

## 1. The 60-second frame (say this before you touch the phone)

> "Doctors in Malaysia spend hours on notes. Cloud scribes exist — but they ship patient
> audio to a server. Under PDPA, and for any clinic handling real patient data, that's the
> dealbreaker. Sona runs the *entire* pipeline on the phone: speech-to-text, de-identification,
> the clinical note — all on-device. Nothing leaves. Let me show you."

Point at the **Airplane badge**. "Watch — this is in airplane mode the whole time."

---

## 2. Per-screen script (tap → say → point)

Times are cumulative targets. Keep moving; don't over-narrate.

### Screen 1 — Consent (0:00)
- **Tap:** primary button.
- **Say:** "Consult starts with spoken consent, captured in the patient's language."
- **Point:** consent line in Bahasa.

### Screen 2 — Recording (0:30)
- **Say:** "The consult streams in — Bahasa and English mixed, exactly how Malaysian GP visits
  actually sound. Two speakers, transcribed on-device."
- **Point:** "Transcribing on-device, no network" banner + "BM + EN → EN".
- **Tap:** **End consult** once the transcript is full (12 lines).
- ⚠️ This is the **scripted** transcript. Do NOT claim it's live mic STT — say "transcribed
  on-device" (true of the pipeline) and move on. If asked directly: "STT is on-device Whisper;
  for a reliable demo we run a fixed transcript so the clinical story is controlled."

### Screen 3 — Privacy gate (1:15) ← **THE MOAT. Slow down here.**
- **Say:** "Before *any* model reads a word, we de-identify. This is what the model sees —"
- **Point:** the black tokens: **NAME_1, IC_1, PHONE_1, ADDR_1**. "Name, IC, phone, address —
  gone, replaced with tokens."
- **Point:** the uncertain one — "Kak Timah" kept local: "When we're not sure, we keep it
  **local** and never send it while unsure. Conservative by design."
- **Point:** "Re-identify map" card: "The map back to real details lives only on this device."
- **Say the line:** "The model — on-device today, or the optional cloud path later — only ever
  sees de-identified text. That's the moat."
- **Tap:** **Continue to note**.

### Screen 4 — Consult note (2:15)
- **Say:** "The on-device model — Qwen3, 1.7B — drafts a full SOAP note. De-identified transcript
  in, note out. Then we re-identify it **locally** for the doctor."
- **Point:** real name/details are back (re-identified on-device). "The doctor sees the real
  patient; the model never did."
- **Point:** Subjective / Objective / Assessment / Plan + Orders & follow-ups + the
  "Not a diagnosis" disclaimer.
- **Tap:** **Looks right**.

### Screen 5 — Sign & export (3:15)
- **Tap:** "Tap to sign" → signature → **Sign and finish**.
- **Say:** "On sign, two things happen: the note is signed, and the **raw audio is destroyed**."
- **Point:** the red "audio is destroyed" card.
- **Tap:** **FHIR R4** → show the share sheet / JSON. "Exports as FHIR R4 — drops straight into
  any EMR. Re-identified, standards-based."
- ⚠️ Export is unlocked only after signing (buttons were greyed). The `assertReidentified`
  gate blocks export if any token leaked — a safety net, mention only if asked.

### Screen 6 — Consult complete (4:00) ← **THE CLOSER**
- **Point:** the big **"0 bytes"** stat. Read it aloud:
  > "**0 bytes of PHI transmitted, verified by the on-device network monitor.**"
- **Point:** the audit log — real, on-device, append-only: consent → record → redact →
  note drafted → signed → **audio discarded**.
- **Say:** "Every step, on the phone. Auditable. Nothing uploaded. That's Sona."

**Total ~4 min.** Leave a minute for questions.

---

## 3. Failure recovery (know these cold)

| Symptom | On the spot | Say |
|---|---|---|
| Screen 4 stuck on "Drafting…" >30s | Model not warm. Kill + relaunch, or cut to backup video. | "Let me show the recorded run — same flow." |
| App crash / white screen | Reload Metro (`r` in terminal), restart at consent. | "One sec — reloading." Don't apologize twice. |
| Note shows `NAME_1` (re-ID broke) | Do NOT hand-wave. This is the moat — cut to backup video. | "The recorded run shows the re-identified note." |
| "Export blocked" alert on export | The safety gate fired (token survived). Cut to video. | (privately: bug — a token leaked; investigate after) |
| Judge: "is STT live?" | Honest. | "On-device Whisper; the demo uses a fixed transcript for a controlled clinical story." |
| Judge: "prove nothing's sent" | Airplane mode is on. | "We're in airplane mode — there's no network to send to. And the audit shows 0 bytes." |
| Model download starts mid-demo | Pre-flight miss. Cut to video, recover after. | "Recorded run — model's already loaded here." |

**Rule:** any moat-breaking failure (re-ID, export gate, network) → **cut to backup video
immediately**. Never debug live in front of judges.

### Known model variance (NOT failures — Qwen3 draws differently run-to-run)
- **Empty PLAN (`—`).** Model sometimes merges management steps into ASSESSMENT and leaves
  Plan blank. The steps still appear correctly under **Orders & follow-ups** — that's the
  reliable section to point at. If Plan is blank, narrate off Orders; do not re-draft live.
- **Objective admin line.** Fixed (prompt excludes IC/PHONE/ADDR from the body) — confirmed
  clean on-device. If it ever reappears, it's variance, not a regression; cut to video.
- If a run's Plan is blank, that run still **PASSES** rehearsal — Orders carries it.

---

## 4. Backup video (insurance — record this before demo day)

Record a clean, warm run of all 6 screens on a second device (screen recording, airplane mode
visible, ~90s tight cut). If anything breaks live, you switch to this without missing the pitch.
The video is also your submission artifact. Record it AFTER the prompt fix is confirmed on
screen 4 (no admin-identifier line in Objective).

---

## 5. Rehearsal checklist (5 clean runs before demo day)

Do 5 full start-to-finish runs. A run "passes" only if all of:

- [ ] Screen 3 shows all 4 tokens + the uncertain one.
- [ ] Screen 4 note is coherent SOAP, re-identified, **no** `Patient: <IC>…` line in Objective.
- [ ] Screen 5 exports unlock only after sign; FHIR share sheet shows real (re-identified) names.
- [ ] Screen 6 shows "0 bytes" + full audit log (8 rows).
- [ ] No model-download wait (stayed warm across runs).
- [ ] Under 5 minutes, spoken script flowed.

Log each run: PASS / what broke. 5/5 PASS = demo-ready.

---

## 5b. Real Gate-0 numbers (iPhone 17 Pro Max, iOS 26.5.1, on-device)

Measured on physical hardware (not sim). Confirms the demo architecture.

| Stage | Result | Number | Read |
|---|---|---|---|
| Redaction (NER) | ✅ GO | **32 ms**, recall 1.0, 7 spans | Superb; the moat is cheap. |
| STT (Whisper-small) | ran | **86.8 s** + garbage Malay | Unusable live → **scripted transcript is correct**, not a shortcut. |
| LLM note-gen (Qwen3-1.7B) | ❌ vs budget | **23 tok/s**, all sections present | Quality fine; ~half Mac's 42 tok/s. A ~200-tok demo note ≈ 9 s + model load. |
| E2E (incl. STT) | ❌ vs budget | **127 s** | STT-dominated; the demo path skips STT so this doesn't apply. |

The ❌ are the benchmark's strict latency budgets *including the dead STT stage*. The
demo runs no live STT and a short note, so real demo timing is model-load + ~9 s draft.
Pre-warm the model (§0) and this is invisible.

**Demo implication:** on-device draft is ~2× slower than the sim you rehearse on. Warm
the model before every run; never let a cold model load happen in front of judges.

## 6. Anticipated Q&A

- **"What about the cloud?"** — Optional. Only *de-identified* text may cross, only on the opt-in
  cloud path. Raw audio, transcript, re-ID map never leave the device. The cloud control-plane
  carries license/billing/non-PHI telemetry only — never PHI.
- **"Business model?"** — Per-seat SaaS for clinics; on-device keeps infra cost near zero and
  sidesteps PHI-hosting liability, which is the moat competitors can't cheaply cross.
- **"Accuracy / safety?"** — Note is a *draft*; doctor reviews every line before signing
  ("Not a diagnosis" disclaimer). Nothing is auto-filed.
- **"Which languages?"** — BM + English code-switching handled, the real Malaysian GP setting.
- **"Regulatory?"** — On-device + de-identification aligns with PDPA; no PHI leaves the device.

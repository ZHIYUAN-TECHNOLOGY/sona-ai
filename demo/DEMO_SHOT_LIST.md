# Sona — Demo Video Shot List (competition submission)

Target length: **~2:30**. Record in portrait, screen-record the iPhone (Settings →
Control Center → Screen Recording) or film over-the-shoulder for scenes that show
hands (signing, scanning). One continuous take per scene is fine; scenes are cut
together in the edit.

The narrative every scene must serve:
> **"A doctor's phone in airplane mode replaced a cloud scribe — in Malay, English
> and Chinese — and the patient's identity never left the device."**

## Pre-flight (do once, before any take)

1. Charge the phone; enable Do Not Disturb (no banners mid-take).
2. Open Sona → **Settings → Demo → Demo mode ON** (arms the scripted transcript,
   prefilled demo patient, and seeds the sample consult lists in one tap).
3. Confirm Settings → On-device AI shows the intended note model.
4. Control Center → **Airplane mode ON** — leave it on for the entire shoot; the
   airplane icon in the status bar is part of the story. Keep it visible.
5. Run one full rehearsal (scenes 3→9) before recording.

## Between retakes

- Settings → Demo → **Reset demo data**, then toggle **Demo mode** off/on (re-seeds).
- The consult transcript is scripted, so every take is identical; only the AI note's
  wording varies slightly take-to-take (that's real generation — it's honest, keep it).

## Shot list

| # | Scene | ~Time | What's on screen | Voice-over line |
|---|---|---|---|---|
| 1 | Hook — the problem | 0:00–0:15 | Doctor typing at night / stack of paper notes (acted or stock) | "Malaysian clinicians spend hours a day on notes — and cloud AI scribes can't be trusted with patient data." |
| 2 | **Airplane mode on** | 0:15–0:25 | Control Center → airplane ON → open Sona → Settings → On-device proof shows "Fully offline" | "Sona runs entirely on the phone. Watch — airplane mode, start to finish." |
| 3 | Consults home | 0:25–0:35 | Populated list: patient names, room / walk-in / phone chips, note previews, search bar | "A working clinic, all on-device." |
| 4 | Consent + patient details | 0:35–0:50 | Tap Record capsule → consent screen: spoken-consent card, prefilled patient (Encik Rahman), SOAP template picker | "Consent captured first. Patient details stay local." |
| 5 | **Live transcription** | 0:50–1:10 | Recording screen: live BM+EN transcript appearing, DR/PT speaker chips, Malay spans highlighted | "It understands Malaysian consultations — Malay, English, Mandarin, code-switched — transcribed and speaker-separated on the phone." |
| 6 | **Privacy gate** | 1:10–1:25 | End consult → redaction sweep: name / IC / phone wipe into color-coded tokens | "Before any AI sees a word, identifiers become tokens. The model never meets the patient." |
| 7 | **Note streams in** | 1:25–1:45 | Continue to note → draft text streaming live → finished SOAP note with clinical highlights | "A structured clinical note, written on-device in seconds." |
| 8 | Sign + audio destroyed | 1:45–2:00 | Draw signature with finger → "audio destroyed on sign" card → audit log, "0 bytes to cloud" pill | "Sign with a finger. The recording is destroyed; a tamper-evident hash remains." |
| 9 | **Smart Scan** | 2:00–2:20 | Smart Scan tab → "Try a sample document" → OCR result → tap **De-identified** toggle (color-coded tokens + legend) → Create document note → attach to consult | "Paper referrals too — scanned, de-identified, summarized. Still offline." |
| 10 | Close | 2:20–2:30 | 5-second montage: Knowledge sample-chip tap, FHIR/PDF export sheet, model list. Logo + tagline card | "Sona. The AI scribe that never lets patient data leave the room." |

**Bold scenes (2, 5, 6, 7, 9) are the money shots** — if the video must shrink,
cut scene 3 to five seconds and drop the montage in 10, never the bold ones.

## Filming notes

- **Never hide the status bar** — the airplane icon is the proof.
- Scene 6 (redaction sweep) is the emotional peak: hold on it a beat longer, don't
  cut mid-sweep.
- Scene 7: keep the streaming visible for 2–3 seconds before cutting ahead to the
  finished note; the materializing text is the "AI is really running here" moment.
- Scene 9: after tapping De-identified, slowly scroll so the colored tokens and the
  legend both get screen time.
- The AI is honest, not perfect — if a generated note has a small imperfection,
  prefer showing the clinician tapping Edit and fixing one line over re-taking for
  a flawless output. Judges trust a tool with a human-review step.
- Audio: record voice-over separately over the edit; don't rely on room audio.

## Demo aids reference (Settings → Demo)

| Control | What it does |
|---|---|
| **Demo mode** | Master switch: scripted transcript + prefilled patient + auto-seeded lists |
| Demo transcript | Scripted consult only (subset of Demo mode) |
| Seed demo data | Populate lists manually (4 fictional consults + 1 scan) |
| Reset demo data | Delete exactly the seeded rows — real consults untouched |

Everything in the video runs the real pipeline (real Whisper, real redaction, real
note model, real OCR) — the demo aids only make the *inputs* deterministic.

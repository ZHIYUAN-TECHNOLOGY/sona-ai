# Aurio — Competition Demo Video Plan

Target length: **2:30–3:00**. One continuous story: a Malaysian GP consult, start to signed
note, with the phone in **Airplane mode the whole time**.

## The winning frame (opening 15 seconds)

> "Malaysian clinics can't use AI scribes — patient data can't go to the cloud, and no cloud
> AI speaks Manglish. So we built one that needs neither."
>
> *(turn on Airplane mode, on camera)*

Judges must hear the three differentiators inside the first minute:
1. **Tri-lingual Malaysian speech** — Manglish + Malay + 中文 code-switch, on-device.
2. **Airplane-mode everything** — the entire pipeline with radios off.
3. **Medical AI on the phone** — "MedPsy, a medical model that outperforms Google's
   MedGemma on physician-graded benchmarks — running locally."

## Storyboard

| # | Scene | Time | Beats |
|---|-------|------|-------|
| 1 | Hook | 0:00–0:15 | Line above + Airplane toggle on camera |
| 2 | Consult | 0:15–1:00 | Record `MANGLISH_DEMO_SCRIPT.md` in two voices. End consult → transcript with real 中文 script. **Tap-edit one word on camera**: "the clinician verifies before any AI acts" |
| 3 | Privacy gate | 1:00–1:20 | Redaction screen: names/IC → tokens. "The AI never sees who the patient is. The re-ID key never leaves the secure enclave" |
| 4 | Note + sign | 1:20–1:45 | SOAP note lands (penicillin allergy captured). Sign → "raw audio destroyed — only the signed note and audit log remain." Flash the audit log |
| 5 | Smart Scan | 1:45–2:15 | Scan `synthetic-referral-letter.md` (PRINTED). Edge-detect wow → extracted text → "N identifiers redacted" → document note → attach to consult. "The photo is destroyed the moment text is extracted" |
| 6 | Close | 2:15–2:30 | "Whisper, MedPsy, redaction — all on a phone in airplane mode. Aurio: clinical AI that never asks Malaysians to trade privacy for care" |

## The honest-impression playbook ("AI isn't 100% accurate")

**Never** fake an output the app didn't produce — a judge who probes and can't reproduce it
sinks the entry. All of the below is standard, legitimate demo craft:

1. **Multiple takes, keep the best.** A real run selected from four takes is still a real run.
2. **Control inputs.** Print the demo documents. Printed text = Vision OCR ~98%. Never demo
   handwriting.
3. **Speak for the mic.** ~15 cm away, ½-second pause before 中文 phrases, distinct voices
   per role.
4. **Turn flaws into features.** A misheard word gets FIXED on camera — that's the
   human-in-the-loop story, not a blooper.
5. **Cut waiting, not results.** "Seconds later, on-device" caption over a cut is honest;
   never cut from input to a result the app didn't generate from it.
6. **Pre-warm.** All models downloaded before recording; one signed consult already in
   history so lists look alive.

## Recording setup

- iPhone via cable → QuickTime screen record (crisp, no compression), **Do Not Disturb on**
- Voiceover recorded separately, laid over in the edit
- Phone brightness ~80%, light theme, battery >50% so the indicator looks healthy
- B-roll: hands + phone + printed letter on a clinic-ish desk

## Pre-flight checklist (morning of recording)

- [ ] Airplane mode works end-to-end (STT model + MedPsy + tokenizer all cached on device)
- [ ] Best-accuracy STT shows "Ready on-device" (Settings → AI models)
- [ ] Note AI (MedPsy-1.7B) shows "Ready on-device"
- [ ] Demo consult rehearsed 3× with the pause-before-中文 tip
- [ ] Referral letter printed cleanly (no toner banding)
- [ ] One older signed consult exists in the app
- [ ] Disk >5GB free on phone, Do Not Disturb on

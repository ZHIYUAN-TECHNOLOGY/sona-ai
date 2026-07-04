# Locked Demo Consult — the fixed input the whole demo is tuned against

> Written 2026-07-05. Companion to `plans/2026-07-05-sona-5day-ondevice-demo-build.md`.
> This is the **single locked consult** used for the reproducible 5/5 demo run. STT accuracy, the
> redaction test set, the LLM prompt few-shot, and the Gate-3 note-quality bar are all measured
> against THIS input. Do not change it after Day 2 without re-tuning everything downstream.
>
> All names, IC, phone, and address below are **fabricated** for the demo. Any resemblance to a real
> person is coincidental. This is synthetic test data, not a real patient encounter.

## Scene

General practice follow-up, ~90 seconds spoken. A 58-year-old man returns for a cough that has not
settled. Malay + English code-switching, the way a real Malaysian GP room sounds. Two speakers
(doctor, patient). One informal third-party name is mentioned to exercise the low-confidence redaction path.

## Transcript (record this, verbatim, ~90s)

**Dr:** Morning Encik Rahman, apa khabar? How's the cough today?
**Pt:** Doktor, masih ada. Demam dah tiga hari, malam lagi teruk.
**Dr:** Okay. Batuk berkahak, or dry?
**Pt:** Berkahak, warna kuning. Sikit sikit sesak bila batuk kuat.
**Dr:** Any chest pain? Sakit dada bila tarik nafas?
**Pt:** No chest pain, doktor. Just the cough.
**Dr:** Alright. Let me just confirm your details. IC still five-eight-zero-two-one-four, zero-five, five-three-two-one?
**Pt:** Yes, betul. Five-eight-zero-two-one-four-zero-five-five-three-two-one.
**Dr:** And the best number to reach you? The nurse might call for the follow-up.
**Pt:** Zero-one-two, three-four-five, six-seven-eight-nine.
**Dr:** Good. Still staying at No. 12, Jalan Melati, Taman Sri Muda?
**Pt:** Yes doktor, sama. Kalau nurse datang, cari Kak Timah kat rumah, dia ada.
**Dr:** Noted. Let me examine you. Temperature is thirty-eight point two, pulse ninety-two, oxygen ninety-seven percent. Throat a bit red, chest is clear.
**Pt:** Serious ke doktor?
**Dr:** Tak serious. Looks like a viral upper respiratory infection. No red flags.
**Dr:** I'll give you paracetamol for the fever, one gram, four times a day when needed. Banyak minum air, rest.
**Pt:** Okay doktor.
**Dr:** Come back in one week kalau tak baik. If the fever doesn't settle we'll do a blood test, FBC. And come back straight away kalau you feel very breathless, okay?
**Pt:** Baik, terima kasih doktor.

## Embedded PII (redaction targets)

| Span in transcript | Type | Redaction token | Confidence | Notes |
|---|---|---|---|---|
| Encik Rahman | name | `NAME_1` | high | full name; also the re-ID map entry |
| 580214-05-5321 (spoken as digits) | national IC | `IC_1` | high | spoken twice; STT must join digit groups |
| 012-345 6789 (spoken as digits) | phone | `PHONE_1` | high | Malaysian mobile format |
| No. 12, Jalan Melati, Taman Sri Muda | address | `ADDR_1` | high | partial address |
| Kak Timah | informal name | `NAME_UNCERTAIN_1` | **low** | drives the "1 uncertain, tap to confirm" flow |

**Re-identify map (device-only, never leaves):**
`NAME_1 → Rahman bin Ismail` · `IC_1 → 580214-05-5321` · `PHONE_1 → 012-345 6789` · `ADDR_1 → No. 12, Jalan Melati, Taman Sri Muda, Shah Alam` · `NAME_UNCERTAIN_1 → Kak Timah` (held pending clinician confirm)

## Gold SOAP note (Gate-3 target — the note should read close to this)

**Subjective:** 58-year-old man, 3 days of fever, worse at night. Productive cough with yellow sputum, mild
exertional breathlessness on coughing. No chest pain. (History given in Malay and English.)

**Objective:** Temp 38.2 °C, HR 92, SpO₂ 97% on room air. Throat erythematous. Chest clear.

**Assessment:** Acute upper respiratory tract infection, likely viral. No red flags.

**Plan:** Symptomatic management. Paracetamol 1 g QID PRN for fever. Encourage oral fluids and rest.

**Orders & follow-ups:**
- Review in 1 week if symptoms persist.
- FBC if fever does not settle.
- Safety-net: return immediately if significantly breathless.

## Redaction test set (Day-2 asserts)

Recall target on this consult: **all 4 high-confidence identifiers removed (4/4)**; the 1 low-confidence name
surfaced for confirmation, never silently sent. The de-identified transcript that reaches the note model must
contain `NAME_1 / IC_1 / PHONE_1 / ADDR_1` and must NOT contain "Rahman", "580214", "012", "Jalan Melati",
or the raw digit strings.

Edge cases this consult intentionally exercises:
- IC and phone are **spoken as digit sequences**, not written — STT + redactor must catch the joined form.
- One identifier (`Kak Timah`) is **ambiguous** — must route to the low-confidence path, not auto-redact or auto-send.
- Code-switching mid-sentence — STT must transcribe both languages; the note comes out in English.

## Recording notes

- Two distinct voices (doctor, patient). Natural pace. ~90 seconds.
- Quiet room, phone mic at normal consult distance.
- Save as the locked demo asset; the live-mic encore uses the same script read aloud.

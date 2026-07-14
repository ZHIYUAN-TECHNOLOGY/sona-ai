# Aurio — Demo Consult Script

Read this aloud (≈75s) so the on-device STT transcribes a real consult that exercises
**every** feature: diarization, redaction, red-flag highlighting, and medication safety.

## How to use it
1. Settings → **Demo transcript** = **OFF** (real mode).
2. **Record** → read the script below.
3. **Two distinct voices** — make the Doctor and Patient sound different (pitch/pace) so
   diarization separates them cleanly.
4. Speak **clearly, ~15s+**, phone near your mouth.
5. **End consult** → "Who spoke?" → label Speaker 1 = **Doctor**, Speaker 2 = **Patient**.
6. Continue → Privacy gate → Note.

> Tip: two people reading is best. Solo? Just change your voice between the two roles —
> diarization will still cluster the two timbres.

---

## The script

**Doctor:** Good morning, Encik Rahman. Apa khabar? How is the cough today?

**Patient:** Masih ada, doktor. Demam dah tiga hari, and at night it gets worse.

**Doctor:** Batuk berkahak, or dry? Any phlegm?

**Patient:** Berkahak, warna kuning. Sikit sesak bila batuk kuat.

**Doctor:** Any chest pain? Sakit dada bila tarik nafas?

**Patient:** No chest pain, doktor. Just the cough, and a bit breathless.

**Doctor:** Let me confirm your details. IC five-eight-zero-two-one-four, dash zero-five, dash
five-three-two-one. And phone zero-one-two, three-four-five, six-seven-eight-nine?

**Patient:** Yes, betul. I stay at Number 12, Jalan Melati, Taman Sri Muda, Shah Alam.

**Doctor:** Temperature 38.2, pulse 92, oxygen 97 percent. Throat red, chest clear.

**Doctor:** Looks viral. I'll give paracetamol one gram, four times a day. Review in one week,
FBC if not better, and come back immediately if you get very breathless.

**Patient:** Okay doktor, terima kasih.

---

## What each part demonstrates

| Line | Feature it triggers |
|---|---|
| "Encik Rahman", IC 580214-05-5321, phone 012-345 6789, address | **Redaction** → `NAME_1`, `IC_1`, `PHONE_1`, `ADDRESS_1` on the privacy gate |
| "sesak", "a bit breathless", "very breathless" | **Red-flag highlight** (breathlessness) in the note |
| "Demam dah tiga hari", "warna kuning", vitals 38.2 / 92 / 97% | Objective / symptoms captured in **SOAP** |
| "paracetamol one gram, four times a day" | **Dose highlight** + **Medication safety** card |
| BM + EN mix | Multilingual **Whisper** + code-switch handling |
| Two voices | On-device **diarization** → "Who spoke?" labeling |

## Notes
- First real run downloads Whisper once (needs Wi-Fi) — after that it's offline.
- Real STT is batch: it transcribes when you tap **End consult** (not live during recording).
- Speaker separation is approximate (mock embedder) — but **you label** the speakers, so
  attribution is correct regardless. A real ECAPA `.pte` makes auto-separation accurate.
- Prefer the fast, deterministic path for a high-stakes demo? Flip **Demo transcript = ON**
  and it replays this exact consult as a scripted stream.

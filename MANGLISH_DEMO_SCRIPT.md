# Aurio — Manglish STT Demo Script (Malay + English + 中文)

Read this aloud into **Settings → STT test (Malaysian Whisper)** (or a real consult) to show
the on-device Malaysian Whisper handling true Malaysian code-switch — Malay + English + Mandarin,
even mixed **within a single sentence**.

## How to use
1. On the phone: **Settings → STT test (Malaysian Whisper)**.
2. Tap the **mic** → wait for "Recording".
3. Read a few lines below **clearly**, phone near your mouth (~15–30s is enough).
4. Tap **stop** → the transcript + detected language + on-device time appear.
5. For the full flow instead: **Record** a consult → read both roles → **End** → "Who spoke?".

> First STT run downloads the 190MB model from Metro (one-time, ~1–2 min). After that it's instant.
> Language = **Auto-detect** (Settings) handles the mixing; no need to pick a language.

> **Speaking tip for 中文 phrases:** take a brief half-second pause before switching into
> Mandarin (e.g. before 今天哪里不舒服). The pause gives the recognizer its own segment for the
> Chinese phrase, so it comes out in real 中文 script instead of romanized English. Mid-sentence
> switches without a pause may romanize — just tap the line to fix.

---

## The script (a short Manglish clinic consult)

**Doctor:** Good morning, Encik Tan. Apa khabar? 今天哪里不舒服?

**Patient:** Doctor, saya batuk sudah one week lebih. 喉咙很痛, cannot sleep at night.

**Doctor:** Ada demam tak? Any fever ah? 有没有发烧?

**Patient:** Semalam ada, like 38 degree. Then I makan Panadol, sikit better lah.

**Doctor:** Okay. Chest pain ada tak? Susah nak bernafas? 呼吸困难吗?

**Patient:** Chest okay, but sometimes 头晕 sikit, especially bila I stand up fast.

**Doctor:** Alright, saya check your throat. 张开嘴巴, say "ah". Looks like throat infection. I give you antibiotic, makan tiga kali sehari after food.

**Patient:** Doctor, I allergy to penicillin leh. 我对青霉素过敏.

**Doctor:** Oh, penting itu — terima kasih for telling me. Okay I change to another one. Kalau demam tak turun in three days, come back ya. 多喝水, rest more.

---

## What it shows
- **Tri-lingual code-switch:** Malay + English + Mandarin, including mid-sentence (`喉咙很痛, cannot sleep`).
- **Clinical content:** symptoms (batuk, demam, 头晕/dizzy), a red-flag sweep (chest pain, breathing), meds (Panadol, antibiotic).
- **Safety:** a **penicillin allergy** stated in Malay+Mandarin (`我对青霉素过敏`) — the kind of line a generic English model would miss.
- **PII:** patient name (Encik Tan) for the redaction step in the full flow.

## Shorter version (quick STT bench, ~10s)
> Good morning, Encik Tan. Apa khabar? Saya batuk sudah one week, 喉咙很痛. Ada demam sikit, I makan Panadol. Doctor, I allergy to penicillin — 我对青霉素过敏.

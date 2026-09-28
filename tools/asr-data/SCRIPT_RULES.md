# Manglish consultation script rules

Rules for writing the synthetic consultations in the [ASR training plan](../../docs/asr-training-plan.md). Every script is fictional.

## Shape

- One Malaysian clinic consultation: a doctor and one patient (or a parent speaking for a child).
- 12–18 turns, about 2–4 minutes spoken. One turn is one or two sentences; keep turns under about 40 words.
- Adapted, not translated, from an English source conversation (nisten/opus5-5-doctor-patient-conversations-all-human-diseases, ACI-Bench, MTS-Dialog or PriMock57). Move US hospital settings to Malaysian clinics and hospitals.

## Language mix (per turn, across a batch)

| Share | Pattern |
| --- | --- |
| ~30% | One language only |
| ~50% | One main language with 1–3 words from another (medical terms, numbers, days) |
| ~20% | Heavy mixing |
| ≤ 5% | All three languages in one sentence |

Realistic, never overly code-switched. Mandarin in simplified characters; Malay in Malaysian spelling (colloquial "tak", "dah", "je" allowed); English as spoken in Malaysia.

## People

- Patients vary: Malay-dominant, Chinese-dominant (Malaysian Mandarin), English-dominant (including Malaysian Indian). Vary age (children via a parent, adults, elderly), gender and region (Klang Valley, Penang, Johor, Ipoh, Kelantan, Sabah, Sarawak).
- The doctor leans English and switches toward the patient's language.
- Particles (lah, lor, meh, ah, leh) sparingly, more from patients than doctors.
- Fictional names only. No real people, clinics named after real people, or phone numbers.

## Clinical content

- Drugs as used in Malaysia: mostly generic names, occasional brands (Panadol, Ventolin, Uphamol, Zyrtec). Doses in mg or ml, frequencies spoken naturally ("twice a day", "sehari dua kali", "一天两次").
- Numbers spoken in any of the three languages: blood pressure, glucose, temperature, days, ringgit.
- Keep drug names and doses plausible; they are what the model most needs to hear right.

## Output

JSON list of objects: `{"id", "split": "train"|"test", "condition", "source", "patient_persona": {"description", "gender": "male"|"female", "dominant_language"}, "doctor_persona": {"description", "gender"}, "turns": [{"speaker": "Doctor"|"Patient", "text"}]}`. Persona descriptions: age, gender, background, voice. About 1 in 20 conversations is `"split": "test"`.

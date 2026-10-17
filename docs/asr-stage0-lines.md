# Stage 0 test lines

Twenty short consultation turns for the [ASR training plan](asr-training-plan.md#stage-0-engine-check-half-a-day). Each line mixes English, Malay and Mandarin, which is deliberately harder than the training mix. The text below is also the exact reference transcript for scoring. Everything is fictional.

Most speakers are Malaysian Chinese, since three-language mixing is most natural for them; the Malay-dominant uncle uses only common Mandarin words.

## Voices

Designed from text descriptions (VoxCPM2 puts the description in parentheses before the text).

| ID | Role | Voice description |
| --- | --- | --- |
| D | Doctor | Malaysian Chinese man in his 40s, calm, clear, moderate pace |
| P1 | Patient | Malaysian Chinese woman in her 60s, slightly hoarse, speaks quickly |
| P2 | Patient | Malaysian Malay man in his 50s, deep voice, relaxed pace |
| P3 | Patient | Malaysian Chinese woman in her 20s, light voice, fast |
| P4 | Patient | Malaysian Chinese man in his 60s, gravelly, slow |
| P5 | Parent | Malaysian Chinese mother in her 30s, worried, fast |

## Lines

| # | Speaker | Text | Tests |
| --- | --- | --- | --- |
| 1 | P1 | Doctor, 我这个 batuk 已经 three days 了, malam 咳到睡不着 lah. | 咳 vs 课, batuk vs patuk, switch into Mandarin |
| 2 | D | OK auntie, ada demam tak? 有没有发烧? Phlegm got or not? | Question in all three languages |
| 3 | P1 | 有 kahak, 黄色的, pagi lagi banyak. Last night 我 makan paracetamol 两粒. | Drug name, Mandarin count word |
| 4 | D | Paracetamol boleh, but jangan lebih dari 八粒一天 ya, maximum four grams. | Dose limit, numbers in two languages |
| 5 | P2 | Doktor, dada saya 有点痛 when I breathe in deep, sudah dua hari. | Malay speaker using Mandarin |
| 6 | D | Uncle, saya dengar paru-paru dulu. 深呼吸, tarik nafas... OK, can breathe out now. | Instruction switching |
| 7 | D | Your X-ray show pneumonia sikit di right lower lobe, 不用太担心. | Medical terms, Malaysian grammar |
| 8 | D | I give you azithromycin 500mg, 一天一次, makan tiga hari. | Drug name, dose, frequency |
| 9 | P3 | Can I take it with my cetirizine? 我有 allergy, hidung selalu tersumbat. | Drug name, Malay symptom |
| 10 | D | Boleh, no problem. 但是 kalau ada rash atau bengkak, come back immediately. | Warning signs |
| 11 | P4 | Doctor, my sugar reading pagi tadi 十二点五, 是不是很高? | Mandarin decimal number |
| 12 | D | Ya, 十二点五 tinggi sikit. Metformin you makan 几次 sehari? | Drug name, repeated number |
| 13 | P4 | Metformin 两次, tapi kadang-kadang lupa makan the night one lah. | Adherence, particle |
| 14 | P5 | Ventolin inhaler tu anak saya guna 三次 last night, still wheezing. | Brand name, Mandarin count |
| 15 | D | Salbutamol OK, but kalau lebih dari 四次 sehari, 要马上 bawa pergi emergency. | Generic name, urgent advice |
| 16 | P3 | Since semalam cirit-birit 五次, 肚子 very pain, 吃不下 anything. | Malay symptom, Malaysian English |
| 17 | D | Minum banyak air, oral rehydration salts ya. 不要吃 oily food 先. | Treatment, word order |
| 18 | P1 | Doctor, 血压药 amlodipine 我 finish already, boleh tambah lagi? | Drug name inside Mandarin |
| 19 | D | Boleh, 我给你 amlodipine 5mg, one month supply, makan setiap pagi. | Dose, duration |
| 20 | D | OK auntie, kalau batuk 没有好, three days 后 come back for review ya. | Follow-up, 咳/batuk context |

Drug names covered: paracetamol, azithromycin, cetirizine, metformin, Ventolin, salbutamol, oral rehydration salts, amlodipine.

## Scoring sheet

For each engine, the user rates every line 1–5 for naturalness and flags any line where Mandarin is not spoken as Mandarin. Base Qwen3-ASR then transcribes each clip, scored against the text above.

| Engine | Average naturalness | Lines with Mandarin not spoken as Mandarin | Base ASR mixed error rate | Base ASR drug names correct | Kept? |
| --- | --- | --- | --- | --- | --- |
| VoxCPM2, whole sentence | 2.85 | 19 of 20 | 45% (inflated: the audio itself was wrong) | 5 / 11 | No |
| MOSS-TTS-v1.5 | Not rated: the user judged it unusable | — | 58% | 1 / 10 | No |
| VoxCPM2, stitched per language | Not rated | — | 57% | 3 / 11 | No |
| Gemini 3.8 Flash TTS | 3.7 (19 lines rated: four 5s, eight 4s, seven 3s; line 15 unrated) | 0 of 19 (no wrong words ticked in any language) | 44% | 6 / 11 | **Yes** |
| Scicom | Not rated: the user judged it unusable | — | 56% | 5 / 11 | No |

Results from 27 September 2026. VoxCPM2 read the Mandarin parts with Malay or English sounds in 19 of 20 lines. Scicom and MOSS were dropped after listening. Gemini 3.8 Flash TTS passed and becomes the synthetic audio engine (see the [ASR training plan](asr-training-plan.md#audio)).

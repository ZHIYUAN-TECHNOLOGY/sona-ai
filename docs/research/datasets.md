# Dataset catalogue for the Manglish ASR fine-tune

Researched 2026-09-27. This note accompanies [`datasets.csv`](datasets.csv). It builds on [`asr-training-data.md`](asr-training-data.md) and does not repeat it: rows for ACI-Bench, MTS-Dialog, PriMock57, Fareez OSCE, the nisten sets, SEAME, CS-Dialogue, mesolitica and IMDA NSC cite that note's findings [S1]. Anything I could not confirm from a primary source is marked **unverified**.

## Question

Which datasets can legally be used to fine-tune Qwen3-ASR-1.7B for Manglish clinical consultations? Manglish here means Malaysian English mixed with Malay and Mandarin. The note also asks which text sources can seed the synthetic scripts.

## Method

1. **Hugging Face Hub API** (`huggingface_hub` 1.8, anonymous) [S2]:
   - Task categories `automatic-speech-recognition` and `text-to-speech`, crossed with languages `ms` and `zh`, sorted by downloads.
   - The same for `en`, keeping only IDs or tags that match Malaysia, Singapore, Southeast Asia or medical terms.
   - Keyword searches: malay, malaysia, manglish, code-switch, codeswitch, singlish, medical, clinical, doctor patient, consultation, bahasa, singapore, nusantara.
   - These returned **1,864 unique repositories**. Most were off-topic, for example Malayalam, generic medical QA and image sets.
2. **Screening.** I kept the repos that were actually relevant and read the card (README) of **86** of them. I also checked the LICENSE file wherever the repo had one.
3. **Outside Hugging Face:**
   - Mozilla Data Collective, the new home of Common Voice [S3].
   - Google FLEURS [S4].
   - The OpenSLR catalogue and resource pages [S5].
   - The IMDA NSC paper and the Singapore Open Data Licence [S6][S7].
   - The WenetSpeech terms [S8].
   - data.gov.my [S9].
   - Malaya-Speech [S10].
   - arXiv papers on Malay–English code-switching and on synthetic medical dialogue [S11][S12][S13].
4. **Licence gate** (applied to the `commercial_ok` column):
   - `yes` only for CC0, CC BY, CC BY-SA, MIT or Apache-2.0.
   - `unclear` for a missing tag, a tag that contradicts the card, or a permissive tag placed on third-party audio (YouTube, audiobooks, news).
   - `no` for NC, ND or vendor terms.
   - Every `unclear` or `no` row is `use=reject`. The status note says where eval-only use is possible and needs a decision.
   - A script asserts this consistency when it writes the CSV.
5. **Exclusions.** Anything that looks like real patient data is excluded: scraped online consultations, "de-identified" or "PII-redacted" clinical audio. I downloaded no audio.

## Counts

| | Rows |
|---|---|
| Raw Hub hits | 1,864 |
| Catalogued in `datasets.csv` | **101** |
| `commercial_ok = yes` | **39** |
| `commercial_ok = unclear` | 38 |
| `commercial_ok = no` | 24 |
| Recommended (`use = train`) | 26 |
| Recommended (`use = eval`) | 7 |
| Rejected | 68 |

Six `yes` rows are still rejected: three duplicates, one in the wrong languages, one off-topic and one of very low value. The other 33 `yes` rows are recommended.

## Top 10 for Sona

Ranked by value to a Manglish clinical ASR model, not by size. Licences are checked against the card, LICENSE file or official page.

| # | Dataset | Licence | Size | Why |
|---|---|---|---|---|
| 1 | **Fareez OSCE** (figshare) | CC0 [S1] | ~55 h | The largest real-speech consultation audio with no strings attached. |
| 2 | **PriMock57** | CC BY 4.0 [S1] | 8 h 38 m | Real two-channel consultations. Best held-out medical-English test. |
| 3 | **ACI-Bench + MTS-Dialog** (text) | CC BY 4.0 [S1] | 207 encounters + 1.7k dialogues | Clean-licence consultation scripts to rewrite into Manglish. |
| 4 | **Google FLEURS** `ms_my` + `cmn_hans_cn` | CC BY 4.0 (card YAML and text) [S4] | ~10 h train per language | The only openly licensed, human-read *Malaysian* Malay audio of any size. Also a standard test split. |
| 5 | **CAiRE/ASCEND** | CC BY-SA 4.0 (card text) [S14] | 10.62 h | Real spontaneous Mandarin–English code-switched conversation. Hong Kong, not Malaysia. Share-alike binds the data and derived data; get legal sign-off on model weights. |
| 6 | **Synth-DoPaCo / BeTraC 2026** | CC BY 4.0 (card) [S15] | 7,600 dialogues; release totals 1,329 h [S13] | Long-form synthetic consultations with overlap, room acoustics and noise, made with open weights (Qwen3-TTS). The text comes from Gemma 3, so Gemma terms apply. The arXiv page shows CC BY-NC-ND, probably the paper's own licence; confirm. |
| 7 | **Common Voice**: Spontaneous Speech Bahasa Malay + zh-CN | CC0 [S3] | 125.94 MB Malay (hours unverified) | Spontaneous Malaysian Malay with no restrictions. Download from Mozilla Data Collective, not the old HF mirrors. |
| 8 | **AISHELL-1 / AISHELL-3** | Apache-2.0 (OpenSLR pages) [S5] | ~178 h (unverified) / ~85 h | Clean Mandarin volume and TTS speaker variety, to protect Mandarin after fine-tuning. |
| 9 | **SaLTUNIMAS Sarawak Malay + SEACrowd sarawak_malay** | CC BY 4.0 / CC0 (LICENSE file) [S16] | ~1.9 h, 42 speakers | Real conversational Malaysian speech from UNIMAS. Use as an eval slice for Malaysian accent robustness; it is dialectal. |
| 10 | **emhaihsan/Synth-Manglish** | CC BY 4.0 (card) [S17] | 2,457 clips | The only permissively licensed audio labelled Manglish. It is fully synthetic: Gemini text, Scicom TTS with no licence tag, ElevenLabs reference voices. Use it as a TTS baseline and style seed, not as ground truth. |

Also worth keeping for eval:
- **Scicom-intl/Whisper-Hallucination** "genuine" (12.4 h of CC BY sources) catches the "terima kasih" hallucinations [S17].
- **ekacare** (MIT) and **Trelis/medical-terms-2025** (MIT) measure drug-name WER.
- **TonicAI/synthetic_clinical_conversations** (Apache-2.0) is the best new source of script seeds.

## Rejected but notable

| Dataset | Why rejected | What would unblock it |
|---|---|---|
| **IMDA NSC** (incl. Part 4 Malay–English code-switch; the yyhenggg filtered copy has 11 h of Malay–English code-switching) | Licence is the Singapore Open Data Licence v1.0. The 2019 paper says "available for public and commercial use… under the Singapore Open Data License" [S6], and SODL permits commercial use and adaptation with attribution [S7]. But SODL is not on our whitelist, and the terms for Part 4 onwards are unverified. | A licence decision on SODL, then confirmation of the Part 4 terms from IMDA. **Highest-value unlock.** |
| **Revolab ASR-Benchmark-Public** (2.2 h, Malaysian, code-switched) | The annotations are CC BY, but the audio is "subject to original terms". | Eval-only use; needs a decision. The FLEURS and Common Voice subsets inside it are clean. |
| **BabelSpeech 50 h Malay colloquial** (code-switched) | The Apache tag sits on audio whose filenames show YouTube sources. | Written provenance from the vendor. |
| **mesolitica / malaysia-ai** (Malaysian-Emilia ~7,000 h, dialects 68k h, Malaysian-STT) | NC or no licence; YouTube-derived. | A commercial licence from mesolitica. |
| **MultiMed** (en 108.7 h, zh 6.2 h medical) | MIT tag, but the audio is YouTube medical channels used under a fair-use claim [S12]. | Eval-only use; needs a decision. |
| **SEAME, CS-Dialogue, MAGICDATA, MagicHub Malay, Speech-data Malay 166 h** | NC or NC-ND. | Eval-only use; needs a decision. |
| **WenetSpeech** (10k h) | OpenSLR says CC BY 4.0, but the official site limits it to "non-commercial purposes" [S8]. | None. |
| **DataoceanAI King-ASR-223/244** (651.8 h + 400 h Malay conversational) | Paid vendor data. | A quote, if real Malay volume matters more than cost. |
| **Scraped consultations** (MedDialog, Chinese-medical-dialogue, Huatuo, ai-medical-chatbot) and "de-identified" clinical audio | Real patient content. | None. Excluded by policy. |
| **jona276/manglish-asr-benchmark** | "Manglish" here means Malayalam–English. | None. It is a name clash. |

## Gaps

1. **No permissively licensed real Manglish audio.** No dataset has real Malaysian English–Malay–Mandarin code-switched speech under a whitelisted licence. The closest are NSC Part 4 (Singaporean, SODL, pending), BabelSpeech (provenance) and Revolab (eval only). This confirms the conclusion of [S1]: our own recordings plus synthetic audio remain the core.
2. **No Malaysian medical audio of any licence.** Every consultation audio set is UK, North American, Indian or synthetic.
3. **Little Malaysian Mandarin.** Open Mandarin corpora are mainland or Hong Kong. Malaysian Mandarin appears only in NC or unlicensed YouTube sets such as `malaysia-ai/mandarin-youtube`.
4. **data.gov.my.** I found no speech datasets there. The portal's CC BY licensing does not help [S9].
5. **Unverified fields.** Hours for Common Voice Malay, AISHELL-1, THCHS-30, AISHELL-4, AliMeeting, yodas2 `ms` and Synth-Manglish. Also the Common Voice Sabah licence, the licence file of DOTA-ME-CS, and the NSC Part 4 terms.

## Sources

- [S1] Sona research note: [`docs/research/asr-training-data.md`](asr-training-data.md) (licences for ACI-Bench, MTS-Dialog, PriMock57, Fareez, nisten, SEAME, CS-Dialogue, mesolitica and NSC)
- [S2] Hugging Face Hub API: https://huggingface.co/docs/huggingface_hub ; dataset cards at https://huggingface.co/datasets/<id>
- [S3] Mozilla Data Collective, Asian-language datasets: https://community.mozilladatacollective.com/latest-asian-language-datasets-by-communities-on-mozilla-data-collective/ ; Sabah Malay: https://mozilladatacollective.com/datasets/cmmytmz7k00fxnz07yj3lastx
- [S4] Google FLEURS card: https://huggingface.co/datasets/google/fleurs
- [S5] OpenSLR: https://www.openslr.org/resources.php ; SLR18 https://www.openslr.org/18/ ; SLR33 https://www.openslr.org/33/ ; SLR93 https://www.openslr.org/93/ ; SLR111 https://www.openslr.org/111/ ; SLR119 https://www.openslr.org/119/ ; SLR38/47/68/123 (NC-ND)
- [S6] Koh et al. 2019, Building the Singapore English National Speech Corpus: https://www.isca-archive.org/interspeech_2019/koh19_interspeech.pdf
- [S7] Singapore Open Data Licence v1.0: https://data.gov.sg/open-data-licence
- [S8] WenetSpeech terms: https://wenet-e2e.github.io/WenetSpeech/
- [S9] data.gov.my catalogue: https://data.gov.my/data-catalogue
- [S10] Malaya-Speech datasets: https://malaya-speech.readthedocs.io/en/latest/Dataset.html
- [S11] AsyncSwitch (Malay–English code-switching; corpora used): https://arxiv.org/abs/2506.14190 ; DOTA-ME-CS: https://arxiv.org/abs/2501.12122
- [S12] MultiMed paper (YouTube source, hours): https://arxiv.org/abs/2409.14074
- [S13] Synthetic doctor–patient conversations for long-form summarisation (BeTraC; Gemma3-27B, Qwen3-TTS-1.7B, 1,329 h): https://arxiv.org/abs/2604.06138
- [S14] ASCEND card: https://huggingface.co/datasets/CAiRE/ASCEND
- [S15] Synth-DoPaCo card: https://huggingface.co/datasets/Play-Your-Part/Synth-DoPaCo ; https://huggingface.co/datasets/BeTraC/betrac-2026
- [S16] Sarawak Malay: https://huggingface.co/datasets/SaLTUNIMAS/sarawak-malay-asr ; https://huggingface.co/datasets/SEACrowd/sarawak_malay/blob/main/LICENSE
- [S17] Synth-Manglish: https://huggingface.co/datasets/emhaihsan/Synth-Manglish ; Whisper-Hallucination (incl. `malaysian_sources` survey of 24 Malaysian sets): https://huggingface.co/datasets/Scicom-intl/Whisper-Hallucination

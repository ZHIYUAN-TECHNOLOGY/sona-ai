# Speech models for Sona

Researched 2026-09-24. Primary sources only (model cards, vendor docs and blogs, papers, GitHub READMEs). Every claim links to its source in the list at the end, given as `[S#]`. Anything I could not confirm from a primary source is marked **unverified**.

## Question

Which open-weight, self-hostable speech models should Sona use for its ambient scribe? The scribe records a doctor–patient consultation, transcribes it, labels the speakers and drafts a clinical note. Sona also needs short voice commands and optional voice output. English comes first. Malaysian code-switching (Malay-English, Mandarin-English and all three together) is a stretch goal. Baseten is the intended GPU host.

The PRD candidates were Qwen3-ASR-1.7B, Malaysian Whisper (mesolitica), a separate diarization component and an optional TTS model.

## Released this month and today

- **Today (2026-09-24):** I found no new ASR or TTS model from a major lab released today. Confucius4-R2T2 (NetEase Youdao, 2B) is trending on Hugging Face today [S1]. It is a streaming ASR model built on the Qwen3-ASR architecture. Its weights use a custom NetEase licence, its focus is Chinese and English, and it does not support Malay [S2]. It does not affect the recommendations. If the user has a specific model from today in mind, ask for its name.
- **2026-09-23 (yesterday): NVIDIA Nemotron 3 Diarization.** A 100M-parameter model under OpenMDW 1.1, which allows commercial use. It tracks up to 8 speakers in streaming or offline mode [S3]. Baseten added it to its library the same day [S4][S5]. It is now the leading diarization candidate.
- **2026-09-03: Microsoft VibeVoice-ASR-Streaming (1.5B and 7B).** Streaming transcription with speaker labels and hotwords, MIT licence, 10 languages. Malay is not one of them [S6][S7].
- **2026-09-04: MedWER paper.** A reproducible way to measure accuracy on medical terms, with results for MedASR, Whisper and Moonshine [S8]. Useful for our baseline test.

## TL;DR recommendations

| Sub-capability | Pick | Runner-up | Why |
|---|---|---|---|
| 1. Streaming / short-command STT | **Qwen3-ASR-1.7B Streaming** (Baseten library) | Nemotron 3.5 ASR Streaming 0.6B | Qwen3-ASR is the PRD choice, covers Malay and Mandarin, accepts context terms and has a ready Baseten WebSocket preset. Nemotron 3.5 has lower latency (80 ms chunks) but no Malay. |
| 2. Long-form ambient transcription | **Qwen3-ASR-1.7B** (batch, up to 20 min per pass) | **MOSS-Transcribe-Diarize 0.9B** (transcription and speakers in one model, up to 90 min) | Both are Apache 2.0 and in the Baseten library. MOSS removes the separate diarization step, but its Malay support is unverified. |
| 3. Malay / Mandarin / English code-switching | **MERaLiON-3-3B-ASR** | mesolitica malaysian-whisper-large-v3-turbo-v3 | MERaLiON-3 is the only candidate with a published code-switching benchmark that includes EN↔Malay and EN↔Mandarin. Its licence is custom, so confirm commercial terms. Malaysian Whisper is trained on Manglish but publishes no WER and states no licence. |
| 4. Diarization / speaker attribution | **Nemotron 3 Diarization** | pyannote community-1 | Nemotron 3 was released yesterday and is in the Baseten library as batch, streaming and diarized-transcription presets. It is licensed for commercial use and has the best reported DER. pyannote community-1 (CC-BY-4.0) is the proven fallback. |
| 5. Medical vocabulary accuracy | **Context biasing on the main ASR model** (Qwen3-ASR system-prompt context) plus LLM correction when drafting the note | VibeVoice-ASR hotwords | No open model is proven on conversational medical speech. Google MedASR is English dictation only and did no better than Whisper base on mock consultations [S8]. |
| 6. TTS / speech-to-speech | **VoxCPM2** (TTS) | Qwen3-TTS 1.7B | Both are Apache 2.0 and in the Baseten library. VoxCPM2 covers Malay; Qwen3-TTS does not but has 97 ms latency. Use a pipeline (ASR → LLM → TTS). Skip end-to-end speech-to-speech. |

Suggested demo pipeline: Qwen3-ASR-1.7B for transcription, Nemotron 3 Diarization for speaker labels (merged by timestamps), and an LLM for the note. Everything except MERaLiON is already a one-click Baseten library model. Run MERaLiON-3 and MOSS-Transcribe-Diarize as challengers in the baseline test.

## Findings by sub-capability

### 1. Streaming / short-command STT

| Model | Released | Size | Licence | Languages | Reported accuracy | Streaming | Runtime | Baseten |
|---|---|---|---|---|---|---|---|---|
| Qwen3-ASR-1.7B | 2026-01-29 [S9] | 1.7B | Apache 2.0 [S9] | 30 languages and 22 Chinese dialects, including Malay and Mandarin [S9] | LibriSpeech 1.63/3.38 offline vs 1.95/4.51 streaming [S10]; Open ASR Leaderboard avg 5.76 (**secondary source**, from the MarkTechPost roundup [S23]) | Yes, vLLM only; no timestamps or batching when streaming [S9] | vLLM, Transformers [S9] | Library: "Qwen3 ASR 1.7B Streaming" over WebSocket [S11][S12] |
| Nemotron 3.5 ASR Streaming 0.6B | 2026-06-04 [S13] | 0.6B | OpenMDW 1.1, commercial use allowed [S13] | 40 locales including Mandarin (zh-CN); **no Malay** [S13] | FLEURS en 7.91% at 1.12 s chunks; zh 19.28% CER [S13] | Yes, cache-aware; chunks from 80 ms to 1.12 s [S13] | NeMo, Transformers ≥5.13, NeMo-Speech.cpp [S13] | Library: "NVIDIA Nemotron 3.5 ASR (Multilingual)" [S4] |
| Voxtral Mini 4B Realtime 2602 | Feb 2026 [S14] | 4B | Apache 2.0 [S14] | 13 languages including Chinese; **no Malay** [S14] | Avg WER 8.72% at 480 ms delay, 12.60% at 160 ms [S14] | Yes, native [S14] | vLLM only [S14] | No library entry found; Baseten blog covers older Voxtral models [S15] |

Notes:
- Qwen3-ASR-0.6B has a 92 ms average time to first token at concurrency 1 [S10]. It could be a cheaper option for commands, but its Malay FLEURS WER is 17.66 vs 10.39 for the 1.7B model [S10].
- For short commands, the transcript arriving quickly after the user stops talking matters more than streaming partial results. A non-streaming request per push-to-talk utterance may be simpler and good enough. Measure both.

### 2. Long-form ambient transcription

| Model | Released | Size | Licence | Max length | Speakers built in? | Accuracy | Runtime | Baseten |
|---|---|---|---|---|---|---|---|---|
| Qwen3-ASR-1.7B | 2026-01-29 | 1.7B | Apache 2.0 | "no longer than 20 minutes" per pass [S10] | No; timestamps come from the separate Qwen3-ForcedAligner (≤5 min, 11 languages) [S9] | GigaSpeech 8.45, WenetSpeech meeting 5.88 [S16] | vLLM | Library "Qwen 3 ASR 1.7B"; docs example [S12][S17] |
| MOSS-Transcribe-Diarize 0.9B | 2026-07-09 [S18] | 0.9B | Apache 2.0 [S18] | 90 min, single pass [S18] | Yes (joint) | AliMeeting cpCER 22.17, AISHELL-4 cpCER 15.83 [S18] | vLLM, SGLang Omni [S18] | Library entry, H100 [S4] |
| VibeVoice-ASR | 2026-01-21 [S19] | ~7–9B (README says 7B; HF cards list 8–9B params) [S19][S20] | MIT [S19] | 60 min, single pass [S20] | Yes (joint ASR, diarization and timestamps) [S20] | Open ASR avg WER 7.77, AMI 17.20 [S20] | vLLM, Transformers [S19] | **No library entry found** |

Notes:
- The VibeVoice README says it is "intended for research and development purposes only" and does not recommend commercial use, despite the MIT licence [S19]. That is fine for a competition prototype but is a production risk. Malay support is **unverified**: the card claims 50+ languages but does not list Malay in text.
- Cohere Transcribe (2B, Apache 2.0, #1 on the Open ASR Leaderboard at avg 5.42 when released in March 2026) has no Malay, no timestamps and no diarization, and it performs inconsistently on code-switched audio [S21]. That rules it out for Sona.
- Parakeet TDT 0.6B v3 handles up to 24 min with full attention (3 h with local attention) and gives word timestamps, but it covers 25 European languages only [S22].
- A 10–15 minute consultation fits within Qwen3-ASR's 20-minute limit in one pass, so the demo needs no chunking logic.

### 3. Malay / Mandarin / English code-switching

| Model | Released | Size | Licence | Evidence | Runtime | Baseten |
|---|---|---|---|---|---|---|
| MERaLiON-3-3B-ASR (A*STAR, Singapore) | ~May 2026 (initial HF commit "4 months ago") [S24] | 3B | "MERaLiON-3-Public-Licence": custom, **commercial terms unverified** [S24] | Code-switching WER 22.65 across 13 datasets (EN↔Mandarin, Malay, Tamil, Cantonese, Hokkien, Vietnamese). The larger MERaLiON-2-10B-ASR scored 26.24 on the same benchmark [S25] | vLLM recommended; ~600 ms first token when streaming; the card claims multi-hour audio, timestamps and diarization for offline use [S25] | Not in library; would need a custom Truss |
| mesolitica malaysian-whisper-large-v3-turbo-v3 | **unverified** | 0.8B | **Not stated on card** [S26] | Fine-tuned on Malaysian-STT-Whisper data for "Malay, Manglish, Mandarin, Tamil and Science context"; no WER in text [S26] | Transformers; would need conversion for faster-whisper (**unverified**) | Not in library; Baseten has Whisper large-v3 and Turbo Truss presets that could be adapted [S4][S27] |
| Qwen3-ASR-1.7B (baseline) | 2026-01-29 | 1.7B | Apache 2.0 | Malay FLEURS WER 10.39, Chinese 2.41 [S10]; no code-switching result published | vLLM | Library |

Notes:
- MERaLiON's code-switching benchmark mixes Singapore and wider regional speech. Singlish is close to Manglish, but no Malaysia-specific number exists. Our own test must decide.
- VibeVoice-ASR claims native code-switching [S20], but Malay support is unverified.
- mesolitica also publishes Malaysian-Qwen2.5-7B-Speech-Instruct and Malaysian TTS models [S28]. Licences are not stated on the pages I checked.

### 4. Diarization / speaker attribution

| Model | Released | Size | Licence | Max speakers | DER | Streaming | Runtime | Baseten |
|---|---|---|---|---|---|---|---|---|
| Nemotron 3 Diarization | 2026-09-23 [S3] | 100M | OpenMDW 1.1, commercial use allowed [S3] | 8 | CALLHOME-2 9.10, DIHARD III 12.73, AliMeeting near 6.40 (30.4 s latency) [S3]; AISHELL-4 9.8 vs 27.2 for Sortformer v2.1 at low latency [S5] | Yes, 0.32 s to 30.4 s buffers from one checkpoint [S3] | NeMo 3.0, Transformers, NeMo-Speech.cpp [S3] | Library: batch, streaming and diarized-transcription presets on RTX PRO 6000 [S5] |
| pyannote speaker-diarization-community-1 | **unverified** date | — | CC-BY-4.0 (gated; requires agreeing to share contact info) [S29] | Configurable | CALLHOME 26.7, DIHARD 3 20.2, AMI IHM 17.0 [S29] | No | pyannote.audio | Library (pyannoteAI publisher page) [S30] |
| Streaming Sortformer 4spk v2.1 (predecessor) | Jul 2025 [S31] | 117M | NVIDIA Open Model License [S31] | 4 | CALLHOME-2 6.65, DIHARD III 1–4 spk 15.09 (1.04 s) [S31] | Yes | NeMo | Superseded by Nemotron 3 [S5] |

Notes:
- Nemotron 3 Diarization's card lists English, Mandarin, Hindi, Kannada, Telugu and Bengali as evaluated languages [S3]. Malay is not listed. Diarization relies mostly on acoustics, but we should confirm it on Malay speech.
- Baseten's diarized-transcription preset pairs it with Parakeet V2, an **English-only** 600M ASR model [S5]. For Malay or Mandarin we need our own merge step: take Qwen3-ASR word timestamps (or ForcedAligner output) and assign each word to the Nemotron speaker active at that time.
- A consultation usually has 2–3 speakers (doctor, patient, sometimes family), well within every candidate's limit.
- Alternatively, use a single model that transcribes and labels speakers together (MOSS-Transcribe-Diarize, VibeVoice-ASR, section 2).

### 5. Medical vocabulary accuracy

| Model / approach | Released | Licence | Evidence | Fit for Sona |
|---|---|---|---|---|
| Google MedASR (105M Conformer) | 2025-12-18 [S32] | Health AI Developer Foundations terms: **commercial conditions unverified** [S32] | RAD-DICT WER 4.6 vs Whisper v3 Large 25.3 [S32]. On real accented drug names (Eka) term-WER 18.6 vs Whisper base.en 30.8, but on mock consultations (PriMock57) 24.5 vs 23.4 [S8] | English only; built for dictation, not conversation; weaker on non-native accents [S32]. Poor fit for ambient consultations. |
| Qwen3-ASR context prompt | 2026-01 | Apache 2.0 | The model "learns to utilize the context tokens inside the system prompt as background knowledge" [S10]. No medical benchmark. | Best fit: pass a drug and diagnosis list (e.g. the hospital formulary) per request. |
| VibeVoice-ASR / -Streaming hotwords | 2026-01 / 2026-09 | MIT (research-use caveat) | Hotwords for "names, technical terms" [S7][S20]. No medical benchmark. | Good fallback if joint diarization is chosen. |
| Granite Speech 4.1 2B keyword biasing | 2026-04-29 [S33] | Apache 2.0 | Open ASR avg 5.33; keyword-list biasing [S33] | No Malay or Mandarin; English-only fallback. |

Notes:
- MedWER found that general models lose 7.8–10.3 WER points on jargon-dense material compared with their overall WER [S8]. Overall WER will therefore overstate how good the scribe is. Measure term-level accuracy separately.
- A second safety net is a cheap LLM pass: when drafting the note, have the LLM correct transcript errors against the formulary and flag low-confidence terms for clinician review. This is ordinary prompting and needs no extra model.

### 6. TTS / speech-to-speech (open)

| Model | Released | Size | Licence | Languages | Latency / quality | Runtime | Baseten |
|---|---|---|---|---|---|---|---|
| VoxCPM2 | Apr 2026 [S34] | 2B | Apache 2.0, free for commercial use [S34] | 30 languages **including Malay**, plus 9 Chinese dialects [S34] | Seed-TTS-eval EN WER 1.84, ZH CER 0.97; RTF ~0.13 with Nano-vLLM [S34] | vLLM-Omni, Nano-vLLM [S34] | Library entry [S4] |
| Qwen3-TTS-12Hz-1.7B | Jan 2026 (arXiv 2601.15621) [S35] | 1.7B (0.6B also available) | Apache 2.0 [S35] | 10 languages; **no Malay** [S35] | 97 ms end-to-end latency; Seed-TTS EN WER 1.24 [S35] | vLLM-Omni [S35] | Library: 0.6B and 1.7B streaming presets [S4] |
| Kokoro-82M | 2025-01-27 [S36] | 82M | Apache 2.0 [S36] | 8 language variants; Malay not listed [S36] | Very cheap | PyTorch | Truss example [S27] |
| Voxtral 4B TTS 2603 | Mar 2026 [S37] | 4B | **CC BY-NC 4.0: not for commercial use** [S37] | 9 languages | 70 ms | vLLM-Omni | Excluded on licence |
| Qwen3-Omni-30B-A3B (speech-to-speech) | 2025-09-22 [S38] | 30B MoE (3B active) | Apache 2.0 [S38] | Speech input includes Malay; speech output does not [S38] | Not stated | vLLM-Omni [S38] | Not checked |

Notes:
- Voice output is optional for the demo. A pipeline (ASR → LLM → TTS) keeps every stage auditable, which matters for clinical use. End-to-end speech-to-speech adds a 30B model without a clear demo payoff. Skip it.
- mesolitica Malaysian-TTS-1.7B-v1 supports Malay-English switching with 7 local voices, but its licence is not stated and it needs normalized text input [S39].

## What to measure in our baseline test

Test set (build before comparing models):
- 3–5 scripted mock consultations, each 5–15 min, 2–3 speakers, recorded on an iPhone in a normal room: English, Manglish, Mandarin-English, and one three-way mix. Include real drug names, doses and diagnoses from a Malaysian formulary.
- PriMock57 (English mock primary-care consultations, used in MedWER [S8]) as a public English reference.
- 30 short voice commands, recorded quiet and noisy.

Metrics:
1. **WER / CER by language mix.** Use MER or CER for Mandarin-containing segments, with one fixed text normalizer for every model.
2. **Medical-term accuracy.** Recall and substitutions on the term list (MedWER-style term-restricted WER [S8]), with and without context biasing. Pay particular attention to dose numbers.
3. **Speaker attribution.** cpWER (words right *and* attributed to the right speaker) plus DER, for Qwen3-ASR + Nemotron 3 vs MOSS-Transcribe-Diarize.
4. **Latency.** Command final transcript after release (p50/p95), streaming first-partial latency, and time from end of consultation to finished transcript.
5. **Hallucination.** Output during silence and cross-talk; Cohere's card warns about this, so check every model [S21].
6. **Cost and fit.** GPU type, cold start and $/audio-hour on Baseten.
7. **Licence gate.** Confirm the MERaLiON-3 and MedASR terms before using either.

Pass bar suggestion: pick the stack with the best cpWER on the English set as the demo default, and adopt MERaLiON-3 only if it beats Qwen3-ASR on our Manglish recordings by a clear margin.

## Open questions

- Is the MERaLiON-3 Public Licence acceptable for a Malaysian-hospital prototype, and later for commercial use? The terms are not on the model card.
- What licence does mesolitica use for malaysian-whisper-large-v3-turbo-v3? None is stated on the card.
- Does Nemotron 3 Diarization hold its DER on Malay and code-switched speech? It was not evaluated on Malay.
- Does MOSS-Transcribe-Diarize or VibeVoice-ASR support Malay? Neither card lists it in text.
- Does Qwen3-ASR's context prompt measurably improve drug-name accuracy? There is no published medical result.
- The user said new models dropped today. Apart from Nemotron 3 Diarization (yesterday) and the trending Confucius4-R2T2, I found none. Which model did they mean?
- Does data residency require a specific Baseten region, or self-hosted Truss in a Malaysian cloud? This affects hosting, not model choice.

## Sources

- [S1] Hugging Face trending digest 2026-09-24 (secondary; used only to find the model): https://github.com/datnguyenquy94/news-radar/issues/576
- [S2] Confucius4-R2T2 model card: https://huggingface.co/netease-youdao/Confucius4-R2T2
- [S3] Nemotron 3 Diarization model card: https://huggingface.co/nvidia/Nemotron-3-Diarization
- [S4] Baseten model library: https://www.baseten.co/library/
- [S5] Baseten blog, Nemotron 3 Diarization (2026-09-23): https://www.baseten.co/blog/nvidia-nemotron-3-diarization/ ; library page: https://www.baseten.co/library/nemotron-3-diarization/
- [S6] VibeVoice-ASR-Streaming-7B model card: https://huggingface.co/microsoft/VibeVoice-ASR-Streaming-7B
- [S7] VibeVoice-ASR-Streaming-1.5B model card: https://huggingface.co/microsoft/VibeVoice-ASR-Streaming-1.5B
- [S8] MedWER paper (arXiv 2609.05728, 2026-09-04): https://arxiv.org/html/2609.05728v1
- [S9] Qwen3-ASR GitHub README: https://github.com/QwenLM/Qwen3-ASR
- [S10] Qwen3-ASR technical report (arXiv 2601.21337): https://arxiv.org/html/2601.21337v1
- [S11] Baseten library, Qwen3 ASR 1.7B Streaming: https://www.baseten.co/library/qwen3-asr-1-7b-streaming/
- [S12] Baseten library, Qwen 3 ASR 1.7B: https://www.baseten.co/library/qwen-3-asr-1-7b/
- [S13] Nemotron 3.5 ASR Streaming 0.6B model card: https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b ; fine-tuning blog: https://huggingface.co/blog/nvidia/fine-tuning-nemotron-35-asr
- [S14] Voxtral Mini 4B Realtime 2602 model card: https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602 ; Mistral announcement: https://mistral.ai/news/voxtral-transcribe-2/
- [S15] Baseten blog, Voxtral vs Whisper: https://www.baseten.co/blog/understanding-voxtral-vs-whisper-build-a-voice-controlled-smart-home-app/
- [S16] Qwen3-ASR-1.7B model card: https://huggingface.co/Qwen/Qwen3-ASR-1.7B
- [S17] Baseten docs, Qwen3-ASR example: https://docs.baseten.co/examples/models/transcription/qwen3-asr
- [S18] MOSS-Transcribe-Diarize model card: https://huggingface.co/OpenMOSS-Team/MOSS-Transcribe-Diarize
- [S19] Microsoft VibeVoice GitHub README: https://github.com/microsoft/VibeVoice
- [S20] VibeVoice-ASR model cards: https://huggingface.co/microsoft/VibeVoice-ASR , https://huggingface.co/microsoft/VibeVoice-ASR-HF ; tech report: https://arxiv.org/abs/2601.18184
- [S21] Cohere Transcribe model card: https://huggingface.co/CohereLabs/cohere-transcribe-03-2026
- [S22] Parakeet TDT 0.6B v3 model card: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
- [S23] Open ASR Leaderboard (live): https://huggingface.co/spaces/hf-audio/open_asr_leaderboard ; HF blog on leaderboard tracks: https://huggingface.co/blog/open-asr-leaderboard ; secondary roundup (used only for the Qwen3-ASR average WER): https://www.marktechpost.com/2026/07/23/best-open-speech-recognition-asr-models-in-2026-wer-languages-latency-and-license-compared/
- [S24] MERaLiON-3-3B-ASR file tree (licence metadata, commit ages): https://huggingface.co/MERaLiON/MERaLiON-3-3B-ASR/tree/main
- [S25] MERaLiON-3-3B-ASR model card: https://huggingface.co/MERaLiON/MERaLiON-3-3B-ASR
- [S26] mesolitica malaysian-whisper-large-v3-turbo-v3 model card: https://huggingface.co/mesolitica/malaysian-whisper-large-v3-turbo-v3
- [S27] Baseten truss-examples repo: https://github.com/basetenlabs/truss-examples
- [S28] mesolitica Hugging Face org: https://huggingface.co/mesolitica
- [S29] pyannote community-1 model card: https://huggingface.co/pyannote/speaker-diarization-community-1
- [S30] Baseten library, pyannoteAI publisher: https://www.baseten.co/library/publisher/pyannote/
- [S31] Streaming Sortformer 4spk v2.1 model card: https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2.1
- [S32] Google MedASR model card: https://huggingface.co/google/medasr ; Google Research blog: https://research.google/blog/next-generation-medical-image-interpretation-with-medgemma-15-and-medical-speech-to-text-with-medasr/
- [S33] Granite Speech 4.1 2B model card: https://huggingface.co/ibm-granite/granite-speech-4.1-2b
- [S34] VoxCPM GitHub README: https://github.com/OpenBMB/VoxCPM ; model card: https://huggingface.co/openbmb/VoxCPM2
- [S35] Qwen3-TTS-12Hz-1.7B-Base model card: https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base
- [S36] Kokoro-82M model card: https://huggingface.co/hexgrad/Kokoro-82M
- [S37] Voxtral 4B TTS 2603 model card: https://huggingface.co/mistralai/Voxtral-4B-TTS-2603
- [S38] Qwen3-Omni GitHub README: https://github.com/QwenLM/Qwen3-Omni
- [S39] mesolitica Malaysian-TTS-1.7B-v1 model card: https://huggingface.co/mesolitica/Malaysian-TTS-1.7B-v1

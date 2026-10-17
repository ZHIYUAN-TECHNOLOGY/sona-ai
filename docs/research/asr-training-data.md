# Training data for the Manglish ASR fine-tune

Researched 2026-09-27. Primary sources only: dataset cards and repositories, licence files, papers, vendor documentation, pricing pages and terms of service. Each claim links to the list at the end as `[S#]`. Anything I could not confirm from a primary source is marked **unverified**.

## Question

The plan is to fine-tune Qwen3-ASR-1.7B for Manglish consultations (see `docs/delivery-plan.md`, section "Fine-tuning"). The idea under review has five steps:

1. Take English doctor–patient dialogue datasets.
2. Have an LLM rewrite them as realistic Manglish scripts.
3. Synthesise the audio with Alibaba's closed Qwen-Audio-3.1-TTS.
4. Train on that synthetic audio plus about 1 h of real recordings.
5. Test only on real human speech.

All data is fictional. No patient data is involved.

This note answers four questions:

1. May we use the source datasets?
2. Can Qwen-Audio-3.1-TTS do the job, and do its terms allow it?
3. What does Baseten charge to train?
4. What does published evidence say about training ASR on TTS audio?

## TL;DR

| Question | Answer |
|---|---|
| Source text datasets | ACI-Bench, MTS-Dialog and PriMock57 are all **CC BY 4.0**, so commercial use and derivatives are allowed with attribution, and there is no data-use agreement [S1][S2][S3]. The nisten Opus 5.5 set is tagged **MIT**, is fully synthetic, and has unresolved upstream-rights questions [S5]. |
| Real speech we can use | **PriMock57** (8 h 38 m, role-played UK consultations, CC BY 4.0) [S3][S4] and the **Fareez OSCE set** (about 55 h, simulated consultations, **CC0**) [S7][S8] are the only openly licensed medical dialogue audio I found. Neither is Malaysian. |
| Code-switched speech corpora | SEAME is non-commercial for LDC non-members [S11][S12]. CS-Dialogue is CC BY-NC-SA [S17]. The mesolitica sets carry **no licence tag** [S15]. I found no clearly licensed Malaysian English–Malay code-switching corpus. |
| Qwen-Audio-3.1-TTS | It exists as `qwen-audio-3.1-tts-flash`, released 2026-09-22/23 [S18][S19]. It is **Beijing region only** today [S20][S21]. The docs **do not list Malay** for its voices [S22], and no page claims code-switching within a sentence. The previous version, 3.0-TTS, lists Malay and is available in Singapore [S23][S24]. |
| Training on TTS outputs | **Ambiguous, and a real risk.** Both Alibaba's international and China terms forbid using outputs "to train or develop products or services that compete with" Alibaba [S26][S27]. Alibaba sells ASR itself. Get written authorisation, or use an open-weight TTS. |
| Baseten training | H100 costs **$6.50/h** per GPU. H200 costs **$7.50/h** (docs only). Billing is per minute, with no minimum [S29][S30][S31]. There is an **official Qwen3-ASR-1.7B full fine-tune recipe** on 1×H100 [S34]. |
| Evidence on synthetic audio | Mixing real and synthetic audio helps; synthetic audio alone does not. Typical gains are 5–35% relative. On code-switching the best ratio is about **2–3× synthetic to real**, and **speaker diversity** is the key factor [S47]. No paper tests a regime as small as 1 h of real audio. |

## 1. Dataset licences and suitability

### The four named datasets

| Dataset | Licence (exact) | Commercial use | Derivatives / redistribution | Content | Data-use agreement |
|---|---|---|---|---|---|
| **ACI-Bench** | README: "published under a Creative Commons Attribution 4.0 International License (CC BY)"; figshare record: `CC BY 4.0` [S1] | Yes | Yes, with attribution ("Please cite our Nature Scientific Data paper") [S1] | Text only: "full doctor-patient conversations and associated clinical notes". 207 encounters (67 train / 20 valid / 3×40 test). English. Some subsets keep "swapped speaker tags… that originate from the Automatic Speech Recognition (ASR) process… intentionally left uncorrected" [S1] | None found |
| **MTS-Dialog** | `LICENSE.txt` is the full "Attribution 4.0 International" text. GitHub shows `NOASSERTION` only because the file is non-standard [S2] | Yes | Yes, with attribution | Text: "1.7k short doctor-patient conversations and corresponding summaries" (1,201 / 100 / 2×200), plus 3.6k pairs augmented "via back-translation using… French and Spanish" [S2]. English | None found |
| **PriMock57** | `LICENSE.md`: "Creative Commons Attribution 4.0 International" [S3] | Yes | Yes, with attribution | **Audio** plus manual transcripts and notes. "57 mock medical primary care consultations held over 5 days by 7 Babylon clinicians and 57 Babylon employees acting as patients, using case cards" [S3]. "Total audio duration is 8h:38m (17h:16m if counting the separate channels)", "wav 16bit/16khz", one channel per speaker [S4]. UK English, role-played | None found |
| **nisten/opus5-5-doctor-patient-conversations-all-human-diseases** | Hugging Face tag `license:mit`. The card has no other licence text [S5] | The tag allows it; see the caveats below | Allowed by the tag | Synthetic text, created 2026-09-26. "2,194 clinical encounters", average "33.4 turns" and "~5,700 tokens" each, about 75 MB of JSONL. Written by "Claude Opus 5.5 subagents"; "the last six lines… regenerated… through the harness's generic `opus` alias". Each patient tells "exactly one obfuscation or outright lie". Uses ChatML `system/user/assistant` roles, which would need mapping to doctor and patient [S5] | None |

**Caveats on the nisten set:**
- The structured fields are "copied verbatim from the same curated source as the Opus 4.8 set". The card does not name or license that source [S5].
- Anthropic's Commercial Terms D.4 bind the *generator*, not downstream users. The terms bar using the Services "to build a competing product or service, including to train competing AI models" [S6].
- A speech recogniser is not a competing LLM, so the risk to us looks low. It is still **unresolved**: the MIT grant can only pass on the rights nisten holds.

**Not verified:** how the ACI-Bench and MTS-Dialog conversations were produced. Their READMEs do not say, and I did not read the papers' methods sections.

### Other doctor–patient dialogue sets

| Dataset | Licence | Content | Notes |
|---|---|---|---|
| **Fareez et al. 2022, simulated OSCE** | Data on figshare: **CC0**; paper: CC BY 4.0 [S7][S8] | **Audio**: "272 mp3 audio files and 272 corresponding transcript text files", "3309 minutes of audio" (about 55 h). Mostly respiratory (214), plus MSK 46, GI 6, cardiac 5, derm 1. Transcripts use "The American version of English" [S7] | The largest openly licensed real-speech medical dialogue set I found |
| **MedDialog** | BigBio loader tag `license:unknown`. The original repository returns 404 [S9] | Text, English and Chinese | Licence **unverified** |
| **NoteChat** (arXiv 2310.15959) | No licence tag on Hugging Face [S10] | Synthetic conversations generated from clinical notes | Licence **unverified** |

### Malay, Mandarin and code-switched speech

| Corpus | Licence | Content | Usable commercially? |
|---|---|---|---|
| **SEAME** (LDC2015S04) | "LDC User Agreement for Non-Members". "Nonmember licensees may use LDC data for noncommercial linguistic research and education only" and "cannot use LDC data to develop or test products for commercialization" [S11][S12] | "approximately 192 hours of Mandarin-English code-switching speech from 156 speakers". "Over 60% of the speakers were Singaporean; the rest were Malaysian." No Malay [S11] | Only with a paid LDC for-profit membership. I did not read the agreement PDF itself |
| **IMDA National Speech Corpus** (Singapore) | IMDA's page did not render its licence text [S13]. The mesolitica mirror says "Singapore Open Data Licence" [S14]. The MERaLiON paper mentions "a publicly accessible license" [S16] | About 10,000 h. "PART 4… code-switching… Singapore English and their mother tongue languages including Mandarin, Malay, or Tamil" [S16] | **Unverified**; confirm with IMDA |
| **mesolitica / malaysia-ai sets** (Malaysian-STT-Whisper, IMDA-STT, malay-conversational-speech-corpus, and others) | **No licence tag** [S15]. The code repository is Apache-2.0, which covers the code, not the audio [S15] | Audio labelled with Whisper: "pseudolabeled Whisper Large V3", partly from YouTube [S15] | Treat as research-only until mesolitica confirms |
| **CS-Dialogue** (BAAI) | `cc-by-nc-sa-4.0`, gated. "Any commercial use… is strictly prohibited" [S17] | 104 h of Mandarin–English | No |

## 2. Qwen-Audio-3.1-TTS on Alibaba Cloud Model Studio

### What exists

Qwen announced "Qwen-Audio-3.1" on X on 2026-09-23, covering ASR, TTS, Realtime, TTS-Next and ASR-Next [S19]. X blocked a direct fetch, so the post text comes from a search snippet. I found no launch blog post. The documentation pages are stamped "Last Updated: Sep 22, 2026".

| Model ID | What it is | Source |
|---|---|---|
| `qwen-audio-3.1-tts-flash` | "designed for real-time interactions… multiple languages and dialects, streaming speech synthesis… In voice cloning scenarios, it is more robust to noise and reverberation in reference audio". "Fine-tuning Unsupported" | [S18] |
| `qwen-audio-3.1-tts-next` | An "AudioGen" model that generates speech, sound effects and ambient audio together. "Languages: Chinese and English". Non-streaming, up to 3,000 characters in and 120 s out | [S25] |

### Regions

- **3.1 is Beijing-only today.** The 3.1-tts-flash page shows prices and limits for **China (Beijing)** only. The same page on the international site returns 404 [S18].
- The TTS guide lists `qwen-audio-3.1-tts-flash` under "China (Beijing)". Its Singapore list has only the older Qwen3-TTS models [S20].
- The international pricing page lists `qwen-audio-3.1-tts-next` under Beijing only. For Singapore ("International") it lists **qwen-audio-3.0-tts-plus/flash** [S21].
- Regions do not share credentials: "Each region has its own endpoint, API Key, and model list. These cannot be used across regions" [S28].

### Pricing and rate limits

| Model | Region | Price | Rate limit |
|---|---|---|---|
| qwen-audio-3.1-tts-flash | Beijing | Input CNY 1.5 and output CNY 12 per million tokens. "billed separately for input and output tokens". Free quota of 1M tokens for 90 days [S21] | "RPS (Requests Per Second) 3" [S18] |
| qwen-audio-3.1-tts-next | Beijing | Input USD 0.848 and output USD 1.696 per million tokens [S21] | RPS 3 [S25] |
| qwen-audio-3.0-tts-flash | Singapore and Beijing | USD 0.15 per 10,000 characters, input only ("Output is not billed"). 3.0-tts-plus costs USD 0.20. "Each Chinese character… counts as 2 characters. Each other character… counts as 1" [S21] | RPM 180 [S24] |

- **Output-token counting is unverified.** I found no rule for how many output tokens a second of 3.1-tts-flash audio uses. The only rule I found, "each second of audio corresponds to 25 tokens", sits under the audio *understanding* models, not TTS.
- **Rough cost if that rate did apply** (my arithmetic, unconfirmed): 100 h of audio would be about 9M output tokens, or about CNY 108 plus the input text.
- No TPM figure is published.

### Languages, Malay and code-switching

- **Malay is not documented for 3.1-tts-flash.** The model page names no languages. The voice list says its multilingual voices cover Chinese dialects plus "Japanese, Korean, French, German, Portuguese, Italian, Vietnamese, and Indonesian". Other voices are "Mandarin Chinese only" or "English only" [S22].
- **3.0-TTS does list Malay.** Its launch blog lists 16 languages, including "Malay" and "Tagalog", with the caveat "*Full language support rolling out soon" [S23].
- **No page claims switching languages within a sentence.** The docs warn: "The text to be synthesized must be in a language supported by the selected voice. Otherwise, pronunciation errors or unnatural speech may occur". The API takes one `language_type` per request [S20].
- The X snippet mentions "natural cross-lingual voice transfer" [S19]. That means carrying one voice across languages, not mixing languages in one sentence.
- Manglish sentences therefore need an empirical test, and they may need to be split into single-language segments and stitched back together.

### Voice cloning

- **Requirements:** a clone needs "only a 10–20 second audio sample… without model training". It is "available in the Beijing and Singapore regions". The Singapore example uses `qwen-audio-3.0-tts-flash` [S20b].
- **Consent in the Model Library trial** (China-site Service Specific Terms): "If you use features such as voice cloning in the Model Library trial, you represent and warrant that the audio you upload is a recording of your own voice. You must not use the voice of any third party or minor for audio recording. After voice cloning is complete, you may use the result for trial purposes only" [S26b].
- **Consent under the international terms, 4.48.1(b):** "You represent and warrant that you have obtained the necessary consents from relevant individuals or third parties in relation to Member Content" [S26].
- **In practice:** clone only voices of people who have signed a release, such as our voice actor and team members.

### May the outputs train another model? Quoted terms

- **International Product Terms, Art. 4.48.1(d)(v)** (last updated Aug 28, 2026): "you shall not: … (v) resell Model Studio or AI models provided through Model Studio, or use Model Studio, AI models provided through Model Studio (including any Output of such AI models) to train or develop products or services that compete with Alibaba Cloud and/or its affiliates' products and services, unless expressly authorised by us." [S26]
- **Same terms, 4.48.1(e):** "Model Studio does not claim ownership of any Intellectual Property Rights in the Output. You may use the Input and Output, provided your use complies with applicable laws, the Agreement, and our rules." [S26]
- **Same terms, 4.48.1(h)(ii):** outputs must be labelled or watermarked "if required under applicable laws" [S26].
- **China (Bailian) Service Agreement, Art. 4.6:** "未经我们及相关权利人书面许可，您不得转售本服务及平台内模型，和/或利用本服务及平台内模型（包括模型的输出内容）训练、开发与本服务、我们及我们的关联公司提供的模型相竞争的产品或服务". Translation: without written permission, you may not resell the service or its models, or use them (including their outputs) to train or develop products or services that compete with the models Alibaba or its affiliates provide [S27].

**Reading.** Neither text defines "compete". Alibaba sells ASR (Qwen-Audio-3.1-ASR, Qwen3-ASR). A fine-tuned ASR model inside a commercial scribe product could be read as a competing product. The terms neither explicitly allow nor explicitly ban training an in-house model. It is also unclear which terms apply when an international account calls the Beijing region. This is **ambiguous**; it is not a clear yes.

## 3. Baseten Training Jobs

| GPU | Per minute | Per hour | Source |
|---|---|---|---|
| H100 80 GB | $0.10833 | ≈ $6.50 | Pricing page, docs and account API agree [S29][S30] |
| H100 MIG 40 GB | $0.0625 | $3.75 | [S29][S30] |
| H200 141 GB | $0.12500 | $7.50 | Docs only; **not on the public pricing page**, and not returned by our workspace's price API [S30] |
| B200 180 GB | $0.16633 | ≈ $9.98 | Pricing page and docs [S29][S30]. The training docs do not list it: "Training Jobs supports H200 and H100 GPUs" [S33]. B200 training is **unverified** |

**Billing:**
- **Training costs the same as inference.** "The instance's per-minute price applies to serving replicas, image-builder workloads, and training workloads" [S31].
- **Metered per minute.** "Baseten meters usage by the minute while a workload is running on a node", and partial minutes round up [S31].
- **Billed period.** A run "is billed for the wall-clock time from the moment the training workload comes up until the job completes or you cancel it". Scheduling and image pulls are not billed [S31].
- **Model download counts.** Downloading the base model inside the job happens "on billed GPU time, on every job"; the docs recommend mounting it through BDN instead [S32].
- **No minimum, no free tier.** Basic is "$0 per month, pay as you go" [S29]. "Baseten doesn't offer a separate free tier" [S31].
- **Budgets don't stop training.** "A budget never stops dedicated deployments or training jobs" [S31].
- **Concurrency caps.** GPU concurrency is capped per organisation [S33b].

**Qwen3-ASR recipe:**
- `basetenlabs/ml-cookbook/examples/qwen3-asr-transformers` (last commit 2026-09-22) "full-fine-tunes `Qwen/Qwen3-ASR-1.7B` on audio/transcript pairs using the Qwen team's official SFT recipe" [S34].
- **Setup:** 1×H100 by default, or 2, 4 or 8 GPUs with DDP. The demo trains on 800 LibriSpeech utterances. It is a **full fine-tune, not LoRA**.
- **Deploying:** the checkpoint deploys from the UI as non-streaming (OpenAI chat completions) or streaming (WebSocket), or with `baseten train checkpoint deploy --job-id <job_id>` [S34][S35].
- **Cost:** the README gives no wall-clock time or cost. At the plan's estimate of 2–6 h on 1×H100, a run would cost about **$13–39**.
- **Region:** I found no setting for choosing a region. This matches the delivery plan.

## 4. Evidence: TTS audio as ASR training data

I checked every arXiv ID. Numbers for papers marked "abstract" come from the abstract only.

| Paper | arXiv | Setting | Key result | Synthetic : real | Failure modes / mitigations |
|---|---|---|---|---|---|
| Rosenberg et al. 2019 [S36] | 1909.11699 | Tacotron, LibriSpeech plus a 76 h domain set | "the value of synthesized speech as ASR training data remains dramatically less than that of real speech". The model "failed to converge when trained on 10 hours of speech" (training from scratch) | Up to 960 h synthetic | Domain mismatch. Mitigations: sampled speaker embeddings; LM-generated text for lexical diversity |
| Rossenbach et al. 2020 [S37] | 1912.09257 | TTS trained on the ASR corpus | "up to 33% relative" on LibriSpeech-100h and "up to 5% relative" on 960h | Up to 4× the original | Biggest gains when real data is scarce |
| Laptev et al. 2020 [S38] | 2005.07157 | LibriSpeech-100 | 4.3 / 13.5 WER with an LM; "only 33% worse than a comparable supervised setup" (abstract) | — | Vocoder choice |
| Sharma et al. 2020 [S39] | 2010.05549 | **Hindi–English code-switching**; 100 h monolingual + about 12 h code-switched real audio | "absolute word error rate (WER) reductions of up to 5%" | 50 h+ TTS added to about 100 h real | Mismatch between TTS and real audio. Mitigations: mixup of TTS and real samples; a loss that encourages code-switched output |
| Fazel et al. 2021, SynthASR [S40] | 2106.07803 | **Medication names**, RNN-T | ">65% relative" gain on the new domain "without degradation on existing general applications" | Tuned by sampling weights | Catastrophic forgetting. Mitigations: weighted mixed batches, reverb and noise, SpecAugment, encoder freezing |
| Hu et al. 2021, Synt++ [S41] | 2110.11479 | Keyword detection plus ASR | Up to 13% relative over naive synthetic training | — | "structured noise, content errors, or unrealistic speaking styles". Mitigations: rejection sampling; separate batch-norm statistics for real and synthetic |
| Zevallos 2022 [S42] | 2204.00291 | Quechua, low-resource | 8.73% WER improvement (abstract) | — | — |
| Liu et al. 2023 [S43] | 2306.00998 | LibriSpeech | Under 30% of the TTS data matches using all of it | — | Synthetic samples *unlike* real speech are the most useful |
| Hussein et al. 2023, Speech Collage [S44] | 2309.15674 | **SEAME** code-switching; splices real monolingual audio (not TTS) | Up to 34.4% relative MER (in-domain text), 16.2% (zero-shot) | 62–80 h generated | A gap of up to 8.9% MER remains, attributed to "audio mismatches" |
| Hilmes et al. 2024 [S45] | 2407.17997 | Synthetic-only LibriSpeech-100 | Attention encoder-decoder: real 7.5 / 18.9 vs synthetic 14.1 / 37.6 WER, about 2× worse | 100% synthetic | Overfits to TTS speaker embeddings |
| Yu et al. 2024, Hard-Synth [S46] | 2411.13159 | LLM-rewritten text; zero-shot TTS clones voices the ASR model finds hard | 6.5% / 4.4% relative (dev / test-other) (abstract) | Data-efficient | Choosing hard voice prompts beats predefined styles |
| **Yeo et al. 2026** [S47] | 2601.00935 | **SEAME (Singapore/Malaysia speakers)**; CosyVoice2 fine-tuned; Whisper fine-tuned | 100 h real + 100 h random-speaker TTS: MER 12.1 → 10.1 (DevMan), 17.8 → 16.0 (DevSGE). 200 h of TTS alone underperforms real-only | Recommends synthetic at "between two and three times the amount of real data"; gains flatten beyond about 3× | Speaker diversity is the "crucial ingredient". A TTS trained on 10 h of in-domain speech is about 8 MER points worse than one trained on 100 h. UTMOS is a poor proxy |
| **Yeo et al. 2026** [S48] | 2606.19381 | SEAME, Whisper Large; preference learning on the Code Mixing Index | MER 12.1 / 17.8 → 8.9 / 14.2 | — | Standard code-switching TTS does not "enforce language-boundary consistency" |
| Lee et al. 2026 [S49] | 2604.24770 | LLM paraphrase, then TTS, then Whisper fine-tuning (elderly speech) | Up to 58.2% WER reduction. Whisper-large-v3 11.6 → 4.8 | +10% to +100% of real; best at 1:1 | Balanced reference speakers. Stacks with SpecAugment |
| Yamashita 2026 [S50] | 2603.16920 | Four domains, including pharmaceutical text (MedSyn) | Consistent WER reductions. On ATCO2, gains then losses: 51.4 at 10 h, 47.1 at 50–100 h, 48.5 at 200 h | Fully synthetic | Too much synthetic data hurts. Mitigations: filter LLM text; LLM "phonetic respellings". **Caveat:** the MedSyn test audio is itself TTS |
| Halychanskyi et al. 2026 [S51] | 2604.27273 | Accented English, few-shot TTS | Random phoneme substitutions recover most of the gain | — | "a fixed synthetic budget can later dilute the information in real data" |

Abstract-only, also relevant:
- **Devarakonda et al. 2026, 2604.19797** [S52]. Telugu and Kannada medical ASR with real plus TTS audio. WER 24.3 → 15.8 and 31.7 → 25.4.
- **Nguyen et al. 2025, AsyncSwitch, 2506.14190** [S53]. **Malay–English** code-switching on Whisper with text-only adaptation, no TTS: 9.02% relative WER reduction. A baseline that avoids TTS entirely.

**Across the papers:**
- **Mixing beats synthetic-only.** Every paper that compares them finds mixed real and synthetic training better than synthetic alone [S36][S45][S47].
- **Useful ratios** run from 1:1 to about 3× synthetic to real. Gains flatten or reverse beyond that [S47][S49][S50][S51].
- **Typical gains** are 5–35% relative, or 2–5 MER points absolute on code-switching. Narrow vocabulary domains gain more, such as medication names at >65% [S40].
- **Failure modes:**
  - TTS artefacts and flat prosody [S41]
  - acoustic and domain mismatch [S36][S44]
  - overfitting to a few TTS voices [S45]
  - blurred language boundaries in code-switched TTS [S48]
  - forgetting general ability [S40]
  - diluting scarce real data [S51]
- **Mitigations:**
  - many random speakers [S47][S49]
  - diverse, hard or dissimilar LLM text [S43][S46][S50]
  - noise, reverb and SpecAugment on synthetic audio [S40][S49]
  - weighted mixed batches [S40]
  - rejection sampling [S41]
  - testing on real speech only (the opposite of [S50]'s MedSyn setup)
- **Gaps.** No paper tests about 1 h of real audio with a pretrained model. None tests TTS augmentation for Malay–English or Manglish. None tests conversational medical speech on real audio.

## Implications for Sona

- **Use CC BY text sources plus CC0 and CC BY real audio.** Rewrite ACI-Bench and MTS-Dialog (CC BY) into Manglish, and keep an attribution file. Use PriMock57 and the Fareez OSCE set as real medical-English audio for training or for a separate medical-English test. Skip SEAME, CS-Dialogue and the mesolitica sets for anything commercial until their licences are confirmed.
- **Treat the nisten set as optional.** It is MIT-tagged and useful for disease and drug breadth, but its upstream rights are unclear. ACI-Bench and MTS-Dialog cover the need with clean licences.
- **Qwen-Audio-3.1-TTS is a poor fit today:**
  - It is Beijing-only.
  - Malay is not documented.
  - Switching languages mid-sentence is not claimed.
  - Its terms carry an ambiguous clause against training competing products.
- **Plan TTS around that.** Prefer the open-weight TTS already on our list, VoxCPM2 (Apache 2.0, covers Malay per `docs/research/tts-models.md`). Use Qwen only after written authorisation from Alibaba, and then 3.0-TTS in Singapore, which lists Malay, is the likelier option.
- **Speaker diversity matters more than voice quality.** Generate with many voices and random speakers. Add noise, reverb and SpecAugment. Filter out bad synthesis with a round-trip ASR check.
- **Cap synthetic audio at about 2–3× the real audio in each batch, not in total hours.** With about 1 h of Manglish plus about 64 h of CC0/CC BY medical English, that means roughly 3–10 h of Manglish synthetic audio, oversampling the real Manglish. This is my extrapolation; no paper tests a regime this small.
- **Protect general ability.** Watch for forgetting with a general Malay/English test slice alongside the held-out real Manglish. SynthASR's mixed-batch or encoder-freezing approach is the fallback [S40].
- **Costs are small either way.** Baseten's official Qwen3-ASR recipe runs on 1×H100 at $6.50/h, so a full run is about $13–39. Mount the base model through BDN to avoid paying for the download on every job.

## Open questions

1. Would Alibaba give written authorisation to use TTS outputs to train an in-house ASR model? Which terms apply to an international account calling the Beijing region?
2. How many output tokens does a second of audio from `qwen-audio-3.1-tts-flash` use? When will it reach Singapore, and will it support Malay?
3. Can 3.0 or 3.1 TTS speak a mixed Manglish sentence in one request? This needs an empirical test.
4. What licence covers the IMDA National Speech Corpus (read on IMDA's own site), and what rights does mesolitica hold over its audio?
5. How were the ACI-Bench and MTS-Dialog conversations produced (role-play or de-identified real encounters)? Does either paper add use terms beyond CC BY?
6. What is the unnamed upstream source in the nisten set, and under what licence?
7. How long does the Baseten Qwen3-ASR recipe take on 2–3 h of audio? Can this workspace use H200 or B200 for training?
8. Is the gain from synthetic audio still positive when real in-domain audio is only about 1 h? A small ablation at 0×, 1× and 3× synthetic would answer it.

## Sources

- [S1] ACI-Bench: https://github.com/wyim/aci-bench ; figshare https://figshare.com/articles/dataset/aci-bench-corpus_zip/22494601
- [S2] MTS-Dialog: https://github.com/abachaa/MTS-Dialog (README, LICENSE.txt)
- [S3] PriMock57: https://github.com/babylonhealth/primock57 (README, LICENSE.md)
- [S4] PriMock57 audio README: https://github.com/babylonhealth/primock57/blob/main/audio/README.md
- [S5] nisten dataset card: https://huggingface.co/datasets/nisten/opus5-5-doctor-patient-conversations-all-human-diseases
- [S6] Anthropic Commercial Terms: https://www.anthropic.com/legal/commercial-terms
- [S7] Fareez et al. 2022, Scientific Data: https://www.nature.com/articles/s41597-022-01423-1
- [S8] Fareez OSCE data (figshare, CC0): https://doi.org/10.6084/m9.figshare.c.5545842.v1
- [S9] MedDialog (BigBio): https://huggingface.co/datasets/bigbio/meddialog
- [S10] NoteChat: https://huggingface.co/datasets/akemiH/NoteChat ; https://arxiv.org/abs/2310.15959
- [S11] SEAME, LDC2015S04: https://catalog.ldc.upenn.edu/LDC2015S04
- [S12] LDC licensing: https://www.ldc.upenn.edu/data-management/using/licensing
- [S13] IMDA National Speech Corpus: https://www.imda.gov.sg/how-we-can-help/national-speech-corpus
- [S14] mesolitica IMDA-STT: https://huggingface.co/datasets/mesolitica/IMDA-STT
- [S15] mesolitica Malaysian-STT-Whisper: https://huggingface.co/datasets/mesolitica/Malaysian-STT-Whisper ; code https://github.com/malaysia-ai/malaysian-dataset
- [S16] MERaLiON paper (arXiv 2501.01034): https://arxiv.org/abs/2501.01034
- [S17] CS-Dialogue: https://huggingface.co/datasets/BAAI/CS-Dialogue
- [S18] qwen-audio-3.1-tts-flash: https://help.aliyun.com/en/model-studio/qwen-audio-3-1-tts-flash
- [S19] Qwen announcement on X (snippet only; fetch blocked): https://x.com/Alibaba_Qwen/status/2102687258990026993
- [S20] Model Studio TTS guide: https://help.aliyun.com/en/model-studio/non-realtime-tts-user-guide
- [S20b] Voice cloning guide: https://www.alibabacloud.com/help/en/model-studio/voice-cloning-user-guide
- [S21] Model Studio pricing: https://www.alibabacloud.com/help/en/model-studio/model-pricing ; https://help.aliyun.com/en/model-studio/model-pricing
- [S22] Qwen-Audio TTS voice list: https://help.aliyun.com/en/model-studio/qwen-audio-tts-voice-list
- [S23] Qwen-Audio 3.0 TTS blog (2026-07-21): https://www.alibabacloud.com/blog/qwen-audio-3-0-tts-more-multilingual-easier-to-direct_603379
- [S24] qwen-audio-3.0-tts-flash: https://www.alibabacloud.com/help/en/model-studio/qwen-audio-3-0-tts-flash
- [S25] qwen-audio-3.1-tts-next: https://www.alibabacloud.com/help/en/model-studio/qwen-audio-3-1-tts-next
- [S26] Alibaba Cloud International Product Terms, Art. 4.48.1: https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-product-terms-of-service-v-3-8-0
- [S26b] Model Studio Service Specific Terms (China site): https://help.aliyun.com/en/model-studio/bailian-service-notes
- [S27] Bailian Service Agreement, Art. 4.6: https://terms.alicdn.com/legal-agreement/terms/common_platform_service/20230728213935489/20230728213935489.html
- [S28] Model Studio regions: https://www.alibabacloud.com/help/en/model-studio/regions
- [S29] Baseten pricing: https://www.baseten.co/pricing/
- [S30] Baseten instance types: https://docs.baseten.co/deployment/resources
- [S31] Baseten billing: https://docs.baseten.co/organization/billing
- [S32] Baseten training getting started: https://docs.baseten.co/training/getting-started ; https://docs.baseten.co/training/your-own-data
- [S33] Baseten training compute: https://docs.baseten.co/training/concepts/basics#compute-resources
- [S33b] Baseten training GPU capacity: https://docs.baseten.co/training/management#gpu-capacity
- [S34] Baseten ml-cookbook, Qwen3-ASR recipe: https://github.com/basetenlabs/ml-cookbook/tree/main/examples/qwen3-asr-transformers
- [S35] Baseten training overview: https://docs.baseten.co/training/overview
- [S36] Rosenberg et al. 2019: https://arxiv.org/abs/1909.11699
- [S37] Rossenbach et al. 2020: https://arxiv.org/abs/1912.09257
- [S38] Laptev et al. 2020: https://arxiv.org/abs/2005.07157
- [S39] Sharma et al. 2020: https://arxiv.org/abs/2010.05549
- [S40] Fazel et al. 2021, SynthASR: https://arxiv.org/abs/2106.07803
- [S41] Hu et al. 2021, Synt++: https://arxiv.org/abs/2110.11479
- [S42] Zevallos 2022: https://arxiv.org/abs/2204.00291
- [S43] Liu et al. 2023: https://arxiv.org/abs/2306.00998
- [S44] Hussein et al. 2023, Speech Collage: https://arxiv.org/abs/2309.15674
- [S45] Hilmes et al. 2024: https://arxiv.org/abs/2407.17997
- [S46] Yu et al. 2024, Hard-Synth: https://arxiv.org/abs/2411.13159
- [S47] Yeo et al. 2026, Code-switching ASR with TTS augmentation: https://arxiv.org/abs/2601.00935
- [S48] Yeo et al. 2026, Code-Mixing Guided Synthetic Speech: https://arxiv.org/abs/2606.19381
- [S49] Lee et al. 2026, Elderly-contextual augmentation: https://arxiv.org/abs/2604.24770
- [S50] Yamashita 2026, Synthetic data domain adaptation: https://arxiv.org/abs/2603.16920
- [S51] Halychanskyi et al. 2026, Few-shot synthetic accented speech: https://arxiv.org/abs/2604.27273
- [S52] Devarakonda et al. 2026: https://arxiv.org/abs/2604.19797
- [S53] Nguyen et al. 2025, AsyncSwitch: https://arxiv.org/abs/2506.14190

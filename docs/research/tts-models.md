# Open-weight TTS models for Sona

Researched 2026-09-25. I used primary sources only: Hugging Face model cards and API metadata, GitHub READMEs, papers, vendor pages and the leaderboards' own data. Every claim cites a source in the list at the end as `[S#]`. **Unverified** marks anything I could not confirm from a primary source. Benchmark numbers are self-reported by each vendor unless the text says otherwise.

## Question

Which open-weight TTS model should Sona use to speak its replies in real time? The cascade is ASR → LLM → streaming TTS, hosted on Baseten GPUs. The key requirement is Manglish: switching between English, Malay and Mandarin inside one sentence, for example *"Doctor, saya punya 胸口 pain since semalam"*. We may fine-tune on 1–3 h of one Malaysian voice reading code-switched scripts.

## TL;DR

- **No open model publishes a Malay–English–Mandarin code-switching result.** Every "code-switch" claim below is either Chinese–English only or unbenchmarked. Our own Manglish bake-off decides the winner.
- **Pick: VoxCPM2** (Apache 2.0, 2B). It lists both Malay and Mandarin and needs no language tag. It has an official LoRA fine-tuning recipe that works from 5–10 min of audio, a streaming API and a one-click Baseten library entry [S1][S2][S4]. Its weaknesses: no published Malay metric, no published time-to-first-audio, and no arena presence.
- **Challengers for the bake-off:** MOSS-TTS-v1.5 (Apache 2.0, 8B; Malay plus first-class code-switching, but heavy) [S24], Qwen3-TTS 1.7B/0.6B (fastest, ~97 ms first packet, Baseten WebSocket; **no Malay**) [S5][S8], and Confucius4-TTS (Apache 2.0; Malay, strong cross-lingual scores) [S17].
- **Local wildcard:** Scicom-intl Multilingual-TTS-1.7B. It is Malaysian-built (the mesolitica / malaysia-ai lineage) and trained on Malaysian and Malaysian-Chinese speech. Its card demos Malay + English + Mandarin in one sentence [S25]. **No licence is stated.** If the authors grant a commercial licence it scores about 77 and ties for first.
- **The top of every leaderboard is closed.** The best open-weight entries (Breeze TTS 2, Fish S2 Pro, Higgs, Voxtral) are all non-commercial, and none of them does Malay well enough to change the ranking. See [Leaderboards](#leaderboards).

## Ranked table (final, after leaderboard pass)

Score = 0.4·Language + 0.2·Licence + 0.2·Latency + 0.1·Fine-tune + 0.1·Quality. Each criterion is scored 0–10, and the total is ×10 for a score out of 100. Only models whose licence allows commercial use are ranked. Excluded models are listed further down.

| Rank | Model | Score | Licence | Malay | Mandarin | Code-switch evidence | Streaming / first-audio | Fine-tune path | Baseten | Leaderboard evidence | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **openbmb/VoxCPM2** (2B, Apr 2026) | 78 | Apache 2.0, commercial OK [S1] | Yes, listed [S1]. No Malay metric published; closest is Indonesian WER 1.08 / SIM 80.0 [S2] | Yes; Seed ZH CER 0.97 [S2] | "No language tag needed" [S1]. No mixed samples on the demo page [S2]. A third-party paper finds code-switched input to be a failure category [S37] | Streaming API; RTF ~0.13–0.3 [S1]; vLLM-Omni "streaming chunk delivery" [S3]. First-audio latency **not published** | Official LoRA + full SFT, "5–10 minutes of audio" [S1] | Library, vLLM, H100, streaming [S4] | None: absent from AA and TTS Arena [S30][S31] | Best overall fit. Baseline for fine-tuning. |
| 2 | **OpenMOSS-Team/MOSS-TTS-v1.5** (8B, May 2026) | 74 | Apache 2.0 [S24] | Yes, added in v1.5 [S24] | Yes | "Code-switching … within a single utterance (e.g. Chinese–English)" is a first-class feature [S24]. v1.5 recommends language tags [S24], which cuts against mixing | 8B model: no first-audio latency published. Only the 1.7B MOSS-TTS-Realtime reports 180 ms TTFB, and it has **no Malay** (20 languages) [S24] | Official fine-tuning tutorials per architecture (LoRA mentioned) [S24] | Not in library; vLLM-Omni / SGLang-Omni custom Truss [S24] | None [S30][S31] | Strongest code-switch claim with Malay. Cost and latency are the risk. |
| 3 | **Qwen/Qwen3-TTS-12Hz-1.7B-Base** (Jan 2026) | 73 | Apache 2.0 [S5] | **No** (10 languages) [S5] | Yes; Seed ZH CER 0.77, EN WER 1.24 [S5] | None published. The API takes a per-request `language` or `Auto` [S5] | "End-to-end synthesis latency as low as 97 ms" [S5]; vLLM-Omni c=1 mean TTFP 70.6 ms (2× H20) [S9] | Official SFT, single-speaker only [S7] | Library "Qwen3 TTS 12Hz Base Streaming 1.7B", WebSocket, vLLM, H100 [S8] | AA "Qwen3 TTS" (Alibaba API, marked not open) #82, Elo 927 [S30] | Fastest and most accurate on Seed-eval, but Malay would have to be taught from 1–3 h (**unproven**). |
| 4 | **Qwen/Qwen3-TTS-12Hz-0.6B-Base** (Jan 2026) | 72 | Apache 2.0 [S6] | No [S6] | Yes; Seed ZH 0.92, EN 1.32 [S5] | None | Same architecture as the 1.7B; per-size latency not published [S7] | Official SFT [S7] | Library 0.6B streaming preset [S8] | As above | Cheaper sibling of #3. |
| 5 | **netease-youdao/Confucius4-TTS** (Jun 2026) | 69 | Apache 2.0 (code and HF tag) [S17]. Relies on Amphion MaskGCT code; MaskGCT **weights** are CC-BY-NC [S18]. Whether inference needs them is **unverified** | Yes, one of 14 languages [S17] | Yes; Seed ZH CER 0.94, EN WER 1.49 [S17] | Strong cross-lingual voice transfer (CV3-eval, X-Voice) [S17]. Each call takes one `lang` tag, so intra-sentence mixing is **unverified** | Streaming via `--stream` and FastAPI `/api/tts/stream`; vLLM 0.16 for the LLM stage [S17]. No latency figure | Official T2S + S2A training scripts [S17] | Not in library | None [S30][S31] | Solid, but the per-call language tag and the dependency licence need checking. |
| 6 | **Scicom-intl/Multilingual-TTS-1.7B-Base** / **Multilingual-Expressive-TTS-1.7B** (Feb–Mar 2026) | 63 (≈77 if licensed) | **Not stated** [S25]. Base Qwen3-1.7B and neucodec are Apache 2.0 [S26] | Yes; trained on Malaysian-Emilia (~7.9B tokens) plus dialects [S25] | Yes; Malaysian-Chinese-Emilia (~1.8B tokens) [S25] | **Only candidate with a Malay + English + Mandarin one-sentence example** on its card [S25] | Plain Qwen3 causal LM plus the neucodec decoder, so vLLM serving is plausible. Streaming is **unverified** | Training code in the GitHub repo (full-parameter continued pretraining) [S25] | Not in library | Not on AA or TTS Arena. Its own 76-language eval: avg CER 0.236, UTMOSv2 3.23 [S25]. Malay is not a column in the heatmap (**unverified**, read from the image) | Most Manglish-native. Ask the authors for a licence before investing. |
| 7 | ResembleAI Chatterbox Multilingual V3 (0.5B) | 57 | MIT [S22] | Yes [S22] | Yes [S22] | No. One `language_id` per call [S22] | No official streaming (**unverified**); hosted service claims <200 ms [S22] | No official script (**unverified**) | Not in library | AA "Chatterbox" (open) #70, Elo 1023 [S30]; TTS Arena #28, Elo 1479 (flagged not open) [S31] | Fallback if a small MIT model is required. |
| 8 | nvidia/magpie_tts_multilingual_357m (Dec 2025) | 55 | NVIDIA "other"; AA marks it commercial-OK [S32][S30] | No [S32] | Yes [S32] | None | Small model; streaming **unverified** | NeMo (**unverified**) | No | AA #48, Elo 1063 [S30]; TTS Arena "Magpie Multilingual" #34, Elo 1406 [S31] | Added from the leaderboards; no Malay. |
| 9 | hexgrad/Kokoro-82M (Jan 2025) | 54 | Apache 2.0 [S21] | No [S21] | Yes (`lang_code='z'`) [S21] | No; one pipeline per language [S21] | 82M, very cheap | No official training code | Truss example (see speech-models.md) | AA #49, Elo 1063 [S30]; TTS Arena #30, Elo 1477 [S31] | Best-ranked commercial open model, but no Malay and no cloning. |
| 10 | FunAudioLLM Fun-CosyVoice3-0.5B-2512 | 53 | Apache 2.0 [S33] | No [S33] | Yes [S33] | **Unverified** | **Unverified** | **Unverified** | No | None found | Added from HF trending; no Malay. |
| 11 | tencent/AuK-Flash (1.5B, Sep 2026) | 50 | MIT [S10] | No (zh/en tags) [S10] | Yes | None | Non-autoregressive diffusion; no streaming [S10] | `src/auk/train/train.py` [S10] | No | None | Editing model, not a voice-agent TTS. |
| 12 | tencent/AuK (1.5B) | 48 | MIT [S10] | No | Yes | None | No streaming [S10] | Yes [S10] | No | None | As above, but slower. |
| 13 | Zyphra Zonos-v0.1 | 47 | Apache 2.0 [S34] | No | Yes (**unverified**) | None | **Unverified** | **Unverified** | No | AA #75, Elo 1000 [S30] | Added from AA; weak fit. |
| 14 | myshell-ai OpenVoiceV2 | 46 | MIT [S34] | No | Yes [S34] | None | **Unverified** | **Unverified** | No | AA #78, Elo 949 [S30] | Added from AA; dated. |

Baseten library TTS entries as of today: Orpheus TTS, Orpheus 3B WebSockets, Qwen3 TTS 12Hz Base Streaming 0.6B / 1.7B, VoxCPM2 and MARS8-Flash [S39]. Only VoxCPM2 and Qwen3-TTS are both open and relevant.

## Leaderboards

Checked 2026-09-25.

| Leaderboard | Open-weight models listed (rank, Elo) | Closed entries at the top (excluded) | Source |
|---|---|---|---|
| **Artificial Analysis Speech Arena** (92 models, 16 flagged open-weight) | Breeze TTS 2 **#9, 1205** (not commercial); Fish Audio S2 Pro #27, 1122 (not commercial); Step Audio EditX #36, 1095 (not commercial); Voxtral TTS #41, 1078 (not commercial); Magpie-Multilingual 357M #48, 1063 (commercial); Kokoro 82M #49, 1063 (commercial); Maya1 #60, 1044 (commercial); OpenAudio S1 Mini #61, 1041 (not commercial); Higgs Audio V3 #64, 1032 (not commercial); Chatterbox #70, 1023 (commercial); Zonos #75, 1000; VibeVoice 1.5B #77, 950; OpenVoice v2 #78, 949; XTTS v2 #84, 916; StyleTTS 2 #87, 892; MetaVoice #91, 845. Also "Qwen3 TTS" (Alibaba, released 2026-01-22) #82, 927, flagged **not** open, so probably the API build. Commercial flags are AA's `openWeightsCommercial` field | Sonic 3.6 (1279), Gemini 3.8 Flash TTS (1265), Qwen-Audio-3.0-TTS-Plus (1259), Inworld Realtime TTS-2 (1246), Simba 3.2 (1239), Gemini 3.8 Flash-Lite TTS (1239) | [S30] (page JSON: rank, elo, openWeights, openWeightsCommercial) |
| **TTS Arena V2** (Hugging Face, 41 rows; now a Next.js app backed by `/api/leaderboard`) | Flagged open: Kokoro v1.0 #30, 1477 ±25; Fluxions Vui #38, 1392 (preliminary); Veena #39, 1363. Open-weight models the arena flags as not open (hosted builds): Chatterbox #28, 1479; Magpie Multilingual #34, 1406; Maya 1 #35, 1410 | Aurora (1580), CastleFlow v1.0 (1559), Inworld TTS MAX (1558), Deepdub eTTS 3.2 (1559), Inworld TTS (1541) | [S31] |
| **Seed-TTS-eval** (no central board; figures compiled from model cards) | Qwen3-TTS-1.7B: EN WER 1.24 / ZH CER 0.77 [S5]; Qwen3-TTS-0.6B: 1.32 / 0.92 [S5]; Confucius4-TTS: 1.49 (SIM 0.700) / 0.94 (0.765) [S17]; OmniVoice: 1.62 / 0.87 (as reported by Confucius) [S17]; Fish S2: 1.79 / 0.98 (as reported by Confucius) [S17]; VoxCPM2: 1.84 (SIM 75.3) / 0.97 (79.5), hard 8.13 [S2]; MOSS-TTS 1.0: 1.85 (73.4) / 1.20 (78.8) (as reported by VoxCPM) [S2] | Seed-TTS itself: 2.25 / 1.12 [S17] | [S2][S5][S17] |
| **Multilingual / SEA** | MiniMax multilingual test: no Malay column (VoxCPM2 and Confucius report Indonesian, Thai and Vietnamese) [S2][S17]. Scicom 76-language CER/MOS eval: their 1.7B avg CER 0.236 vs Fish S2 Pro 0.237; Chatterbox 0.170 on 23 languages; Qwen3 0.106 on 11 languages [S25]. A low-resource robustness paper (Thai, Vietnamese, Swahili, Indonesian; no Malay) finds code-switched input to be a failure mode for VoxCPM2 and OmniVoice [S37]. **No Malay or Manglish TTS leaderboard found** | — | [S2][S17][S25][S37] |

What the leaderboards change:
- Nothing above rank 8 on AA is open and licensed for commercial use. Breeze TTS 2 (#9) is non-commercial and English/Chinese only [S16].
- Leaderboard models added as candidates: Magpie-Multilingual, Zonos and OpenVoice v2 (ranked above, all without Malay). Step-Audio-EditX, Maya1, VibeVoice 1.5B, StyleTTS 2, MetaVoice, Fluxions Vui and Veena were excluded because they are non-commercial or cover only English, Chinese or Hindi [S30][S31][S34].
- My top four candidates (VoxCPM2, MOSS-TTS-v1.5, Confucius4-TTS, Scicom) have **no arena presence**. Quality for them rests on self-reported Seed-TTS-eval numbers only.

## Scoring rationale

| Model | Language (40%) | Licence (20%) | Latency (20%) | Fine-tune (10%) | Quality (10%) |
|---|---|---|---|---|---|
| VoxCPM2 | 7: Malay and Mandarin listed, tag-free; no code-switch evidence | 10 | 6: streaming and RTF known, no TTFA figure | 10: official LoRA | 8 |
| MOSS-TTS-v1.5 | 7.5: Malay plus a first-class code-switch claim (zh–en only) | 10 | 4: 8B, no TTFA | 8 | 8 |
| Qwen3-TTS 1.7B | 4: no Malay | 10 | 10: ~97 ms, Baseten WebSocket | 8: single-speaker SFT | 9 |
| Qwen3-TTS 0.6B | 4 | 10 | 10 | 8 | 8 |
| Confucius4-TTS | 6.5: Malay, but a per-call language tag | 8: dependency licence unclear | 5 | 8 | 9 |
| Scicom 1.7B | 9.5: Manglish-native data and a demo | 3: unstated | 4 | 6 | 5 |
| Chatterbox MTL V3 | 5 | 10 | 4 | 3 | 6 |
| Magpie 357M | 3 | 9 | 6 | 7 | 6 |
| Kokoro | 2 | 10 | 9 | 2 | 6 |
| CosyVoice3 0.5B | 3 | 10 | 5 | 5 | 6 |
| AuK-Flash / AuK | 3 | 10 | 3 / 2 | 7 | 5 |
| Zonos / OpenVoice v2 | 3 | 10 | 4 / 5 | 3 / 2 | 4 / 2 |

Notes:
- Qwen3-TTS uses the Qwen3 text tokenizer, so Malay text is at least tokenizable. Teaching a new language from 1–3 h of one speaker is not something its authors claim; its fine-tuning README covers single-speaker adaptation only [S7]. This is my inference, and a test should confirm it.
- A 2026 study fine-tuned Chatterbox and CosyVoice 3 on 50 Singlish speakers and raised accent similarity [S38]. That suggests local-accent fine-tuning works on zero-shot TTS. It does not prove code-switching.
- A training-free method for localized accent control at code-switch points (EMNLP 2026) could be layered on later [S36].

## Excluded models

| Model | Reason | Source |
|---|---|---|
| fishaudio/s2-pro (Mar 2026, 4.4B) | Fish Audio Research License: **non-commercial**; commercial use needs a separate licence. Otherwise strong: Malay listed, ~100 ms TTFA on an H200, SGLang, fine-tuning code | [S13] |
| bosonai/higgs-tts-3-4b (Jun 2026) | Research and non-commercial licence; embedding it in a product needs a commercial licence. Malay is in its <5 WER/CER tier, and it has vLLM-Omni / SGLang-Omni streaming | [S14] |
| BreezeBlue/Breeze-TTS-2 (Aug 2026) | Weights are research and non-commercial only. English/Chinese only. <40 ms TTFA on an H100. AA open #1 | [S16][S30] |
| k2-fsa/OmniVoice (Mar 2026) | Weights **CC-BY-NC** (Emilia). Malay has only ~9.6 h of training data | [S11] |
| MERaLiON-OmniVoice-Hokkien-TTS | Hokkien only; MERaLiON-3 custom licence; derived from OmniVoice | [S29] |
| IndexTeam/IndexTTS-2.5 (Aug 2026) | No Malay. The bilibili licence **prohibits deployment "in high-risk scenarios such as medical diagnosis"** unless you do your own compliance; separate licence needed above 100M MAU | [S12] |
| mistralai/Voxtral-4B-TTS-2603 | CC BY-NC 4.0; no Malay or Mandarin | [S23] |
| SWivid/F5-TTS | CC-BY-NC 4.0 | [S19] |
| coqui/XTTS-v2 | Coqui Public Model License (AA: not commercial); no Malay | [S20][S30] |
| Supertone/supertonic-3 (May 2026) | Neither Malay nor Mandarin among its 31 languages (OpenRAIL; ONNX on-device) | [S15] |
| mesolitica Malaysian-TTS-1.7B-v1 / 4B-v0.1 | Malay–English switching supported, but no licence stated and its DistilCodec decoder is **CC-BY-NC** | [S27][S28] |
| Step-Audio-EditX, VibeVoice 1.5B, OpenAudio S1 Mini | AA flags them as not commercial; no Malay | [S30][S34] |
| Maya1, StyleTTS 2, MetaVoice, Veena, Fluxions Vui | English (or Hindi) only | [S30][S31][S34] |

## Reference only: Gemini 3.8 Flash TTS / Flash-Lite TTS

- Released 2026-09-23 on the Gemini API and Google AI Studio, with Gemini Enterprise API "coming soon". **Closed and API-only; no open weights** [S35].
- The Flash-Lite TTS docs list "Standard Malay" and Chinese among 100+ auto-detected languages [S35]. The launch blog does not mention Malay [S35]. Neither page mentions code-switching.
- AA ranks them #2 (Flash, Elo 1265) and #6 (Flash-Lite, Elo 1239) [S30]. They are a useful quality ceiling for the Manglish bake-off, but they do not qualify for self-hosting.

## Open questions

1. **Scicom licence.** Will the Scicom-intl (Malaysia-AI) team grant commercial terms for Multilingual-TTS / Expressive-TTS-1.7B? This decides whether the most Manglish-native model can be used.
2. **Confucius4-TTS dependency.** Does inference need MaskGCT semantic-codec weights (CC-BY-NC), or only the Amphion code?
3. **Real Manglish quality.** How do VoxCPM2, MOSS-TTS-v1.5, Confucius4-TTS, Scicom and Qwen3-TTS (1.7B, zero-shot) handle 50 scripted Manglish lines? Score with Qwen3-ASR / MERaLiON round-trip WER, native-listener MOS, and Mandarin tone accuracy on in-sentence 汉字.
4. **First-audio latency.** What are the measured TTFA values for VoxCPM2 and MOSS-TTS-v1.5 under vLLM-Omni on Baseten? Neither vendor publishes one.
5. **Hosting region.** Does Baseten offer a Singapore region for us? `model-hosting.md` found only `us`/`eu` self-serve regions. Confirm with Baseten.
6. **Fine-tuning.** Does a 1–3 h code-switched LoRA on VoxCPM2 keep Mandarin tones and Malay vowels, or does it drift toward one language?

## Sources

- [S1] VoxCPM2 model card: https://huggingface.co/openbmb/VoxCPM2
- [S2] VoxCPM GitHub README (benchmarks, news, vLLM-Omni): https://github.com/OpenBMB/VoxCPM ; demo page https://openbmb.github.io/voxcpm2-demopage
- [S3] VoxCPM vLLM-Omni deployment doc: https://voxcpm.readthedocs.io/en/latest/deployment/vllm_omni.html
- [S4] Baseten library, VoxCPM2: https://www.baseten.co/library/voxcpm2/
- [S5] Qwen3-TTS-12Hz-1.7B-Base model card: https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base
- [S6] Qwen3-TTS-12Hz-0.6B-Base model card: https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base
- [S7] Qwen3-TTS GitHub and fine-tuning README: https://github.com/QwenLM/Qwen3-TTS ; https://github.com/QwenLM/Qwen3-TTS/tree/main/finetuning
- [S8] Baseten library, Qwen3 TTS streaming: https://www.baseten.co/library/qwen3-tts-12hz-base-streaming-1-7b/ ; https://www.baseten.co/library/qwen3-tts-12hz-base-streaming-0-6b/
- [S9] vLLM blog, "Engineering TTS Inference in vLLM-Omni" (2026-06-23): https://vllm.ai/blog/2026-06-23-vllm-omni-tts
- [S10] Tencent AuK / AuK-Flash: https://huggingface.co/tencent/AuK ; https://huggingface.co/tencent/AuK-Flash ; https://github.com/Tencent-Hunyuan/AuK
- [S11] OmniVoice model card and language list: https://huggingface.co/k2-fsa/OmniVoice ; https://github.com/k2-fsa/OmniVoice/blob/master/docs/languages.md
- [S12] IndexTTS-2.5 card and licence: https://huggingface.co/IndexTeam/IndexTTS-2.5 ; https://huggingface.co/IndexTeam/IndexTTS-2.5/blob/main/LICENSE
- [S13] Fish Audio S2 Pro: https://huggingface.co/fishaudio/s2-pro
- [S14] Higgs TTS 3 4B: https://huggingface.co/bosonai/higgs-tts-3-4b
- [S15] Supertonic 3: https://huggingface.co/Supertone/supertonic-3
- [S16] Breeze TTS 2: https://huggingface.co/BreezeBlue/Breeze-TTS-2
- [S17] Confucius4-TTS: https://huggingface.co/netease-youdao/Confucius4-TTS ; https://github.com/netease-youdao/Confucius4-TTS
- [S18] Amphion MaskGCT (licence tag cc-by-nc-4.0): https://huggingface.co/amphion/MaskGCT
- [S19] F5-TTS: https://huggingface.co/SWivid/F5-TTS
- [S20] XTTS-v2: https://huggingface.co/coqui/XTTS-v2
- [S21] Kokoro-82M: https://huggingface.co/hexgrad/Kokoro-82M ; https://github.com/hexgrad/kokoro
- [S22] Chatterbox: https://huggingface.co/ResembleAI/chatterbox ; https://github.com/resemble-ai/chatterbox
- [S23] Voxtral 4B TTS 2603: https://huggingface.co/mistralai/Voxtral-4B-TTS-2603
- [S24] MOSS-TTS family: https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5 ; https://huggingface.co/OpenMOSS-Team/MOSS-TTS ; https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Realtime ; https://github.com/OpenMOSS/MOSS-TTS
- [S25] Scicom-intl Multilingual TTS: https://huggingface.co/Scicom-intl/Multilingual-TTS-1.7B-Base ; https://huggingface.co/Scicom-intl/Multilingual-Expressive-TTS-1.7B ; https://github.com/Scicom-AI-Enterprise-Organization/Multilingual-TTS (README, README_V1.md, tts-evaluation/)
- [S26] neucodec (Apache 2.0): https://huggingface.co/neuphonic/neucodec
- [S27] mesolitica Malaysian TTS: https://huggingface.co/mesolitica/Malaysian-TTS-1.7B-v1 ; https://huggingface.co/mesolitica/Malaysian-TTS-4B-v0.1
- [S28] DistilCodec v1.0 (cc-by-nc-4.0): https://huggingface.co/IDEA-Emdoor/DistilCodec-v1.0
- [S29] MERaLiON-OmniVoice-Hokkien-TTS: https://huggingface.co/MERaLiON/MERaLiON-OmniVoice-Hokkien-TTS
- [S30] Artificial Analysis TTS leaderboard (checked 2026-09-25): https://artificialanalysis.ai/text-to-speech/leaderboard
- [S31] TTS Arena V2 (checked 2026-09-25): https://huggingface.co/spaces/TTS-AGI/TTS-Arena-V2 ; data https://tts-agi-tts-arena-v2.hf.space/api/leaderboard?type=tts
- [S32] NVIDIA Magpie TTS Multilingual 357M: https://huggingface.co/nvidia/magpie_tts_multilingual_357m
- [S33] Fun-CosyVoice3-0.5B-2512: https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512
- [S34] Other leaderboard models: https://huggingface.co/Zyphra/Zonos-v0.1-transformer ; https://huggingface.co/myshell-ai/OpenVoiceV2 ; https://huggingface.co/maya-research/maya1 ; https://huggingface.co/microsoft/VibeVoice-1.5B ; https://huggingface.co/stepfun-ai/Step-Audio-EditX
- [S35] Gemini 3.8 TTS: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts ; https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-8-text-to-speech/
- [S36] Phrase-Localized Language-Contrastive Guidance for code-switching TTS (arXiv 2609.01016): https://arxiv.org/abs/2609.01016
- [S37] Complex-text robustness for low-resource multilingual TTS (arXiv 2609.11545): https://arxiv.org/abs/2609.11545
- [S38] Singlish zero-shot TTS fine-tuning (arXiv 2607.23027): https://arxiv.org/abs/2607.23027
- [S39] Baseten model library: https://www.baseten.co/library/

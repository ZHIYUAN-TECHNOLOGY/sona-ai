# MiniCPM-o 4.5 fine-tune: run sheet (quality first)

Status: **running, 2 Oct 2026**: the run log below is current; the sections after it are the plan as agreed on 1 Oct. On 1 Oct the user asked to train every part, including voice, eyes and live turn-taking, and put quality before speed. This replaces the 2-day sprint in the [MiniCPM-o plan](minicpm-o-plan.md). **Judgement** marks my inference.

## Run log (sprint day 1, 1–2 Oct)

Everything lives on Baseten project `wgl1443` ("Sona MiniCPM-o").
- **Data:** private HF dataset `zhiyuantechnology/sona-minicpmo-data`:
  - `sft/`: hear 4,000, hear-answer 1,325, answer 3,291, eval 120 held out;
  - `see/`: 2,700 train, 300 test;
  - `voice/`: 12,133 clips, 17.9 h;
  - `packs/`: media as tars;
  - `recipe/` and `code/`: the job scripts.
- **Models:** private HF model repo `zhiyuantechnology/sona-minicpmo`, one branch per stage.

| Branch | What | Result |
|---|---|---|
| `smoke` (deleted 2 Oct for space) | 20-step LoRA on 200 clips, proving train, merge, voice put back and save | Loss 2.0 → 1.4 |
| `voice-v0` (deleted 2 Oct for space) | Talker, 6k steps on base brain states (job `wxk5y63`) | Held-out loss 3.80 → 3.08. Speaking test on held-out sentences: Malay 36.4% → **23.8%** word errors, Manglish 10.5 → 5.3%, English 0 → 2.5%, Mandarin 0.8 → 3.8% (10 clips each) |
| `stage1` | LoRA on brain + ear + eyes, 11,316 rows, 1 epoch, 1 h 02 min (job `3mk07ow`) | Train loss 0.67; held-out scores below |
| `live1` | Brain LoRA (r16, q/k/v/o) on stage 1 in the live layout: 1,265 spoken questions × 2 epochs, 25 min (job `wggn4vw`, `tools/omni-live-train`) | Loss 1.72 → 0.75. 60 held-out live calls against stage 1: talked over the patient 17 → **0**, replied in the patient's language 44 → **55**, median start 0.44 → 0.73 s after the question ended |
| `voice-v1` | Talker, 24k steps on stage 1 brain states (job `w59rzpq`), checkpoints every 2k | Held-out loss 3.78 → 3.12 at 10k, then 3.15–3.16. Speaking test with the stage 1 brain (final talker): Malay **14.6%**, Manglish 5.3%, English 1.2%, Mandarin **0.0%** |

**Voice, speaking test** (`tools/omni-eval/speak.py`, then `score.py`, then `page.py`; same held-out sentences, Sona's cloned voice, word errors of her speech against its own text):

| Language | Base | Voice v0 (base brain) | Voice v1 (stage 1 brain) |
|---|---|---|---|
| Malay (20) | 36.4% | 23.8% | **14.6%** |
| Manglish (5) | 10.5% | 5.3% | 5.3% |
| English (10) | 0.0% | 2.5% | 1.2% |
| Mandarin (10) | 0.8% | 3.8% | 0.0% |

Half of v1's Malay errors are drug names the checker spells the English way ("amoksisilin" heard as "amoxicillin"); the rest are real slips ("beberapa hari" heard as "bula perhari").

**Stage 1 lost `<|tts_eos|>` in chat mode.** LLaMA-Factory trained plain chat turns, so stage 1 ends a reply with `<|im_end|>`. `chat(generate_audio=True)` then hands the talker one token more than it has states for, and 5 of 45 sentences crashed (`speak.py` now ends the text at `<|im_end|>`). Live mode is not affected: it still ends turns with `<|turn_eos|>` (Mac test, 2 Oct). A later brain run should train its targets as `<|tts_bos|>…<|tts_eos|>`.

**Box ④ with stage 1 on an H100 (2 Oct, 6 test calls with audio, `check.py`): it cut off its own speech.**
- A second of the call took 0.6–0.74 s.
- Answers were right in English, and the 999 line came first for chest pain.
- Malay and Mandarin questions were answered in English.
- On the user's real Manglish recording it started 6.5 s before they finished.
- **The voice dropped words:** stage 1, live, writes up to 16 tokens a second. Her voice speaks about a second a unit and drops what is unsaid when the turn ends. Measured with the Manglish ASR on her audio: "…on October 8th at the specialist clinic" came out as "…on October."

live1 trains her pace: answers a second at a time at her speaking rate. The box's start message can also cap a unit's tokens (`max_speak_tokens`).

**Box ④ with live1 (2 Oct, production deployment `3m4kp29`, same 6 calls):**
- **What works:**
  - Her pace held at 2–4 tokens a second, so speech is no longer dropped.
  - The 999 answer was spoken whole.
  - On the user's Manglish recording she waited and started 1.6 s after they finished.
  - Seconds took 0.6–1.1 s.
- **First call after a start:** its first spoken second took 28.7 s (CUDA's first kernels in the voice). `live.py` now runs a warm-up call before `/health` answers.
- **Language shortcut:** Malay and Mandarin questions were still answered in English. Every training call's prompt named its answer's language ("answer in Malay"), so the model learnt to follow the prompt. With "Malay" in the prompt the same question got Malay.
  - In the product the agent names the app's language, so a Malay-app patient gets Malay.
  - The next live run should add calls whose prompt language differs from the spoken one.
- **Its voice garbled longer answers.** Speech checked against what she wrote, with the Manglish ASR, one call each, both voices on the same box (the start message picks `voice`):
  - talker v1: 13.3% of words wrong, e.g. "five days" heard as "every phase";
  - the model's own talker, with Sona's timbre: 7.8%.

  v1 learnt from stage 1's states in the chat layout ("read this aloud"), and its training never had the turn's last second as live has it (`<|turn_eos|>` alone, saying the rest).

**Voice v2 did not work yet.**
- **The tooling holds:** `train.py --layout live` takes the talker's inputs from live calls, and parity check 4 in `tools/omni-live-train/parity.py` matched a real call (16 tokens, states within 0.06).
- **First run** (job `q4xv2yw`, stopped at 4k steps): it trained from v1 on live1's states with each clip set in an unrelated patient call. Held-out loss rose, 2.51 → 2.68 → 2.70.
  - **Cause, measured on the Mac:** forced to write a stranger's words, the brain is unsure of them, at 4–6 nats a token.
  - A brief that tells it the words brings that to 0.8–4, as a real call's own answer would be.
- **Second try, Mac only** (told the words, 500 clips, 300 steps, lr 2e-5): held-out stayed flat, 2.75 → 2.76.
- **Next suspect: alignment.** Each clip's words are spread evenly over its seconds, while speech speeds up, slows down and pauses. The talker must then say words it has not been given, so the fit stays capped. Forced alignment of each clip's words to its audio would place them in the right seconds.
- **Meanwhile:** the live agent picks v1 for Malay calls and the model's own talker otherwise (`apps/server/src/agents/live.ts`).

**Live format (built 2 Oct, `tools/omni-live-train`; ran as job `wggn4vw`, results in the `live1` row).** Stage 1 learnt chat turns, and live it answered worse:
- It missed what was asked ("before or after food?" got the dose).
- It answered a Mandarin question in English.
- In one test call it started 1.7 s before the patient finished.

The fix trains the brain in the live layout itself:
- **Layout:** each second is `<unit>`, 10 audio embeddings, then `<|listen|>` or `<|speak|>` with a few words and `<|chunk_eos|>`; the turn ends with `<|turn_eos|>`.
- **Builder:** `layout.py` builds calls through the model's own prefill, with the brain swapped for a recorder.
- **Parity (`parity.py`, Mac, base model):** passes against a real call.
  - The embeddings are identical: 302 of 302, diff 0.
  - The brain's logits in one pass match the live ones at all 52 decision points.
  - The labels are exactly what the session wrote.
- **Training (`train.py`):** a LoRA on the brain over 1,265 of the 1,325 spoken questions in `sft/hear_answer.json`. Answers are paced at Sona's measured speaking rate: en 3.2, ms 4.2, zh 2.7, Manglish 3.9 tokens a second.
- **Live test:** the 60 held-out calls run live with the LoRA off (stage 1) and on, scoring:
  - when she starts, relative to the end of the question;
  - whether she spoke over the patient;
  - the reply's language;
  - 999 on emergencies.
- **Smoke run (Mac):** the whole pipeline works end to end, and the merged model loads and runs live.

Parity also found a serving bug, now fixed in box ④: `prepare()` keeps the ear's streaming cache from the previous call, so each call now starts with `reset_session()`, as OpenBMB's demo does.

**The label misreads come from the brain, not the eyes.** Stage 1 with the base model's eyes put back read 27/30 "read this label" photos, against 26/30 with its own eyes (Mac, fp16, `tools/omni-eval/see.py`). The same 3 clear labels fail either way; every other label question scores full marks.

**Held-out scores** (`eval/base.json`, `eval/stage1.json`; job `w6eze53`):

| Test | Base model | Stage 1 |
|---|---|---|
| Manglish word errors (150 clips, held-out voices) | 19.3% | **6.5%** |
| FLEURS Malay (50) | 33.9% | **17.3%** |
| FLEURS English (25) | 4.5% | 4.6% |
| FLEURS Mandarin (25) | 6.2% | **4.5%** |
| Red flags with 999 (30) | 26/30 | **30/30** |
| Labels: name and strength in the reply (89) | 84/89 | 60/89 |
| Unreadable labels: asks again (11) | 5/11 | 7/11 |

**Medical knowledge on public benchmarks** (2 Oct, job `wp7v1pw`, `tools/omni-train/bench.py`; `eval/bench-base.json` and `eval/bench-live1.json`).

Global-MMLU's medical questions, the same 500 in each language, answered with a letter:

| Language | Base model | live1 (deployed) |
|---|---|---|
| English | 70.0% | 71.8% |
| Malay | 59.8% | 60.6% |
| Mandarin, the 409 both answered with a letter | 66.0% | 66.0% |
| Mandarin, raw | 54.0% | 66.4% |

In Mandarin, base explained instead of giving a letter on 91 questions ("这道题考察的是…"), so its raw score is understated. Training kept the brain's medical knowledge; the small gains are within noise (about ±2 points at 500 questions). Malay trails English by about 11 points on the same questions, which is where Malay medical data can help.

K-QA (real patient questions with physicians' must-have statements): the first 40 of 100 judged blind in pairs, by Claude:
- live1 was better on 7, the base model on 6, and 27 were equal.
- Replies contradicting the physicians: live1 **7/40**, base 4/40.
- live1 is more often confidently permissive: "Yes, you can safely take Imodium" with a fatty liver (physicians: use with caution); "your blood pressure should be normal now" a day after starting lisinopril.

The sample is small, but it fits what stage 1 taught: short, sure answers. Stage 2's medical answers keep the source answer's cautions.

**Stage 2 data (2 Oct).**
- **Hearing, `sft/hear2.json`** (15,196 rows; `tools/omni-data/hear2.py`):
  - sona-manglish-asr clips stage 1 did not use: 5,000 clean and 5,000 noisy;
  - 2,000 of Sona's clips richest in medical words;
  - 3,196 clips (5.8 h) of real Malay speech from MagicHub's scripted and conversational corpora, kept where box ②'s ASR agreed.
- **Held out:** `sft/hear2_test.json`, 149 clips: one whole conversation, so its speakers are unseen.
- **The real speech is CC BY-NC-ND 4.0.** The user chose to train on it, 2 Oct ("Real yes"): demo-only, tagged, and retrained without before any hospital use, as with the Gemini audio.
- **Medical answers, `sft/answer_med.json`, with `sft/med_eval.json` held out** (`tools/omni-data/medical.py`): MedQuAD and medical-o1 answers rewritten short by Gemma in en/ms/zh, keeping the source's cautions.
  - 8,360 training rows (en 2,915, ms 2,954, zh 2,491; MedQuAD 5,811, medical-o1 2,549) and 319 held out by source, so no translation of a held-out answer trains.
  - Gemma then checked every row: a Malaysian patient could ask it, the reply answers it without a hospital-only treatment, and an emergency gets 999. It removed 2,422 rows, 44% of medical-o1's (law, chemistry, IV glucose as home advice, fainting with no 999). A spot-read of 60 held-out rows found about 4 still weak, mostly medical-o1.

**Stage 2 run (2 Oct, job `wgg1njw`, 2×H100):** stage 1's merged weights plus these sets and a replay of stage 1's (`data.py stage2`: 20,685 rows), 1 epoch, effective batch 16. Stage 1's H100 sat 69% idle (31% busy, one CPU core): the collator decodes every batch's audio and images, and it ran in the main process. Stage 2 adds 8 loader workers per GPU and runs DDP on two GPUs; batch stays 1 per GPU, since stage 1 used 54 of 80 GB at batch 1.
- **Lost at the push.** Training finished (loss about 0.8 at epoch 0.97), then Hugging Face refused the merged model: "Private repository storage limit reached". The org's free plan allows 100 GB of private storage and held 99.4 GB (`sona-minicpmo` 68.6 GB: about 19 GB for each merged branch, 18.3 GB of it the `smoke` branch). The adapter was in the same upload, so the run went with the container (about $10). With the user's approval the `smoke` and `voice-v0` branches and their files were deleted (20.4 GB; the org then held about 79 GB), and the run restarted as job `qkg86lw` with the adapter pushed first.
- **The rerun was lost too, at that new adapter push** (training loss 0.79, about $10). `upload_folder` validates the top-level README.md of the folder it sends, even into a subfolder, and PEFT's adapter card says `base_model: /workspace/base-train`, which HF rejects. `push.py` now leaves a top-level README.md out, a failed adapter push no longer stops the job, and the merged push carries the adapter again. Both pushes, with that card, passed a real upload to a throwaway branch.
- **The third run landed** (job `q9z6ljw`, 50 min): branch `stage2` at `86c314c5`, the adapter pushed first. stage1's merged weights were then deleted for space (approved; its `lora-adapter/` stays, so stage1 is the base plus that adapter). Started 13:48 MYT: the stage 2 test (`w59lm7q`: held-out sets, then the medical benchmarks) and `live2` (`qkg8x9w`: the live layer on stage 2, `RELANG=0.3`, so 30% of single-language questions are briefed with another fallback language).

**Stage 2 results (2 Oct)** (`eval/stage2.json`, `eval/bench-stage2.json`, Mac `tools/omni-eval/hear.py`; answers judged blind in shuffled pairs by Claude, not a clinician). Stage 2 passes: small gains and no regression beyond noise.

| Test | stage1 (K-QA and MMLU: `live1`) | stage2 |
|---|---|---|
| Manglish word errors (150) | 6.5% | **5.8%** |
| FLEURS Malay / English / Mandarin | 17.3% / 4.6% / 4.5% | **15.8%** / 4.6% / 5.7% (25 clips) |
| Revolab real speech (100, Mac) | 26.5% | **22.6%** (box ②'s ASR: 17.7%) |
| The user's 15 medical Manglish lines (Mac) | 11.8% | 12.3% |
| Real Malay speech from unseen speakers (149, new set) | not run | 28.3% |
| Red flags with 999 | 30/30 | 30/30 |
| Labels: name and strength (89) | 60/89 | **69/89** (base 84/89) |
| Patient questions answered with a medical error (90: 50 open, 40 on their own plan) | 11 | **9** (better 14, worse 13, equal 63) |
| K-QA replies contradicting the physicians (40) | 7 | **6** (better 15, worse 9, equal 16) |
| Global-MMLU medical, en / ms / zh (500 each) | 71.8% / 60.6% / 66.4% | 73.8% / 61.8% / 65.6% |

- Fixed: "don't press the wound" (Malay) and codeine for a dizzy patient.
- Still wrong in both: a missed rivaroxaban dose skipped instead of taken the same day, and instructions invented for medicines the plan does not list.
- `live1` scored 7/40 on K-QA both times it was judged, so the blind judge is consistent.

**live2 (2 Oct, job `qkg8x9w`, branch `live2` at `6429ab1f`)**: the live layer retrained on stage 2 with `RELANG=0.3`, 91 min. On the same 60 held-out live calls:

| Test | stage 2 alone | live2 | live1 (1 Oct) |
|---|---|---|---|
| Talked over the patient | 10 | **0** | 0 |
| Replied in the patient's language (hand-checked) | 33/60 by the script | **58/60** | 60/60 |
| Brief names another language, answered in the spoken one (hand-checked) | 13/36 by the script | **30/36** | followed the brief on box ④ |
| Median start after the question | 0.62 s | 0.73 s | 0.73 s |

- The script's language check calls short Malay replies English ("Faham, Puan. Fokus pada kesihatan Puan dulu ya."). By hand, all 5 of live1's misses and 6 of live2's 8 were right; live2's two real misses are English questions answered in Malay.
- One calm Malay question got the 999 line.

**Box ④ with live2 (2 Oct, deployment `qkjgr09`, deactivated after the test; live1 stays production)**, the same 6 calls with talker v1: every reply came in the language asked. Under the English-fallback brief, the Malay and Mandarin questions now got Malay and Mandarin (live1 answered both in English). First words came 0.9–1.7 s after the question ended. The 999 line came first for chest pain, and the appointment answer gave the plan's date and clinic. The Manglish cough reply was cut by the test's 10 s tail, not by the model. Replies: `live2-all-6.wav`, sent to the user for listening.
- The GPUs were still about 72% idle with the loader workers (28% busy each, 43 of 80 GB used), so loading audio was not what held them back.

**Hearing real speech** (2 Oct, Mac, `tools/omni-eval/hear.py`; mixed error as `tools/asr-data/baseline.py` counts it):

| Real speech | Base model | Stage 1 | Our Manglish ASR (box ②, all 667 Revolab clips) |
|---|---|---|---|
| User's voice: 15 medical Manglish lines | 28.4% | **11.8%** | 10.0% |
| Revolab: 100 real Malaysian clips | 45.3% | **26.5%** | 17.7% |

Stage 1 more than halved errors on real speech, which it never trained on. On the user's voice it is close to the dedicated ASR; on Revolab's real conversational speech it is still well behind. Errors left include "batuk" (cough) heard as "patuh", and "lepas makan" as "terbuka makan". It also writes "paracetamol" for "Panadol": right meaning, but scored as an error.

The label score above only checks that the reply repeats the name and strength. Re-scored per question type (stage 1's answers to "is this my medicine?" checked by hand):

| Label question | Base model | Stage 1 |
|---|---|---|
| "How do I take this?" (instruction read, or says the box has none) | 5/18 | **18/18** |
| "What medicine is this?" | 9/11 | **11/11** |
| "Is this my medicine?" against the plan, including wrong strengths | not checked | **30/30** |
| "Read this label for me" | 30/30 | 25/30: **5 readable labels called unreadable** |

Answers to the 90 held-out non-emergency questions, judged blind in pairs against each patient's plan (1 Oct, by Claude, not a clinician):
- Stage 1 was better on 22, the base model on 23, and 45 were equal.
- 12 replies from each model held a medical error:
  - shared: wrong first aid for a bleeding wound ("don't press it"), and medicines invented for questions the plan does not cover;
  - stage 1 only: a wrong follow-up date and weekday, "spicy food is fine after gastric surgery", and 999 for vomiting.

So stage 1 gains hearing, emergencies and labels, but not medical knowledge: answers are short and spoken, and no more accurate. The answers it learnt from were written by Gemma, so they cap it. Better answers need better teachers (reviewed answers, or tool lookups for plan facts).

The base model also answers with markdown (bold, lists), which is wrong for speech.

**What it took to get a job to train**, all now handled in `tools/omni-train/run.sh` and recorded in project memory:
1. Baseten's checkpoint volume fails to mount, so jobs push to HF instead.
2. HF allows 1,000 requests per 5 min, so media ships as tars.
3. `datasets` 4 needs `torchcodec` to decode audio, so the stored WAV bytes are written directly.
4. MiniCPM-o's code targets transformers 4.51 and LLaMA-Factory needs ≥ 4.55, so the training copy patches two lines.
5. Gradient checkpointing breaks MiniCPM-o's in-place embedding writes, so it is off.
6. Preprocessing used 16 multi-threaded workers; one thread each made it 60× faster.
7. From huggingface_hub 1.0 the `hf` CLI's `--exclude` takes one pattern, and the rest become file names, so only those download. Stage 2's first job got 9 asset files and no weights; `run.sh` now downloads with `snapshot_download` and stops if the weights are missing.
8. The tokenizer's workers type each column from their first batch of 1,000 rows. Stage 2's last worker began with text-only rows, typed `images` as null, then failed on the image replay: "Couldn't cast array of type list<item: string> to null". `preprocessing_batch_size: 100000` gives each worker one batch (replayed locally with the same set sizes).
9. The org's 100 GB of private Hugging Face storage filled up, and stage 2's merged push failed after training. `run.sh` now pushes the adapter (0.1 GB) on its own first, and `push.py` leaves the `checkpoint-*` folders out (1.1 GB a stage) and any top-level README.md (HF rejects PEFT's card, whose `base_model` is a local path).

## The brain against Gemma 26B (2 Oct)

`tools/omni-eval/gemma_bench.py` put box ①'s Gemma 4 26B (today's call's brain) through the same tests as MiniCPM-o's stage 2 brain; answers judged blind in shuffled pairs by Claude, not a clinician.

| Test | stage 2 (MiniCPM-o brain) | Gemma 4 26B | MedGemma 27B (judged against Gemma) |
|---|---|---|---|
| Global-MMLU medical, English (500) | 73.8% | **81.6%** | 75.4% |
| Global-MMLU medical, Malay (500) | 61.8% | **74.2%** | 70.4% |
| Global-MMLU medical, Mandarin (500) | 65.6% | **76.6%** | 70.4% |
| K-QA replies contradicting the physicians (40) | 5 | **0** (1 in the MedGemma round) | 5 |
| K-QA, judged better | 8 | **16** (16 equal) | 11 to Gemma's 12 (17 equal) |
| Patient questions answered with a medical error (90: 50 open, 40 on their own plan) | 9 | 6 (5 in the MedGemma round) | **3** |
| Patient questions, judged better | 17 | **30** (43 equal) | 19 to Gemma's 44 (27 equal) |

The gap is 8-12 exam points (largest in Malay) and clear on safety. Fine-tuning so far moved exam scores within ±2 points. Gemma's own plan errors are mostly 999 for a catch-all "if you feel unwell".

MedGemma 27B (box ⑥, `packages/infra/baseten/medgemma27`, vLLM on one H100, up for the bench and live4's teaching answers, then deactivated) is not a stronger teacher than Gemma 4 26B: lower exam scores in all three languages and more K-QA contradictions. Its plan answers made the fewest errors but lost mostly on language (English replies to Malay questions). Two scoring fixes came out of it:
- With no system prompt, MedGemma thinks first (`<unused94>thought`), so the 8-token multiple-choice reply had no letter. `BENCH_MC_TOKENS=1024` lets it finish, and the parser skips the thinking.
- The parser took the first A-D anywhere, so "Jawapan yang betul ialah **B**" counted as A. Both benches now take a lone letter. Re-scoring every stored reply changed only the base model, by at most 0.8 points.

## live4: the brain from bigger teachers (2 Oct, running)

Stage 3 (job `3mko9kw`, 2×H100) trained 50,161 rows in 3,136 steps and 109 min (2.1 s a step), about $26. Loss went from 1.13 to 0.88 (mean 0.92). It pushed `stage3` @ `0c02230c`. live4 (job `wngk943`) and the stage 3 scoring job (`wp7nv8w`) started together at 01:53.

Stage 3 continues from live3's weights with LoRA on every attention and MLP projection at rank 64 (stages 1-2: q and v at rank 32), the ear frozen, one epoch on 2×H100 (`MODE=stage3`, `data.py`). live4 then retrains the live layer on it (`BRAIN=stage3`, numbers as words), as live3 did on stage 2.

| Set | Rows | Source |
|---|---|---|
| knowledge | 32,942 | OpenMed Medical-Reasoning-SFT-Mega 15,000 (minus 58 that send patients to 911), medical-o1 6,000 English and 6,000 Chinese, MedReason 6,000. Final answers only, at most 1,800 characters, markdown flattened |
| knowledge_ms | 5,994 | MedReason and medical-o1 English, translated into Malaysian Malay by Gemma 26B (box ①) |
| knowledge_medgemma | 6,000 | MedGemma 27B on MedQuAD consumer questions |
| replays | 5,225 | answer_med 2,000, hear_answer (numbers as words) 1,325, hear 800, answer 800, see 300 |

Every Global-MMLU medical, K-QA, sft/eval and med_eval question is left out (`knowledge.py tests()`). Two fixes went into the MedGemma answers before training:
- **Facts:** alone, MedGemma made up rare-disease facts. It said isobutyryl-CoA dehydrogenase deficiency affects leucine; it is valine. For the 1,935 questions where MedQuAD kept the NIH answer (GARD, GHR and other NIH sources), MedGemma now answers from that text.
- **999:** the prompt asked when to call 999, so 67% of answers ended with "call 999 if …". The live call already over-escalates (live3: 999 for a cough), so `publish` drops that last sentence from 3,545 answers. Poisoning, overdose and emergency questions keep it.

**Result: stage 3 is worse than stage 2.** Same tests and blind judges as above; each brain was judged against Gemma 4 26B in its own round.

| Test | stage 2 | stage 3 | Gemma 4 26B |
|---|---|---|---|
| Global-MMLU medical, English / Malay / Mandarin | 73.8 / 61.8 / 65.6% | 73.2 / 58.2 / 65.8% | **81.6 / 74.2 / 76.6%** |
| K-QA replies contradicting the physicians (40) | 5 | 11 | **0-1** |
| Patient questions answered with a medical error (90: 50 open, 40 on their own plan) | 9 | 11 | 5-6 |
| Hearing error, Manglish / FLEURS en / FLEURS zh / real Malay | 5.8 / 4.6 / 5.7 / 28.3% | 5.3 / 3.5 / 4.2 / 29.6% | |
| Red flags sent to 999 / label name and strength | 30/30 / 69 of 89 | 30/30 / 64 of 89 | |

The 50,161 answers from bigger models moved neither exam score, and in Malay the brain switched to "A. option" replies and lost 3.6 points. They made it more confident, not more correct: stage 3 calls loperamide "generally safe" with a fatty liver, says steroids are contraindicated in pregnancy for ulcerative colitis, and suggests ibuprofen for a child whose plan points to dengue. The teachers' assertive exam-style answers transferred; their knowledge did not. An 8B brain holds about what its pretraining gave it, and LoRA fine-tuning shapes how it answers. **live3 (stage 2's brain) stays the best MiniCPM-o version.**

live4 (job `wngk943`, about $11) finished at 03:33 and pushed `live4` @ `d663bb4b`. Its live layer behaves like live3's on the 60 held-out spoken questions: none spoken over the patient, first words at 0.73 s, the spoken language followed 30 of 36 times (live3: 28). Its brain is stage 3's, so it was not scored again or put on box ④. Sprint spend at the end: about $165 of the $200 cap (training $149, box ④ $11, MedGemma $4.55).

**Where this leaves the one-model call.** MiniCPM-o 8B hears Manglish well and talks naturally, but its brain stays 8-16 exam points and clearly on safety behind Gemma 4 26B, and fine-tuning did not close that. Replacing ASR, Gemma and the voice with it is not safe for medical answers. Next options: Gemma writes the answer and MiniCPM-o speaks it through the call agent (Gemini Live's half-cascade shape), or a bigger open speech model (Qwen3-Omni 30B-A3B) as the next candidate.

## Voice v3 plan: numbers and Manglish (2 Oct, after the user listened to live2)

**Problem (user, 2 Oct):** Sona's spoken words are sometimes wrong, mostly numbers ("38°C") and Chinese words.

**Causes found:**
1. **Live, the talker reads one second of text at a time and cannot look ahead.** On box ④, "999" came to it as "99" then "9", "2026" as "202" then "6", and "38°C" across two units. It has to start saying a number before it has seen all of it.
2. **Its training clips rarely contain numbers or mixed Chinese.** Of the 12,133 voice clips (17.9 h), 2.5% contain digits, 91 contain units (°, mg, ml, %), and almost none put Chinese characters inside a Malay or English sentence. The 159 that mix scripts are Chinese sentences with the word "App".
3. **The speaking test reads whole sentences in the chat layout**, so it never tested the live, one-second reading where these errors happen.

**Fix, in order:**

| Step | What | Time | Cost |
|---|---|---|---|
| 0 | A hard speaking test in the live layout, about 120 lines: numbers, doses, dates, temperatures and 999; Malay and English with Chinese words; Mandarin. Scored by box ②'s Manglish ASR and by ear. Baselines: talker v1, the model's own talker (7.8% against v1's 13.3% earlier), VoxCPM2 | 2 h | about $3 |
| 1 | The brain writes numbers as spoken words in live mode, in the sentence's language ("tiga puluh lapan darjah Celsius", "thirty-eight degrees", "三十八度"; 999 digit by digit). A small en/ms/zh verbaliser rewrites the live training answers, then the live layer is retrained (live3: stage 2 plus the live LoRA, `RELANG` 0.3). The talker then only reads words, which it does well, and no number can split across units. No added latency | 3 h | about $10 |
| 2 | Talker v3 on targeted clips in the live layout: about 4,000 new lines (numbers in spoken form, Manglish with Chinese words, Mandarin) written by Gemma, voiced in Sona's voice (Gemini Kore for mixed lines, VoxCPM2 for single-language ones), kept only when the ASR hears them back right. Words force-aligned to the audio (the suspected voice-v2 fault), with a replay of today's clips | 1 day | about $25 |
| 3 | Box ④ with live3 and talker v3: the hard test again, the 6 calls, and the user's ears | 30 min | about $2 |

Pass: numbers right in every hard-test line, at most 5% word errors per language, and the user approves by ear. Until then VoxCPM2, today's call, stays the voice users hear.

**Started 2 Oct, 16:00 MYT** (the user asked for Gemini TTS with a Malaysian accent as the talker's new data, and approved the fix and the deletions):
- `tools/omni-voice/spoken.py` writes numbers as words in en/ms/zh. `sft/hear_answer_words.json` is the live set with all 209 answers' numbers in words. live3 (job `q8rknp3`: stage 2, `DATA=hear_answer_words`, `RELANG=0.3`) trains on it.
- `tools/omni-voice/lines_v3.py`: Gemma writes about 4,000 lines in seven categories (numbers as words in ms/en/zh/Manglish, Chinese inside Malay or English, Malay or English inside Mandarin, Manglish). 25 of each are held out as the hard speaking test.
- `tools/omni-voice/voice3.py`: Gemini TTS (Kore, asked for a Malaysian accent) voices the training lines, and only clips the Manglish ASR hears back within 5% are kept. They are published as `voice3/` with lang "num" or "mix", so the talker's even language sampling gives them a third of its steps (`VOICE3=1` in `tools/omni-voice-train/run.sh`).
- `tools/omni-eval/hard.py` scores `speak.py` (`SPEAK_LINES=voice3/test.jsonl`) per category, comparing numbers as words.
- For space (approved): deleted voice-v1's 11 intermediate talkers and stage1's adapter checkpoints, and stage2's merged weights once live3 has loaded them.
- **live3 landed** (job `q8rknp3`, 92 min; branch `live3` at `dc3db4cc`). On the 60 held-out live calls none of its replies has a digit (stage 2 alone: 4), e.g. "记得在十月十五号复诊". It talked over the patient 0 times, replied in the patient's language on 58/60 by hand (the script said 53: five short Malay replies read as English), and on 28/36 calls whose brief named another language it answered in the spoken one.
- **Gemini read its accent instruction aloud** before nearly every one of the 3,668 clips (each 4-6 s too long). A system instruction is refused by `gemini-3.8-flash-tts`, and shorter in-text prompts leaked too. `voice3.py trim` cuts each clip at the pause after the instruction's closing colon (3,667 clips). The Manglish ASR then keeps only clips where exactly the line is left: in 24 samples, every instruction was gone.

## 2-day version (user, 1 Oct evening: everything trained, but in 2 days)

The stages below are kept and run in parallel instead of in sequence. Five things are cut to fit:

1. **One stage 1 run** (brain + ear + eyes together, as run C). No separate A/B comparison of the ear.
2. **Turn-taking is tuned first, trained only if our trainer is ready.** Day 1 tunes MiniCPM-o's own listen/speak bias (`listen_prob_scale`, a live-mode setting in its code) against the timed cut-in harness. A turn-taking LoRA runs only if our trainer passes its parity test by the evening of day 1.
3. **Voice data ~15–20 h instead of ~50 h:**
   - Malay ~10 h, English ~3 h, Mandarin ~3 h, all from VoxCPM2 batch jobs;
   - Manglish ~2 h from Gemini's Kore voice, the one Sona's voice was trained from.

   The voice first trains on the base brain's states, in parallel with stage 1, then gets a short re-tune on the final brain's states on day 2.
4. **No flow (timbre) fine-tune.** Sona's timbre comes from MiniCPM-o copying her voice from a reference clip.
5. **Tests:** 20 turns (all 10 red flags) plus the user's own listening instead of the full 60 turns and a listener panel. VoxCPM2 stays the Malay fallback until Malay passes.

Day 1:
- box ④ (base model) and the agent;
- stage 1 data, voice data and our trainers in parallel subagents;
- stage 1 run;
- first voice run;
- turn-taking tuning.

Day 2:
- voice re-tune;
- box ④ v1 (all parts);
- 20-turn test and listening;
- one fix-up round;
- decide the demo engine.

Cost: about $300 (±$100) at list prices.

All parts below are inside the one MiniCPM-o 4.5 model (`openbmb/MiniCPM-o-4_5@503e754`). The names in brackets say which open model each part started as.

## What we train

| Part | Training code | How |
|---|---|---|
| Brain (`llm`, from Qwen3-8B) | Official: LLaMA-Factory `minicpm_o` [M3] | LoRA on chat-format data |
| Ear (`apm`, from Whisper-medium) | Official, with `freeze_vision_tower: false` [lf-visual] | LoRA, same run as the brain |
| Eyes (`vpm`, from SigLIP2) | Official: images in the same run [M3] | LoRA, same run |
| Live turn-taking (`<\|listen\|>` / `<\|speak\|>` per 1-second unit) | **None published.** Ours | LoRA on the brain (and ear) in the live 1-second format |
| Voice (`tts` talker, ≈0.3B) | **None published.** The model code has no loss at all [M2]. Ours | Full fine-tune on Sona's voice in en, ms, zh |
| Voice timbre (CosyVoice2 flow + HiFT, `assets/token2wav`) | CosyVoice2's own training recipe (**judgement**: the same architecture, unverified) | Optional fine-tune on Sona's voice |

Evidence that no official trainer exists for the voice or the live format:
- OpenBMB's official fine-tune script loads the model with `init_audio=False, init_tts=False` (`finetune/finetune.py` in OpenBMB/MiniCPM-V).
- LLaMA-Factory trains audio in, text out only.
- The MiniCPM-o-Demo repo holds serving code only.

### Why not swap in our Qwen3-ASR as the ear

It is not a drop-in part (from `config.json`, both repos):

| | Qwen3-ASR | MiniCPM-o's ear |
|---|---|---|
| Input | 128-bin audio features | 80-bin audio features |
| Output size | 2048 | 4096, after its adapter |
| Trained with | Its own 1.7B decoder, which holds much of our Manglish fine-tune | MiniCPM-o's brain |

Instead:
- the ear trains on the same Manglish data;
- Qwen3-ASR keeps running beside it for the transcript and the 999 rule.

## Rule zero: prove our trainers match the model first

Our own trainers must feed the model exactly what live mode feeds it. That means the same 1-second audio chunks (`chunk_ms` 1000, `first_chunk_ms` 1035, `cnn_redundancy_ms` 20), the same `<unit>` layout, and the same talker inputs.

Before any custom training, a **parity test** runs one call through both paths and requires equal logits:
- our training forward;
- the model's own live path (`MiniCPMODuplex.streaming_prefill` / `streaming_generate`, `tts.generate_chunk`).

A silent mismatch would cost quality without any error, so this test blocks stages 2 and 3.

## Stage 1: brain, ear, eyes (official LLaMA-Factory)

**Data: about 10,500 examples, all synthetic.** The 5 held-out plans and the test conversations are never trained on.

| Set | Examples | Built from |
|---|---|---|
| Hear | 4,000 | `zhiyuantechnology/sona-manglish-asr` (`mixed` config): 3,000 synthetic Manglish turns, half with noise scenes, plus 1,000 FLEURS ms/zh/en. Target: the exact words |
| Hear and answer | ~1,500 | Patient turns from its 510 training conversations (3,709 patient turns). Gemma keeps the lines a patient could say to Sona Care and writes the reply against a plan for the same condition |
| Answer anything (user, 1 Oct: not limited to the discharge plan) | ~4,000, text | Open medical Q&A and doctor–patient dialogue in en, ms and zh, plus general everyday questions, picked by licence in [omni-training-datasets](research/omni-training-datasets.md) (research running 1 Oct). Plus ~1,000 Gemma questions on 30 synthetic plans, so plan questions are still answered from the plan. Red flags (999) and "worse" (care team) are kept in every set |
| See | ~3,000 | Rendered medicine boxes, strips and pharmacy labels in ms/en/zh (name, strength, "Ambil 1 biji 3 kali sehari"), photo-like (angle, blur, glare). Questions: read the label; "is this my amlodipine?" against the plan |

**Rules for every reply:**
- **Prompt:** today's `VOICE` prompt minus its JSON flags line, because MiniCPM-o speaks every word it writes.
- **Checks:** every red-flag reply carries the 999 line. No content limit otherwise (user, 1 Oct).
- **Label reads:** say only what the label shows, and never a dose the plan doesn't state.

**Recipe** (cookbook-based; LLaMA-Factory `ce9dc9e`):
- `template: minicpm_o`, `finetuning_type: lora`, `lora_target: q_proj,v_proj`, rank 32 / alpha 64;
- `cutoff_len: 3072`, learning rate 1e-4, cosine schedule, 1 epoch, batch 2 × 8, bf16.

**Runs:**
- **A (brain only)** and **B (brain + ear, `freeze_vision_tower: false`)** run in parallel without images, to measure the ear's gain.
- The better setting then trains **C**: all four sets including images, which also trains the eyes.
- A 20-step smoke run comes first.

## Stage 2: live turn-taking (our trainer)

**Teaches:**
- don't jump in during Manglish pauses ("ah…", "lah", 1–2 s of thinking);
- answer once the patient has finished;
- stop within one unit when cut off;
- stay quiet in silence;
- don't talk over slow, older speakers.

**Data: ~1,500 synthetic calls (~25–40 h, judgement):**
- **Patient side:** existing Manglish patient audio and the stage 1 spoken questions.
- **Sona side:** reply text, voiced by VoxCPM2 for timing.
- **Placement:** turns sit on a timeline with pauses, cut-ins, silences and mid-call red flags.
- **Labels per second:** `<|listen|>`, or `<|speak|>` plus that second's text tokens. Word times come from Qwen3-ForcedAligner (box ②).
- **Pacing:** the tokens-per-unit pace is calibrated first by measuring the base model in live mode, so labels match how it already paces speech.

**Recipe:**
- LoRA (peft) on top of merged C.
- Loss on decisions and text, with extra weight on listen↔speak switches.
- Low learning rate, so the base model's live skills are kept.

## Stage 3: voice (our trainer)

**Teaches:**
- Sona's own voice in every language;
- a Malaysian accent in English and Mandarin;
- **Malay speech**, so no hand-off to VoxCPM2;
- drug names said right;
- following the tuned brain, whose last layer the talker reads.

**Gate first: the Malay speech-token check (run 1 Oct, on the Mac, $0).**

How it ran:
- 300 clips, each turned into MiniCPM-o's speech tokens and back, always in the model's own default voice: `tools/omni-eval/roundtrip.py`.
- Our Manglish ASR (`mixed-final`) then read every clip before and after: `tools/omni-eval/score.py`.
- Results, audio and a listening page: `~/zyt/data/sona-omni/malay-check/`.

| Set | Word errors before | After the tokens | Rise |
|---|---|---|---|
| Malay, Sona's voice (50 hospital lines) | 7.5% | 7.2% | −0.3 |
| English, Sona's voice (50) | 0.5% | 0.5% | 0.0 |
| Mandarin, Sona's voice (50) | 1.2% | 2.5% | +1.3 |
| Malay, FLEURS real speakers (40) | 10.7% | 22.6% | **+11.9** |
| English, FLEURS real speakers (40) | 4.2% | 10.7% | +6.6 |
| Mandarin, FLEURS real speakers (40) | 2.5% | 3.8% | +1.3 |
| Revolab, real Malaysian conversation (30) | 14.6% | 32.0% | +17.4 |

**Verdict under the rule fixed before running: FAIL.**
- Sona's voice passes: −0.3 against a 5-point limit.
- FLEURS fails: +11.9 against a 9.8-point limit (1.5 × English's +6.6).

What it means:
- **The voice we would train survives.** The tokens carry Malay spoken in Sona's voice with no loss, so a talker trained on Sona's voice can in principle speak Malay.
- **Real Malay speakers lose almost twice as much as English speakers.** One Revolab clip came back heard as Chinese. So the tokenizer is less robust on Malay than on English or Mandarin, its home languages.
- **Consequence for training data:** voice training must use clean Sona-voice audio only, never real-speaker Malay.
- **The ear is unaffected.** It hears through Whisper, not these tokens.

**Rerun with Sona's voice as the fixed voice (1 Oct):** `VOICE=<Sona en_22.wav> SETS=ms_sona,ms_fleurs,en_fleurs`, saved in `~/zyt/data/sona-omni/malay-check-sona-voice/`.

| Set | Rise |
|---|---|
| Malay, Sona's voice | +2.6 (still within the limit) |
| Malay, FLEURS real speakers | +17.8 |
| English, FLEURS real speakers | +6.8 |

The default voice's accent was not the cause: real-speaker Malay lost more in Sona's voice. The tokenizer's Malay weakness on real speech is real.

**Next check: can untrained MiniCPM-o speak Malay at all?** `tools/omni-eval/speak.py` makes it read 20 Malay sentences (plus 10 English, 10 Mandarin and 5 Manglish) in Sona's cloned voice. `score.py` then compares its speech with the text it wrote.

**Decision pending (user):**
- either train native Malay with stage 3's bars, Malay spoken WER ≤ 5% and listener ≥ 4/5, keeping VoxCPM2 as the automatic fallback until those pass;
- or treat the FAIL as binding: Malay stays on VoxCPM2, and the voice trains on English and Mandarin only.

**Data: ~50 h in Sona's voice** (judgement: Malay ~30 h, because it is new to the talker; English ~10 h; Mandarin ~10 h):
- **Voice:** the fine-tuned VoxCPM2 voice (rated ms 5, en 5, zh 4) reads replies from the stage 1 data, the nurse lines and all 150 glossary terms (`tools/tts-eval/terms.json`). It runs as a batch job on 1×H100, not on live box ②.
- **Kept clips:** ASR round trip ≤ 5% errors, and speaker similarity to Sona's reference above a set bar. Both are scored with the CookBook's `evaluation/tts_seed` tools.

**Recipe:**
- The final brain (C plus stage 2) runs teacher-forced in the live format to produce the talker's inputs per unit.
- The talker trains in its live layout (each unit's ≤ 20 text inputs, then 25 speech tokens) with a full fine-tune.
- Then an optional flow fine-tune on Sona's voice with CosyVoice2's recipe.

## Pass bars (held-out data; base and today's call measured on day 1)

| Area | Bar |
|---|---|
| Ear | Manglish word errors clearly below base (target ≥ 20% relative), measured on the test, noisy, Revolab and your 15 recordings; not worse on FLEURS en/zh |
| Safety | 30/30 held-out red flags give the 999 line; answers about the patient's own medicines match their plan ≥ 95% (Gemma judges) |
| Eyes | Medicine name and strength read exactly on ≥ 95% of held-out rendered labels, and on 20 real photos you take (eval only) |
| Turn-taking | On 60 timed calls: interrupts the patient in ≤ 1 of 20 pause tests; stops within 1 unit on ≥ 9/10 cut-ins; answers within 2 units of the end of a turn |
| Voice | Spoken WER ≤ 5% per language; Malaysian listener ≥ 4/5 in each language (VoxCPM2's bar); speaker similarity at or above VoxCPM2's |
| Whole call | [Sona-S2S-60](research/s2s-models.md#evaluation-plan-after-the-cascade-is-complete) with all safety bars, beating today's call on latency or naturalness |

Each stage ships only if it passes; otherwise the previous stage's model stays.

## Time and cost (estimates, list prices)

| Stage | Wall time | GPU cost |
|---|---|---|
| 0: box ④ up, parity tests, pacing study, tokenizer gate, baselines | day 1 | ~$40 |
| 1: brain, ear, eyes (A, B, then C) | days 1–2 | ~$45 |
| 2: turn-taking (data, trainer, 2–3 runs) | days 3–5 | ~$60 |
| 3: voice (data job, trainer, 2–3 runs, optional flow) | days 3–7, data from day 2 | ~$90 |
| Whole-call test and listener ratings | day 8 | — |
| Box ④ on 1×H100 while testing (~40 h at $6.50) | throughout | ~$260 |
| **Total** | **~8 working days** | **~$500 (±$150)** |

Data jobs and trainers run in parallel subagents. The first usable upgrade (stage 1) lands on day 2.

## Risks

1. **Our trainers don't match live mode.** The parity tests block training until they pass.
2. **Live skills fade.** The live format is trained on synthetic calls only. Use a low learning rate, and keep the stage 1 model if the turn-taking bars fail.
3. **Malay fails the tokenizer gate.** Malay stays on VoxCPM2; the voice still gains Sona's identity and accent in English and Mandarin.
4. **Version clash** (`transformers` ≥ 4.55 for LLaMA-Factory against 4.51 in the model code). The smoke run checks it.
5. **Data rights.** The audio comes from Gemini and VoxCPM2 (itself trained on Gemini voices). This model is competition and demo only until it is retrained on clean data ([ASR licence rules](asr-training-plan.md#licences)).

## Approvals needed

1. The longer timeline: about 8 working days instead of 2.
2. About $500 (±$150) of Baseten H100 time across all stages; each job still asks before it starts.
3. Two new private HF repos, following the ASR and VoxCPM2 pattern:
   - `sona-minicpmo-data`: the training examples, with config `sft` for stages 1–2 and config `voice` for Sona's voice clips. Training jobs read from it.
   - `sona-minicpmo`: the trained model, one tagged revision per stage that passes. Box ④ loads from it.
4. 20 real medicine-box photos from you, for testing the eyes only.

[lf-visual]: https://github.com/hiyouga/LlamaFactory/blob/main/src/llamafactory/model/model_utils/visual.py
[M2]: https://huggingface.co/openbmb/MiniCPM-o-4_5/tree/main
[M3]: https://github.com/OpenSQZ/MiniCPM-V-CookBook/blob/main/finetune/llamafactory/finetune_llamafactory.md

# MiniCPM-o stage 1 training data

Builds the LLaMA-Factory data for stage 1 of the [MiniCPM-o fine-tune](../../docs/minicpm-o-finetune.md): brain + ear, sharegpt format, uploaded to the private HF dataset `zhiyuantechnology/sona-minicpmo-data`, folder `sft/`.

- **Build location:** `~/zyt/data/sona-omni/sft/`. Audio is hard-linked from `~/zyt/data/sona-asr`.
- **Writer:** Gemma on box ① writes the replies. Its calls are cached in `sft/raw/`, so a rerun resumes.

Run the steps in order with a Python that has `pyarrow` and `huggingface_hub`: `python build.py hear|plans|hear_answer|answer|eval|upload`.

| File | Step | What |
|---|---|---|
| `hear.json` | `hear` | Manglish consultation clips (half with noise scenes) and FLEURS train, answered with the exact words: the ear |
| `plans.json` | `plans` | 35 synthetic discharge plans in `planText` layout. 30 train; 5 held out for `eval.json` only |
| `hear_answer.json` | `hear_answer` | A patient's spoken line from those consultations, answered by Sona Care with a plan in the system prompt |
| `answer.json` | `answer` | Text questions with Sona Care's replies: own-plan questions, open health and medicine questions, everyday chat, and emergencies |
| `eval.json` | `eval` | Held out, never trained on: emergencies (must give the 999 line), open questions and held-out-plan questions, each with the key facts a reply must carry |
| `dataset_info.json` | `upload` | The three training sets for LLaMA-Factory: `sona_hear`, `sona_hear_answer`, `sona_answer` |

**Built 1 Oct 2026** (HF revision `e8ef8bd`):

| File | Rows | en | ms | zh |
|---|---|---|---|---|
| `hear.json` | 4,000 | 1,334 | 1,333 | 1,333 |
| `hear_answer.json` | 1,325 | 438 | 429 | 458 |
| `answer.json` | 3,291 | 1,615 | 1,105 | 571 |
| `eval.json` (held out) | 120 | — | — | — |

- **Inside `hear_answer.json`:** 59 emergencies and 34 "worse" reports.
- **`answer.json` sources:** 2,431 Gemma-written (1,021 own-plan, 960 open medical, 300 everyday, 150 emergencies), 360 MedQuAD, 300 medical-o1, 200 Aya Malay.
- **`eval.json` kinds:** 30 emergencies, 50 open questions, 40 questions on the 5 held-out plans.
- **Not used:** SEA-Instruct-2602, which is gated; our token gets 403 until its terms are accepted on Hugging Face.

**System prompt.** It is `SYSTEM` in `build.py`: the live `VOICE` prompt (`packages/api/src/voice-agent/answer.ts`) without its JSON flags line, because MiniCPM-o speaks every word it writes. The live MiniCPM-o agent must send the same text.

**Emergency replies** start with Sona's own 999 line (`LINES.*.call999`), and Gemma's own 999 sentence is dropped, as the live agent does.

**Licences.**
- Clip audio is Gemini TTS (from the ASR set), so it is competition and demo only (ASR plan licence rules).
- FLEURS is CC BY 4.0.
- Replies and questions are written by Gemma (Gemma terms).
- Each row's `source` field says which.

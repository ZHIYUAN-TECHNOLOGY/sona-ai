# MiniCPM-o 4.5 live voice: training and hosting plan

Status: **draft for user review, 1 Oct 2026.** Nothing here is agreed or started.

Training plan history:
- Cut to a 2-day sprint at the user's request (see [Sprint](#sprint-2-days)).
- Later on 1 Oct, the user put quality first and asked to train voice, eyes and turn-taking too. The training plan is now [minicpm-o-finetune.md](minicpm-o-finetune.md), about 8 working days. It replaces the sprint's training cuts. It builds on the user's 28 Sep choice in the [delivery plan](delivery-plan.md#after-the-cascade-open-speech-to-speech-added-27-sep-optional) (MiniCPM-o 4.5, with VoxCPM2 speaking Malay) and on the [speech-to-speech research](research/s2s-models.md). Call-flow visual: https://claude.ai/artifact/9WBm27DdU2mdoVb5Vf4FMe

Sources are `[M#]` at the end. **Judgement** marks my inference; (calc) marks my arithmetic.

## Can it meet the requirements?

| Requirement | Verdict | How |
|---|---|---|
| Understands Manglish | Likely, after tuning | LoRA on the ear and brain with Manglish audio. Out of the box it hears English and Chinese only [M1]. Proven only by the 60-turn test. |
| Replies with a Malaysian accent | Partly | Malay: VoxCPM2 speaks it (rated Malay 5/5 on 29 Sep, [TTS training](tts-training.md)). English and Mandarin: MiniCPM-o's own voice, cloned from a clip of Sona's voice [M1]; how Malaysian it sounds is untested. A native Malay voice inside MiniCPM-o needs our own training code (track C) and may fail. |
| Medical answers | Yes, with limits | Brain LoRA on grounded after-discharge dialogues, the plan in the system prompt, and today's rule check before anything is spoken. The brain is Qwen3-8B, smaller than Gemma 4 26B. Safety bars are absolute (10/10 red flags). |
| Fine-tune on Baseten | Yes | Training Jobs runs any framework in our container [M6]. Ear and brain: LLaMA-Factory's official MiniCPM-o 4.5 recipe [M3]. Mouth: our own script. |
| Host on Baseten | Yes, one call per GPU | A custom server over WebSocket, like Baseten's Voxtral realtime recipe [M7]. The official server runs one live session per GPU [M4], and each WebSocket stays on its replica [M8]. Whether an L4 is fast enough is the first thing to test. |

## How MiniCPM-o makes a reply

Read from the model's own code, `modeling_minicpmo.py`, `utils.py` and `config.json` (repo modified 18 Aug 2026) [M2]:

- **Parts** (all inside the one MiniCPM-o model; each name says which open model the part started as):

  | Part | Component |
  |---|---|
  | Ear | Whisper-medium encoder |
  | Eyes | SigLIP2 |
  | Brain | Qwen3-8B (36 layers, 40,960-token context) |
  | Mouth | A 20-layer talker (hidden size 768, ≈0.3B (calc)) writes CosyVoice2 speech tokens (25 per second, 6,561 codes). CosyVoice2's flow-matching and HiFT vocoder (`assets/token2wav`) turn the tokens into sound, in the voice of a reference clip. |

- **Live mode runs in 1-second units.**
  - Each second, the brain takes in 1 s of audio and, optionally, one camera frame.
  - It then outputs either `<|listen|>`, or `<|speak|>` followed by up to 20 text tokens.
  - Only then does the talker turn that text into about 1 s of speech.
- **The talker reads the text plus the brain's last-layer state** (`condition_type: hidden_text_merge`, `tts_proj_layer=-1`). Two consequences:
  1. Text exists before its audio, and `generate_audio=False` returns text only. So a check can sit between text and speech, and Malay text can go to VoxCPM2 instead.
  2. Tuning the brain shifts what the talker reads, so the voice must be re-checked after every brain LoRA.
- **No training code for the mouth.** The model code has no loss or labels anywhere. OpenBMB's fine-tuning covers audio in and text out only [M3].
- **Long calls:** the sliding window keeps the system prompt (the plan) and drops the oldest units [M2].

## Architecture

```
Patient's phone (Sona Care)           Cloudflare (built today)                       Baseten US
mic, 16 kHz ─────────────► SonaVoiceAgent (Durable Object, one per patient) ─WSS─► box ④ sona-live (new)
speaker ◄─ approved audio ─┤ • holds each unit's audio until its sentence          MiniCPM-o 4.5 + our LoRA
                           │   is complete; 999 line first on an emergency sign    1-second live loop
                           │ • logs the transcript; escalate() → care-team task    returns {text, audio, listen|speak}
                           │ • Malay: sends checked sentences ────────────────────► box ② VoxCPM2 (built)
                           └──► Doctor's My Day (transcript, flags)
```

**Box ④ `sona-live` (new)**
- One MiniCPM-o model and one call per replica.
- Truss `docker_server` with a WebSocket endpoint (`runtime.transport.kind: websocket`), `predict_concurrency: 1`, and autoscaling `concurrency_target: 1` [M7][M8].
- Weights live in a private HF repo, like the ASR and VoxCPM2 fine-tunes.

As built, 2 Oct (`packages/infra/baseten/live`; not deployed yet, waiting on its H100 approval):
- **Server:** our own small server, `data/live.py`, around the model's `MiniCPMODuplex`, instead of OpenBMB's demo worker.
- **Protocol:**
  - In: a `start` message with Sona's brief and the patient's plan, then 16 kHz PCM16.
  - Out: for each second heard, `{listen, text, end_of_turn}`, then that second of Sona's voice as 24 kHz PCM16.
- **Model:** the stage 1 brain, with Sona's trained talker. Her timbre comes from the reference clip her talker trained with.
- **Local test, Mac, text only** (the voice decoder needs CUDA): back-to-back calls in English, Malay and Mandarin.
  - It listened through each question, then answered.
  - First words came 0.5–1.6 s after the question ended.
  - The Mac took 0.35 s per listening second and 0.6–0.75 s per speaking second.
- **Check:** `check.py <question.wav> [url]` plays a recording at phone speed, prints each second's decision and saves her reply.
- **The model cannot stop mid-answer.** `MiniCPMODuplex` turns `<|listen|>` into speech until the turn ends, so a cut-in is the phone's: it stops her audio, and the agent drops the rest of that answer.

**GPU:** whichever passes the speed gate first, cheapest first.

| Option | Engine | $/h per live call [M9] | Fits? | Speed |
|---|---|---|---|---|
| L4 24 GB | llama.cpp-omni GGUF (or our own AWQ int4) | 0.85 | Officially full-duplex from 12 GB [M1] | Unmeasured. bf16 cannot keep up: 20 tokens × 16 GB ÷ 300 GB/s ≈ 1.1 s per 1 s unit (calc) |
| H100 MIG 40 GB | PyTorch bf16 (official server) | 3.75 | The official server needs > 28 GB and uses ~21.5 GB [M4] | Likely fine (**judgement**) |
| A100 80 GB | PyTorch bf16 | 4.00 | Yes | 0.9 s per unit; 0.5 s with torch.compile [M4] |

**Cloudflare side**

Today's `SonaVoiceAgent` is `withVoice(Agent)` from the Agents SDK (`agents` 0.24.0, `agents/voice`). It runs on a SQLite-backed Durable Object (binding `VOICE` in `packages/infra/alchemy.run.ts`).

`withVoice` is a fixed pipeline: speech-to-text, then `onTurn` text, then text-to-speech. It has no hook for a speech-to-speech model.

`SonaLiveAgent` is therefore built differently:
- **Base:** `withVoiceInput(Agent)`, the SDK's listen-only mixin, on a new Durable Object binding.
- **Audio in:** its transcriber session's `feed()` receives every raw 16 kHz PCM chunk. Our session sends each chunk to box ④ and to box ② ASR, which keeps the transcript and the 999 floor.
- **Audio out:** replies go back on the same voice protocol (`audio_config`, `status`, `transcript`, binary audio).
- **Not used:** the SDK's Workers AI STT/TTS adapters, and its Cloudflare Realtime SFU (WebRTC) helpers. WebRTC would need an app change.

As built, 2 Oct:
- **Code:** `apps/server/src/agents/live.ts`, plus `packages/api/src/voice-agent/live.ts` for the brief and the relay, which is tested.
- **Switch:** binding `LIVE`. `voiceRoute` sends patients to it only when `SONA_LIVE_URL` names box ④'s socket; empty, which is the default, keeps today's call. The app's route is the same either way.
- **Brief:** the system prompt stage 1 trained on, word for word: answer.ts's rules without the JSON flags line.
- **Kept checks:**
  - **999 floor:** the patient's words come from box ②. If they name an emergency sign and Sona has not said 999 within 6 s, her 999 line is sent for her.
  - **Care team:** words that may report feeling worse go to the care team's own reader, as a check-in reply does.
- **Not yet run end to end:** it needs box ④ deployed and a signed-in test phone.

**No limit on what Sona says (user, 1 Oct)**
- Sona answers any question. The old sentence check (numbers only from the plan, no dose change, no diagnosis words) was removed from `packages/api/src/voice-agent/answer.ts`.
- Two things stay, because they add rather than block:
  - the 999 line first on an emergency sign;
  - a care-team task when the patient reports feeling worse.
- Decisive facts about the patient, such as their doses, medicines and appointments, come from their record. The agent loads the plan from the database each turn and puts it in the prompt. Tool calls for wider lookups are the next step (see the answer of 1 Oct).

**Interruptions**
- ~~Native: when the patient talks over Sona, the model outputs `<|listen|>` and the agent tells the phone to drop queued audio.~~ Not so (2 Oct, from the model code): it cannot listen mid-answer, so the phone's cut-in stops her, as today.
- Today's phone gate mutes the mic while Sona is audible (`apps/care/lib/live-voice/gate.ts`), because react-native-audio-api 0.13 has no iOS echo cancellation.
- The gate still lets a loud cut-in through, so interruptions work. But the model cannot hear quiet speech over Sona until echo cancellation lands (react-native-audio-api 1.0 `iosVoiceProcessing`).

**Camera (optional, later):** MiniCPM-o takes up to 10 frames a second [M1]. One frame per unit would let a patient show a medicine box mid-call. Images go to the US, so synthetic data only, same as today.

**Privacy:** unchanged. Baseten US means synthetic data only until the Malaysia/Singapore move.

## Training

Every job:
- runs on Baseten Training Jobs, 1×H100 at $6.50/h;
- is started through the Baseten MCP like the ASR and TTS runs, each after your approval;
- reads its dataset from a private HF dataset repo;
- syncs checkpoints from `BT_CHECKPOINT_DIR`.

### A. Ear and brain (one LoRA run)

Run sheet with exact data, config and pass bars: [minicpm-o-finetune.md](minicpm-o-finetune.md). Note: LLaMA-Factory's default LoRA trains the brain only; the ear needs `freeze_vision_tower: false`.

| | |
|---|---|
| Recipe | LLaMA-Factory's MiniCPM-o 4.5 audio fine-tune: `finetuning_type: lora`, `lora_target: q_proj,v_proj`; merge with `llamafactory-cli export` [M3] |
| Ear data | The 8,000 synthetic Manglish turns (29.2 h) and FLEURS ms/zh/en from the ASR work, as "`<audio>` transcribe" → exact text |
| Brain data | New. Gemma (box ①) writes fictional after-discharge dialogues on synthetic plans, in en, ms, zh and Manglish, covering: in-plan questions; out-of-plan questions to defer; red flags (999 line plus care team); small talk. Gemini batch voices the patient lines with the ASR pipeline (`tools/asr-data`), with held-out voices for the test split. Targets are answer texts that pass `safeSentence`. Size: 3,000–6,000 turns, about 10–20 h (**judgement**; no source says what is enough) |
| Format | `{"messages": [{"role": "user", "content": "<audio>…"}, {"role": "assistant", "content": "…"}], "audios": [...]}`, with the plan in the system message [M3] |
| Runs | 2–4 runs × 1–3 h ≈ $15–80 |
| Watch for | The recipe trains turn-by-turn chat, not the live 1-second format. Check that live turn-taking survives: it does not talk over the patient, and it stops when cut off. Also check that its own English and Mandarin voice still reads the text correctly, since the talker reads the brain's last layer |

### B. Malaysian accent without training (do this first)

- **How:** voice cloning. Give MiniCPM-o's audio system prompt a clean clip of Sona's VoxCPM2 voice speaking English, and another speaking Mandarin [M1].
- **Rating:** by ear, on the same 1–5 sheet as the TTS rounds.
- **Cost:** only box time.

### C. Native Malay mouth (research, optional)

Only if the gate in step 1 passes and you want Malay without VoxCPM2.

1. **Tokenizer gate (half a day, on box ④):**
   - Turn 50 of VoxCPM2's Malay clips into CosyVoice2 tokens (`speech_tokenizer_v2_25hz.onnx`), then back into sound (flow + HiFT).
   - Score the result with our Manglish ASR.
   - If Malay words don't survive, stop: the talker can't learn sounds the tokenizer can't hold.
2. **Data:** VoxCPM2 (box ②, ≈0.3× real time since 1 Oct) reads Malay, English and Mandarin replies from the A dataset, 20–100 h in total. **Judgement:** much more than VoxCPM2 needed, because the talker has never seen Malay; VoxCPM2 already knew Malay and needed only 4.35 h to change accent.
3. **Conditions:** run the merged A model over each dialogue to get the last-layer states for each reply (teacher-forced), as the talker sees them live.
4. **Train:**
   - Full fine-tune of the ≈0.3B talker with our own loop (cross-entropy on speech tokens).
   - Keep some English and Mandarin data so they don't regress.
   - Flow-matching and the vocoder stay frozen.
   - No LoRA: on VoxCPM2 it barely changed the voice ([TTS training](tts-training.md)).
5. **Check:** ASR round trip, and a Malaysian listener rating of ≥ 4/5 in each language (the same bar as VoxCPM2).

- **Effort:** 1–2 weeks.
- **Cost:** $40–150 (estimate).
- **Serving:** on PyTorch the new talker just loads. On an L4 it would first need converting to llama.cpp-omni's format, and that conversion is not documented.

## Sprint: 2 days

On 1 Oct the user asked for 2 days, or 1 if possible. This replaces the earlier two-week phases.
- **Day 1 alone:** a live call on the base model.
- **Day 2:** adds the Manglish LoRA.

On day 1, three subagents work in parallel, each in its own worktree: box ④, the agent, and the training data.

### Day 1: live call on the base model

| Hours | Work | Done when |
|---|---|---|
| 0–3 | **Box ④:** a thin WebSocket server around `MiniCPMODuplex` (1 s of audio in; sentence text and MP3 out; text only for Malay). Truss `docker_server` on 1×H100 | A laptop client hears a spoken reply |
| 0–3 | **Agent:** a `SonaLiveAgent` beside `SonaVoiceAgent`, chosen by a server-side flag. It keeps the phone protocol (PCM16 16 kHz up; JSON events and one MP3 per sentence down), so no new app build. Malay sentences go to VoxCPM2. Box ② ASR keeps the patient's transcript, the 999 floor and care-team tasks | Unit tests pass; today's call is unchanged |
| 0–3 | **Data:** convert the 8,000 ASR turns and FLEURS to LLaMA-Factory format. Gemma writes ~2,000 text-only after-discharge turns in en, ms, zh and Manglish | Dataset on HF (private) |
| 3–4 | Start LoRA v0 (1×H100, 1–2 h) | Job running |
| 4–7 | Deploy to staging. Call from the laptop harness (`apps/server/test/voice-call.ts`), then from the iPhone (TestFlight Sona Care 5). Run a 20-turn smoke test (10 red flags, 10 Manglish) against today's call | Red flags 10/10; latency measured |

### Day 2: Manglish LoRA

| Hours | Work | Done when |
|---|---|---|
| 0–2 | Merge LoRA v0, push it to HF, redeploy box ④ | The box answers |
| 2–4 | Re-run the 20 turns on the base model, LoRA v0 and today's call. Check turn-taking and the own voice after the LoRA | A results table |
| 4–5 | Decide which engine the demo uses; write the results into the handoff | Decision recorded |

**Sprint cost** at list prices:
- box ④: about 15–20 warm hours × $6.50 ≈ $100–130;
- training: 1–2 runs ≈ $7–26;
- no new Gemini spend.

### Cut to fit

- Manglish tuning uses the existing ASR audio plus text-only medical dialogues; no new voiced dialogues.
- A 20-turn smoke test instead of 60. All 10 red flags stay, and the bar stays 10/10.
- It runs on a full H100 ($6.50/h) to skip speed work.
- Out: the native Malay voice (track C), more than one try at voice cloning, the camera, and phone echo cancellation.
- Today's call stays the default and the fallback.

### After the sprint (only if it wins)

- A cheaper GPU: L4 with llama.cpp-omni, or H100 MIG.
- The full 60-turn test ([Sona-S2S-60](research/s2s-models.md#evaluation-plan-after-the-cascade-is-complete)).
- Voiced medical dialogues.
- Track C.

## Running cost

- One live call holds one GPU for its whole length [M4][M8]: $0.85/h per simultaneous call on an L4, $3.75/h on an H100 MIG. Today's voice call shares boxes ① and ② with everything else.
- Example (calc): 3 simultaneous calls over 10 clinic hours on 22 days costs ≈ $560/month on L4s, or ≈ $2,475/month on H100 MIGs.
- A cold box adds model load (~16 s, official figure [M4]) plus container start, so keep one replica warm during clinic hours.

## Risks

1. **L4 too slow for 1-second units.** Move to an H100 MIG (4.4× the price per call).
2. **LoRA weakens live turn-taking or the own voice.** The training is turn-by-turn, and the talker reads brain states. Mitigation: low rank, a small learning rate, and the phase 2 checks. Worst case: keep the base brain, with VoxCPM2 for all speech.
3. **Our LoRA may not convert to llama.cpp-omni GGUF** (undocumented). Fallback: PyTorch on an H100 MIG.
4. **The 8B brain is weaker than Gemma 26B at grounding.** Mitigation: the rule check, the plan in the prompt, and absolute safety bars. If it still fails, keep Gemma for answers, as today's call does.
5. **Training audio from Gemini TTS is for the competition model only,** under the [ASR plan's licence rules](asr-training-plan.md#licences). Regenerate or retrain on clean data before hospital use.

6. **Sprint risks:**
   - LLaMA-Factory's MiniCPM-o 4.5 support may need a different `transformers` version than the model's 4.51.
   - Each box ④ build takes about 25–45 min (box ② takes 25), so plan for only 2–3 deploy cycles a day.

## Decisions for you

1. **Box ④:** approve running it on 1×H100 at $6.50/h while warm (it scales to zero)?
2. **Training:** approve 1–2 LoRA runs on 1×H100 at about $7–13 each?
3. **Scope:** accept the cut list above?

## Sources

Checked 1 Oct 2026.

- [M1] MiniCPM-o 4.5 model card (released 2026-02-03, modified 2026-08-18) and GitHub README (news to 2026-06-25): https://huggingface.co/openbmb/MiniCPM-o-4_5 , https://github.com/OpenBMB/MiniCPM-o
- [M2] MiniCPM-o 4.5 code: `modeling_minicpmo.py` (`MiniCPMODuplex.streaming_generate`, `_generate_speech_non_streaming`, `MiniCPMTTS`), `utils.py` (`DuplexWindowConfig`, system-prompt preservation), `config.json` (`tts_config`), `assets/token2wav/`: https://huggingface.co/openbmb/MiniCPM-o-4_5/tree/main
- [M3] MiniCPM-V CookBook, LLaMA-Factory fine-tuning guide: https://github.com/OpenSQZ/MiniCPM-V-CookBook/blob/main/finetune/llamafactory/finetune_llamafactory.md
- [M4] MiniCPM-o-Demo README (one GPU per worker, ~21.5 GB per worker, > 28 GB GPU, ~0.9 s per unit on A100): https://github.com/OpenBMB/MiniCPM-o-Demo
- [M5] MiniCPM-o 4.5 paper, arXiv 2604.27393: https://arxiv.org/abs/2604.27393
- [M6] Baseten Training Jobs, supported frameworks: https://docs.baseten.co/training/overview
- [M7] Baseten Voxtral realtime recipe (WebSocket `docker_server`): https://docs.baseten.co/examples/models/transcription/voxtral
- [M8] Baseten WebSocket scheduling (a connection stays on its replica and counts toward concurrency while open): https://docs.baseten.co/development/model/websockets#scheduling
- [M9] Baseten instance prices from the Baseten API, 1 Oct 2026 (per minute × 60): L4 $0.85/h, H100 MIG $3.75/h, A100 $4.00/h, H100 $6.50/h

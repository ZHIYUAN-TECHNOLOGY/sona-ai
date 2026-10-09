# 06 · Sona Care live voice call

[Diagram](06-care-voice-call.html) · [SVG](06-care-voice-call.svg) · [PNG](06-care-voice-call.png) · [source](06-care-voice-call.archify.json)

**Answers:** how a patient talks to Sona hands-free, and how a warning sign reaches the care team.

## What it shows

- **Connect:** Sona Care (iPhone, `apps/care/lib/live-voice/`, or web, `apps/web/src/features/care-ask/call.tsx`) opens `wss://…/agents/sona-voice-agent/<user id>?lang=en|ms|zh` with the session cookie. The Worker checks the id is the session's user and names the Durable Object `hospital/patient` from the care link, never from the path (`apps/server/src/agents/voice.ts`, `voiceRoute`). On connect the agent warms the voice and brain boxes.
- **Hear a turn:** the phone streams PCM16 at 16 kHz. An energy VAD on the agent (`packages/api/src/voice-agent/listen.ts`) starts a turn after 300 ms of loud frames and ends it after 500 ms of quiet or at 30 s. The whole turn goes to `sona-voice` `/v1/audio/transcriptions`.
- **Answer:** a red-flag word (`callNow`, English, Malay, Chinese) speaks the 999 line before Gemma is asked. Gemma on `sona-brain` streams the answer; its first word is the triage label, then sentences, cut as they arrive (`answer.ts`). Each sentence goes to `sona-voice` `/v1/tts/stream` and comes back as 48 kHz PCM pieces (`voice-agent/voice.ts`). A sentence not ready within 8 s (16 s after the first) is read by the phone's own voice, labelled.
- **Escalate:** a reply judged worse or urgent creates or reuses a care-team task (`care-team.ts`, owner "Attending doctor"); only after the task exists does Sona say "I've let your care team know".

## Key decisions

- Three models in Malaysia (ASR, Gemma, VoxCPM2) instead of one speech-to-speech model: the MiniCPM-o sprint (2-3 Oct) found its 8B brain behind Gemma on medical answers and safety. `SonaLiveAgent` exists and is off unless `SONA_LIVE_URL` is set.
- Instead of iOS echo cancellation, the phone mutes the mic while Sona is audible and 800 ms after; cutting in needs speech louder than her echo for 200 ms (`apps/care/lib/live-voice/gate.ts`).
- Sona answers anything the patient asks, not only from the discharge plan; grounding withholds sentences with unsupported facts.

## Measured (from the handoff, 1 Oct, staging)

Warm: heard 1.5 s after the patient stopped, first words 2.3 s, first audio 3.5 s. The first call after a deploy was cold (17.7 s).

## Known limits

- **Not streaming ASR:** each turn is transcribed whole after the VAD ends it. Gemma and TTS stream.
- Echo gate and cut-in constants are still to be tuned on a physical iPhone.
- Sona Pro's microphone does not use this agent.

Checked against code at `cd76571b` on 8 Oct 2026.

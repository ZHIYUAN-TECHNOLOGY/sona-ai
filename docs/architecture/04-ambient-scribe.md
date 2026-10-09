# 04 · Ambient scribe: consultation to coded note

[Diagram](04-ambient-scribe.html) · [SVG](04-ambient-scribe.svg) · [PNG](04-ambient-scribe.png) · [source](04-ambient-scribe.archify.json)

**Answers:** how a spoken consultation in any mix of English, Malay and Mandarin becomes a reviewed note with ICD-10 codes.

## What it shows

1. **Record** on Sona Pro iPhone: 16 kHz mono 16-bit WAV (`apps/native/features/live/voice-input.ts`).
2. **12 s parts**: a part is cut at the first 0.3 s pause after 12 s, and at 20 s regardless (`SOFT_MS`, `HARD_MS`, `apps/native/features/scribe/live.ts`). Parts go one at a time so each carries the voice memory from the last.
3. **`voice.transcribe`** on the Worker: audio is decoded and forwarded, never stored (`packages/api/src/routers/index.ts`).
4. **Sona Speech** on `sona-voice`: Nemotron-3-Diarization finds who spoke when (up to 8 voices), then Qwen3-ASR transcribes each turn on its own (`packages/infra/baseten/voice/data/voices.py`, `diar_server.py`). It returns turns and a new voice memory (a float16 speaker cache, about 0.4 MB); the box keeps nothing between parts. A part with no speech keeps the previous memory (`nextMemory`).
5. **Name the voices**: once stopped, "Who is Voice 3?" with that voice's longest line; one tap names it (Clinician, Patient, Family, Nurse, Interpreter, Other, or a typed name). "Same person as" merges two voices; merging is never automatic.
6. **Draft note** on Sona Med (`sona-brain`, Gemma 4 26B): sentences are numbered with voice and role; vLLM's `response_format: json_object` keeps the reply valid JSON; every statement cites sentence numbers (`packages/api/src/scribe-model.ts`).
7. **Grounding check** on the Worker (`checkDraft`): a statement is dropped if it cites nothing in range, if any number or medicine in it is not in the transcript (numbers read from digits and from English, Malay and Chinese words), or if an assessment or plan rests only on patient or family sentences. The draft and its turns are logged to `provenance`.
8. **Review + save**: the doctor edits; `note.save` appends a new revision (a stale revision is refused).
9. **ICD-10 codes** (`claim.suggestCodes`): Sona Med picks from WHO ICD-10 candidates found for the note's words; a code is kept only if it cites a sentence that states it (no negation before it), and the route drops any code whose evidence is not a note sentence id or whose diagnosis code is not in `icd10_codes`.

## Measured (from the handoff, synthetic)

- 20 synthetic consultations of 2-8 people (`tools/diar-eval`): 97.1% of turns to the right person with 12 s parts and memory handed on.
- Real rooms with several real people are not yet scored.

## Known limits

- The web has no recorder; its scribe card drafts from a pasted transcript (`apps/web/src/features/visit/note.tsx`).
- `json_object` mode holds the reply to valid JSON, not to a schema; the shape is checked in code.
- One real voice can be heard as two (different registers); the doctor merges them.

Checked against code at `cd76571b` on 8 Oct 2026.

# Sona technical architecture

One diagram per question a judge, a hospital IT team or a new engineer would ask. Every box, arrow and label was checked against the code at commit `cd76571b` (`main`, 8 Oct 2026). Where the code and the docs disagree, the diagrams follow the code; the disagreements are listed at the end.

**Read this first:** everything here describes **staging**. It holds synthetic patients only (`Demo General Hospital (synthetic)`, `SYN-` record numbers). Every model runs in AWS Malaysia (`ap-southeast-5`); the database (Neon, Singapore) and the Worker, Durable Objects and R2 (Cloudflare) do not.

Each document has an explorable HTML diagram (light and dark, pan, zoom, search, export), its archify JSON source, an exported SVG and PNG, and a short note.

| # | Document | Question it answers | Type | Checked |
| --- | --- | --- | --- | --- |
| 01 | [System context](01-system-context.md) · [diagram](01-system-context.html) | Who uses Sona, through which app, and which outside systems it talks to | Architecture | 8 Oct 2026, `cd76571b` |
| 02 | [Deployment on staging](02-deployment.md) · [diagram](02-deployment.html) | What runs where; exactly what is in Malaysia today | Architecture | 8 Oct 2026, `cd76571b` |
| 03 | [Where patient data goes](03-data-privacy.md) · [diagram](03-data-privacy.html) | What each model sees, what is stored, what is deleted, where it lives | Architecture (data flow) | 8 Oct 2026, `cd76571b` |
| 04 | [Ambient scribe](04-ambient-scribe.md) · [diagram](04-ambient-scribe.html) | How a consultation becomes a reviewed, coded note | Workflow | 8 Oct 2026, `cd76571b` |
| 05 | [Guarantee letter to discharge](05-guarantee-letter.md) · [diagram](05-guarantee-letter.html) | The claim's states, who moves them, what blocks send and discharge | State map | 8 Oct 2026, `cd76571b` |
| 06 | [Sona Care live voice call](06-care-voice-call.md) · [diagram](06-care-voice-call.html) | How a patient talks to Sona and how a warning sign escalates | Sequence | 8 Oct 2026, `cd76571b` |
| 07 | [Check-ins and care-team tasks](07-care-check-ins.md) · [diagram](07-care-check-ins.html) | What happens after discharge; replies to tasks; the demo clock | Workflow | 8 Oct 2026, `cd76571b` |
| 08 | [Model seam and fallbacks](08-model-layer.md) · [diagram](08-model-layer.html) | How routes reach models, what happens when one is down, model names | Architecture | 8 Oct 2026, `cd76571b` |
| 09 | [Evidence answers with citations](09-retrieval-evidence.md) · [diagram](09-retrieval-evidence.html) | Hybrid retrieval, reranking, PubMed, citation checks, X-ray similarity | Architecture | 8 Oct 2026, `cd76571b` |

Sona Care (the brief's item 6) is split into 06 and 07 because the live call and the check-in agent are separate mechanisms.

## Files

- `NN-name.html`: the diagram. Open in a browser; it needs no network.
- `NN-name.archify.json`: the source. Re-render with the archify skill: `node bin/archify.mjs deliver <type> NN-name.archify.json NN-name.html --quality showcase` (types: 01, 02, 03, 05, 08, 09 `architecture`; 04, 07 `workflow`; 06 `sequence`).
- `NN-name.svg` (light and dark themes in one file) and `NN-name.png` (light): exports for slides and documents.
- `checks/`: archify's browser evidence for each diagram (`*.visual-check.json` and screenshots at 1440×900 and 2048×1320, light and dark).

All nine passed archify's showcase validation (9 of 9 artifact checks, no errors or warnings) and its browser check (no overflow at 1440×900, 1600×1000, 1920×1080, 2048×1320). Each was also reviewed by eye in its exported PNG.

## Earlier diagrams

| Diagram | Status |
| --- | --- |
| [docs/diagrams/sona-infra.html](../diagrams/sona-infra.html) (4 Oct) | **Superseded by 02.** It shows model boxes as "planned"; they now run on SageMaker in Malaysia. Left in place. |
| [docs/diagrams/live-voice.html](../diagrams/live-voice.html), [streaming-call.html](../diagrams/streaming-call.html) | Design history for the live call; 06 is the call as built. |
| [docs/diagrams/sona-model-integration.html](../diagrams/sona-model-integration.html) | Superseded by 08 for how models are wired today. |
| [docs/diagrams/minicpm-*.html](../diagrams/), [sona-live-hybrid.html](../diagrams/sona-live-hybrid.html), [smart-turn-pipeline.html](../diagrams/smart-turn-pipeline.html) | The MiniCPM-o live-call sprint (2-3 Oct); that agent is built but off. |
| [docs/diagrams/continuous-training.html](../diagrams/continuous-training.html), [care-chat.html](../diagrams/care-chat.html), [sona-pro-two-ears.html](../diagrams/sona-pro-two-ears.html) | Not covered here; still the reference for their topics. |
| `~/Documents/sona-ai/pitch/deck/diagrams/sona-system.html` (8 Oct, pitch) | Same picture as 02 at pitch detail. Its R2 box says "audio, X-rays": **no audio is stored in R2**. |
| `~/Documents/sona-ai/pitch/deck/diagrams/consultation-to-note.html` (8 Oct, pitch) | Matches 04 (12 s parts, by 20 s). 04 adds the server, the grounding check and the code check. |

## Where the code and the docs disagree

The code wins in every diagram. Fix these docs or comments when convenient:

1. **Audio in R2.** `packages/infra/alchemy.run.ts` says the bucket holds "Audio and X-ray uploads (presigned URLs from the Worker)", and the pitch system diagram says "audio, X-rays". No audio is ever written to R2, and there is no presigned-URL code.
2. **Sona Privacy coverage.** The handoff implies de-identification in front of the models. In code, the OpenMed model runs only on training samples; evidence questions use rules only; scanned notes replace only the name text; every other model call (scribe, codes, appeals, replies, triage) gets text as written.
3. **The transcript is kept.** The scribe screen says "audio deleted once transcribed", which is true, but the transcript turns are stored in `provenance` with the note draft.
4. **Embedder host.** The handoff's mocks table and adapter paragraph say embeddings run on Workers AI; staging names `embed=sona-embed`, and the code prefers it (`apps/server/src/context.ts`). Workers AI is only the fallback.
5. **Baseten key required on SageMaker.** The SageMaker path is a fetch wrapper inside the Baseten adapter; without `BASETEN_API_KEY` every model answers from the stub, even with every box on SageMaker.
6. **Wake and health on SageMaker.** The handoff's wake-before-call design (minutes until ready) holds only on Baseten and for Laya; on SageMaker, wake and health answer 200 locally and a missing endpoint just falls back to the stub.
7. **Timeouts.** The handoff says every call has a 30 s timeout (8 s reranker). Code also has 60 s for evidence, 90 s for the scribe draft, 5 s for Laya.
8. **Agents count.** The handoff says two Durable Objects on the Agents SDK; the code has four agent classes (CheckIn, Watch, Voice, Live) plus two plain Durable Objects.
9. **Live voice call.** The handoff says one MP3 per sentence and "no sentence held back"; code streams 48 kHz PCM per sentence (`/v1/tts/stream`, MP3 is the fallback) and grounding withholds unsupported sentences. ASR is per turn after the VAD, not streaming.
10. **Laya routing.** `docs/evidence-answer-spec.md` and `laya.ts` say Laya replaces the regex router; in code the regex runs first on the iPhone (evidence never reaches Laya), and the web does not call `ask.route`.
11. **Evidence spec.** `docs/evidence-answer-spec.md` marks `encounterId` required (it is optional), lists sources as studies then library (films and the patient record come first), and shows synthesis and reranking as mocks (both are hosted).
12. **Cron comment.** `apps/server/src/index.ts` says the nightly audit cron "only logs"; it runs `runNightlyAudit`.
13. **Bug found, not fixed (app code is out of scope):** `noteDraftOf` in `packages/api/src/routers/training.ts` reads `provenance.output.text`, but a note draft has no `text` field, so a live scribe draft never becomes a training input.
14. **Insurer link clocks.** `sentAt` is written with the demo clock, but the insurer page checks expiry against real time.

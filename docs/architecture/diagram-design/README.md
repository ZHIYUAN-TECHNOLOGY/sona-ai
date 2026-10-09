# Sona architecture: diagram-design edition

The same nine diagrams as [the archify set](../index.md), redrawn with the diagram-design skill in Sona Pro's brand (profile `sona`: canvas `#f5f6f8`, ink `#1d1f23`, Sona blue `#245bcc` as the one focal colour, teal `#0f6e66` for calls to outside systems; Inter names, Geist Mono technical labels, Instrument Serif titles; tokens from `apps/web/src/styles/tokens.css`). Facts are unchanged: they come from the verified notes `../NN-*.md`, checked against the code at `cd76571b` on 8 Oct 2026. Staging only, synthetic patients.

Each diagram has a light page (`NN-name.html`), a dark page (`NN-name-dark.html`), and exports of the light diagram (`NN-name.svg`, `NN-name.png`, transparent background). Every page passes the skill's `self_check.py` and was reviewed by eye in both themes.

| # | Diagram | Type | Note |
| --- | --- | --- | --- |
| 01 | [System context](01-system-context.html) | Architecture | [note](../01-system-context.md) |
| 02 | [Deployment on staging](02-deployment.html) | Deployment | [note](../02-deployment.md) |
| 03 | [Where patient data goes](03-data-privacy.html) | Architecture, residency zones | [note](../03-data-privacy.md) |
| 04 | [Ambient scribe](04-ambient-scribe.html) | Swimlane | [note](../04-ambient-scribe.md) |
| 05 | [Guarantee letter to discharge](05-guarantee-letter.html) | State machine | [note](../05-guarantee-letter.md) |
| 06 | [Sona Care live voice call](06-care-voice-call.html) | Sequence | [note](../06-care-voice-call.md) |
| 07 | [Check-ins and care-team tasks](07-care-check-ins.html) | Swimlane | [note](../07-care-check-ins.md) |
| 08 | [Model seam and fallbacks](08-model-layer.html) | Architecture | [note](../08-model-layer.md) |
| 09 | [Evidence answers with citations](09-retrieval-evidence.html) | Architecture | [note](../09-retrieval-evidence.md) |

## What changed from the archify set

The skill caps a diagram at 9 nodes, so some boxes were merged; nothing was dropped, the detail moved into sublabels or the cards under each diagram.

- **01:** each person is folded into their app (staff into Sona Pro, patients into Sona Care); Expo push and Cloudflare Email are one "Notifications" node, now with the check-in push to Sona Care drawn.
- **02:** the Durable Object classes are rows inside the Worker, and the six model hosts are rows inside one SageMaker node and one Lambda node.
- **03:** the insurer page moved into a card; the residency zones (Neon Singapore, Cloudflare, Malaysia) are drawn around the boxes.
- **04:** "Record visit" and "12 s parts" are one step.
- **05:** sent and appealed sit inside the insurer link page; the `denied → sent` resend, which the code allows, is now drawn.
- **08:** "Routes + agents" folds into the Models interface; each endpoint shows its method count (15 + 2 + 5 + 1 = 23).
- **09:** "Question" folds into `evidence.stream`, and `chunks` into Hybrid search.

To draw more diagrams in this skin, put a `.diagram-design` file containing `profile: sona` at the repo root; it points the skill at the saved profile `~/.diagram-design/profiles/sona.md` (on the author's machine; this worktree has the marker locally, not committed).

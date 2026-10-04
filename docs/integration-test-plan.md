# Integration test plan: Sona Pro, Sona Care and the links between them

Written 4 October 2026 from a read of the code (two mapping passes; nothing here has been run yet). It lists what to
test with real models, in what order, and what the read already suggests is broken or only looks like AI.

## Conditions for a real test

- The server has its model key and the boxes are up: Gemma, the ear and voice box, MedGemma and Laya (about $4.60 an
  hour together on SageMaker in Malaysia), the PII model on Lambda. A cold or failing box answers from the stub, labelled
  `source: "fixture"`: every check reads `source` and `model`, not only the text.
- Sona Pro: signed in as the demo doctor, with "Connect to the hospital record" on. Without it every screen is sample data.
- Sona Care: signed in as the demo patient (Amelia, SYN-1042), who starts admitted, not discharged, with no plan.
- A temporary Neon branch and a local server, so staging's demo data stays as it is.
- Repeats return stored answers (`answerOnce`): change the input to prove a model is up.

## Phase B: each AI feature at the server (no screens)

| Feature | Route | Model | Passes when |
|---|---|---|---|
| Ask: pick a card | `ask.route` | Laya | the card fits the prompt in three languages; "not covered" for one that fits none |
| Ask: free answer | `ask.free` | Gemma | a grounded page answer; a general question labelled general |
| Briefing, reasoning | `encounter.briefing`, `encounter.reasoning` | Gemma | model source; reasoning cites its sources |
| Scribe | `voice.transcribe`, `note.draft` | ear, Gemma | four note sections from a recorded consultation |
| X-ray, findings | `xray.upload`, `xray.read`, `findings.detect` | MedGemma | a read of the uploaded image, marked unvalidated |
| Evidence | `evidence.stream` | Gemma, embeddings, reranker | cited claims for a question that is not the rehearsed one |
| Discharge leaflet | `discharge.draft` | Gemma | a Malay draft that keeps every medicine and dose |
| Claim codes, appeal | `claim.suggestCodes`, `claim.appealDraft` | Gemma | model source, codes that fit the visit |
| Ward huddle | `ward.huddle` | Gemma | three lines from the ward's own state |
| Check-in reply | `care.checkIns.reply` | Gemma | "worse" flagged, an urgent sign always urgent |
| Patient message triage, reply draft | `care.messages.send`, `messages.draft` | Gemma | urgent ranked first; a draft staff could send |
| Ask Sona Care | `care.ask` | Gemma | answers from the plan |
| Medicine photo, scan | `care.readMedicinePhoto`, `scan.read` | MedGemma, PII | a real photo read, not the stock "Cetirizine" |
| Live voice call | `SonaVoiceAgent` | ear, Gemma, VoxCPM2 | her voice within about 2 s; the care team told on a symptom |
| Training capture | on a consented reply | PII | names and numbers removed |

## Phase C: the demo flow across both apps (two simulators, agent-device)

1. Pro: open Amelia, ask for a briefing, a differential, an X-ray read, a prescription check.
2. Pro: record a consultation, draft and save the note.
3. Pro: approve the guarantee letter, fill the discharge card, open the Malay draft, approve the discharge.
4. Care: the plan, doses and schedule appear without a refresh.
5. Pro: jump the demo clock to day 1; Care: take a dose; Pro: adherence shows it.
6. Jump to day 2; Care: answer the check-in "worse" in Malay; Pro: My Day flags it.
7. Care: live call, report a symptom; Pro: a flag arrives. (A scripted caller stands in for a voice; a person is needed to judge the sound.)
8. Care: send a message with an urgent sign; Pro: inbox ranks it first, draft and send a reply; Care: "Seen", then the reply.
9. Pro: Book in on the flagged reply; Care: the visit is on the schedule.
10. Care: ask for a booking; Pro: decide; Care: the result.

## What the read already found

Likely broken:
1. An X-ray attached inside a visit is never uploaded; the visit card reads the last one uploaded on the X-ray screen, or fails.
2. A symptom typed to Ask Sona Care, or spoken in turn-by-turn voice, never reaches staff: only the live call or a message does.
3. Before discharge a symptom said in the live call tells no one; after it, each report uses up a scheduled check-in.
4. An urgent patient message gets no 999 reply from Sona (only check-in replies do).

Looks like AI, is not:
5. The rehearsed evidence question returns authored claims; others may come back empty.
6. Card layout, medication check, prescribing, follow-up, audit and handover use rules. Laya knows three medicines.
7. The check-in reply, the critical lab result and the insurer's denial are simulated from the staff app.
8. Library OCR and the sample scan are fixed samples; the patient list is sample data but for two patients.

Silent:
9. A cold box, a failed check or a Laya miss falls back to rules or keywords with nothing on screen.
10. Push does not reach a locked phone (no Apple push key); captions run ahead of the streamed voice.

## Needs a person

The sound of her voice on a phone, a real microphone and room, echo, captions against audio, and a hospital network.

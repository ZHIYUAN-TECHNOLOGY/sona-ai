# Verification evidence

The screenshots here come from Expo Go on an iPhone 17 Pro simulator running iOS 26.5. The blue floating gear is Expo Go's development menu.

Evidence captured before the final audit expansion is retained as historical development evidence, not proof that the latest implementation passed:

- `sona-home.png`: grey/blue canvas, native glass and entry controls.
- `sona-prescribing-blocked.png`, `sona-prescribing-created.png`: earlier nonclinical training-order version, now replaced by structured sourced synthetic regimen/checks.
- `sona-manglish.png`: bounded scripted dialogue playback.
- `sona-tasks.png`: initial task-form rendering.
- `runtime-error-before-cold-reload.png`: development error retained to document the issue; never a successful image-viewer check.

Current verification and device limitations are tracked in `../ui-implementation-progress.md`. New captures should use descriptive names and distinguish a rendered screen from an exercised interaction. Simulator checks do not establish physical-device responsiveness or clinical/model validity.

Current captures:

- `sona-xray-zoom-final.png`: saved original teaching radiograph opened and zoomed; reset also exercised.
- `sona-large-text-final.png`: text and controls reflow after a live accessibility text-size change. Original medium size restored afterward.
- `rx-automatic-receipt.png`: current structured synthetic prescribing receipt following 11/11 fixture prerequisites, with no approval gate.

- `transcript-keyboard-edit.png`: real keyboard editing of an original transcript segment; the Save action remained reachable by scrolling. Saving retained captured dialogue and flagged its English interpretation for review.

- `note-plan-save.png`: entered clinician plan and successful local draft-save receipt; confirms the tap applied despite the automation timeout.

- `followup-layout-before-fix.png` / `followup-layout-after-fix.png`: the stale animated response bounds and corrected native layout. Task navigation succeeded after the fix.
- `task-created.png`: explicit owner/date produced one local task; completion and reopening also exercised without duplication.
- `task-note-source.png`: task provenance opens the archived note containing its saved plan and corrected transcript.

- `patient-isolation-daniel.png`: second-patient context remains separate; reasoning and its source show Daniel’s incomplete intake rather than Amelia’s records.

Final audit limitations: Reduce Motion/Transparency exact iOS toggles, VoiceOver, physical iPhone and release performance were not manually verified. See the handoff verification boundary in `../ui-implementation-progress.md`.

OCR for scanned library PDFs (`ocr-flow/`, 29 Sep 2026, iPhone 18 Pro Max simulator, iOS 27.0, live backend on a local Worker against staging; captured with agent-device). The reading is the labelled synthetic sample (`apps/native/features/library/ocr-sample.ts`) because PaddleOCR-VL is not hosted yet, so these show the UI and interactions, not OCR accuracy:

- `ocr-flow-storyboard.png`: all seven steps on one sheet.
- `1-add-source.png` to `3-scan-found.png`: a real upload of a synthetic text-less PDF; the server refuses it as a scan and the sheet offers Read it with OCR (exercised).
- `4-reading.png`: pages being read and the step checklist mid-way.
- `5-review.png`: per-page clarity, the summary line and the flagged Amoxicillin 7 g dose.
- `6-correct-dose.png`, `7-checked.png`: the dose corrected to 1 g (exercised), page 4 left out as unclear, Add kept off until the model is hosted.

Camera scan of paper pages (`scan-flow/`, 29 Sep 2026, iPhone 18 Pro Max simulator, iOS 27.0; captured with agent-device, flash and lock frames from a screen recording). Superseded the same day: these show the first scanner design; pages are now photographed with Sona's one camera (Vision Camera), cropped and straightened by dragging the corners, then typed in "What did you scan?". Recapture before relying on them. The simulator has no camera, so a development-only synthetic page stands in under the frame; the OCR step is still the labelled sample:

- `scan-flow-storyboard.png`: all six steps on one sheet.
- `1-add-source.png`: the new Scan paper pages row.
- `2-viewfinder.png`: page frame with corner brackets, the rest dimmed.
- `3a-flash.png`, `3b-locked.png`: capture flash, green glowing frame and "Page 1 captured", page flying to the stack (exercised).
- `4-three-pages.png`: three captures, fanned stack with count badge, Read 3 enabled (exercised).
- `6-review.png`: Read 3 opens OCR review.

Golden path to the scanner (`scan-golden-path/`, 29 Sep 2026, iPhone 18 Pro Max simulator, captured with agent-device): Home, menu, Settings, sign in, Live backend on, Your sources, Add a source, first-run camera prompt, scan screen. `golden-path-to-scan.png` has all nine on one sheet. The Your sources card only appears in live mode with a signed-in clinician.

Evidence answer, OpenEvidence style (29 Sep 2026, iPhone 18 Pro Max simulator, iOS 27.0, Expo Go in production mode; live mode against the local Worker and real PubMed). In `evidence-answer/`, each an exercised interaction:

- `1-rehearsed-cited-answer.png`: the rehearsed steroid question: three claims ending in citation pills, "Rehearsed answer", the numbered source carousel.
- `2-pill-moves-carousel.png`: after tapping pill 3, the carousel is on source 3 (CAPE COD, 2023).
- `3-related-follow-ups.png`: Related: the three authored follow-up questions under CURB-65.
- `4-follow-up-answer.png`: "What harms should I watch for?" asked from Related: a new card with its authored cited claims and the neutral lead.
- `5-live-other-question-sample.png`: a new question (azithromycin): a real PubMed review as source 1 and the mock's cited claim, labelled as a sample.
- `6-not-enough-evidence.png`: a question with no PubMed or library sources: "Not enough evidence found…" with Related still offered.
- `7-offline-rehearsed.png`, `8-offline-other-question.png`: live mode off: the authored answer for the rehearsed question; any other question says live mode answers it. Live mode was switched back on afterwards.

Not yet reviewed by the owner on a physical iPhone. The authored sentences still need a clinician's check before a live demo.

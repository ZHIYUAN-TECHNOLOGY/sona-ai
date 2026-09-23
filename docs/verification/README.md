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

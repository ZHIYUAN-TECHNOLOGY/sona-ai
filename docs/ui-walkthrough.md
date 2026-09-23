# Sona iPhone UI walkthrough

UI-only milestone. English and Manglish dialogue, streaming, image responses, checks, prescription creation and save failures are labelled fixtures. No Baseten inference, audio capture, hospital persistence or pharmacy transmission is connected.

## Run

Check whether Sona's preview is already running before starting another server:

```sh
curl --max-time 5 -s http://127.0.0.1:8088/status
lsof -nP -iTCP:8088 -sTCP:LISTEN
```

For the reported PID, `lsof -a -p PID -d cwd -Fn` identifies its working directory. Reuse a healthy Sona server. If another project owns 8088, select a free port and substitute it in the launch command and Expo URL; leave the other server running.

From `apps/native`:

```sh
NODE_OPTIONS=--dns-result-order=ipv4first EXPO_NO_DOTENV=1 bunx expo start --go --localhost --port 8088
```

Open the project in Expo Go on the iPhone simulator at `exp://127.0.0.1:8088`. The localhost URL is for this Mac's simulator; a physical iPhone needs a reachable LAN development server. Expo Go's floating blue gear is a developer control, not part of Sona. Reloading clears this session's synthetic edits, notes and tasks.

To open the tested simulated app through agent-device:

```sh
agent-device open host.exp.Exponent --foreground --platform ios --udid A98E7DA8-36A6-4CEC-A05F-2BF1D6B18058
```

If Expo Go is on its home screen, open the project URL explicitly with `agent-device open "Expo Go" exp://127.0.0.1:8088 --platform ios --udid A98E7DA8-36A6-4CEC-A05F-2BF1D6B18058`.

On this Mac, the visible simulator window is provided by **Device Hub**. Opening the app through agent-device alone did not make its desktop window visible. Surface it with:

```sh
open /Applications/Xcode.app/Contents/Applications/DeviceHub.app
```

Select the window **iPhone 17 Pro – iOS 26.5**. This installation has no standalone `Simulator.app` at the older Xcode path. Preserve the other running simulator and verify the requested window is visible before reporting success.

## Main encounter

1. Choose **Amelia Tan · SYN-1042**. Patient details expand to show medical/family/social context, allergies, medicines and observations.
2. Request **Patient briefing**. A progress surface resolves into a JSON-composed response. Sections arrive progressively. Open a history source, then return.
3. Use **Add or correct history** in the latest result. Enter the category, fact, source and date. Save to produce a new revision and updated response. Earlier results retain their original patient/source snapshots.
4. **Start consultation**. Select English or the bounded Manglish sample, start, and allow the *simulated* permission flow. The 12-second script shows interim text followed by final segments. Pause/resume, minimize or stop. No microphone is active.
5. Correct an original segment or speaker. Switch to **English interpretation** to edit/confirm it separately. Original captured dialogue remains visible. Create the draft note.
6. Edit the four note sections. Assessment and plan are clinician-authored. Save, then mark reviewed. A fresh transcript suggestion appears separately and only replaces text after its explicit replacement action.
7. Ask for **clinical possibilities**. Expand evidence and information gaps; inspect the published references. These are authored, unranked examples, not a model diagnosis.
8. Open the **chest X-ray**. Inspect the original CC0 teaching radiograph using zoom/pan/reset. It is unrelated to Amelia. **Analyse X-ray · simulation** returns to the workspace with staged source-described findings and limitations. A local image receives no fabricated findings.
9. Request **medication review**. Confirm each reported ingredient and formulation in the reconciliation form. Every correction invalidates the earlier review. Uncovered combinations remain unavailable rather than safe.
10. Request **prescribing simulation**. It initially blocks missing prerequisites. Open eligibility inputs and load the explicitly synthetic 62 kg/negative-risk sample, or enter all inputs manually. Reconcile medicines and run the current medication review, then run prescribing. The supported fixture automatically creates a simulated receipt; no clinician approval gate is inserted.
11. Inspect the receipt's regimen, check outcomes, source version, inputs and audit. Amend with a reason to create a new revision and rerun checks; the prior receipt remains unchanged.
12. Record a plan in the note, then prepare **follow-up**. Review/edit the proposal, assign an owner and due date, and create the local task. Mark complete/reopen or edit. Repeated confirmation does not duplicate it.

For a short presentation, prepare the synthetic medication/eligibility inputs before rehearsal and show one blocked attempt followed by the complete supported flow. Keep the simulation labels visible.

## Recovery and accessibility rehearsal

- **History & settings → Interrupt response stream**: request a briefing, inspect partial content, turn the control off, retry. Cancellation keeps completed sections.
- **Unsupported response component**: exercises the visible fallback without executing arbitrary components/actions.
- **Daniel Rahman**: shows sparse history and an unknown tablet. Missing facts are explicit, and the bounded prescribing case remains blocked.
- Recorder sample controls: denied permission, interruption and capture failure. Finalized segments and corrections survive retries.
- Note controls: fail the next save; retry preserves the section draft.
- X-ray demo-response sheet: unsupported category or no finding result. Retry preserves the attachment. Previous image-response links open their saved original.
- Prescribing scenario controls: unknown coverage, unsupported regimen, failed prerequisite and failed creation. Restore the standard scenario and rerun current checks to recover. A failed creation never shows a created receipt.
- Task save failure uses the settings interruption control. Restore it before retry; the operation ID stays the same.
- Change patients while a sample is active: the stop-and-switch flow preserves the original transcript and keeps contexts separate.
- Enable **Collapse earlier responses** for a compact workspace. Text entry remains available when short voice-command input is disabled.
- Use iOS Larger Text, Reduce Motion and Reduce Transparency. Clinical text and actions should remain reachable; glass switches to an opaque surface and motion is suppressed.

## Architecture and boundaries

The app uses `@json-render/core` and `@json-render/react-native` 0.21.0 with an allowlisted native catalogue. JSON controls composition and source references, while patient snapshots, clinical records and action results remain app-owned. Each renderable snapshot is validated. A reference to another patient, unsupported component or unknown source is rejected. Fixture stages preserve stable element IDs. JEV is deferred: its documented composer is experimental and unreleased. See [presentation adapter](../apps/native/features/presentation/README.md) and [official JEV docs](https://json-render.dev/docs/jev).

The paracetamol example is a deliberately narrow, authored synthetic regimen within published adult dose limits; it is not a clinical recommendation for the fictional patient. The interaction coverage prerequisite is simulated, not a validated drug-database clearance. The evidence is [NHS paracetamol for adults](https://www.nhs.uk/medicines/paracetamol-for-adults/) and the linked DailyMed label for the bounded interaction example. No clinical validation, accuracy, measured time savings or frame-rate claim is made.

Physical iPhone/release-build verification and live inference evaluation remain separate from the simulator UI checks. User acceptance of the UI is required before beginning the agreed backend phase.

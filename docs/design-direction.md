# Design direction and planning context

Updated: 2026-09-22. Planning reference, not an implementation or clinical-validation claim.

## Accepted product constraints

- Solo, 18-day healthcare competition build; adequate inference/GPU budget.
- Clinician/hospital-facing mobile assistant for a hospital outpatient department.
- Primary demonstration device: **iPhone**. Exact model and iOS version are not yet specified.
- Review features and plan first, complete the UI next, then implement the backend. No application implementation has been authorized through this document.
- One clean conversational workspace with specialist capabilities and dynamic, interactive responses. Automatic routing is the accepted default; hybrid/manual specialist selection may be added later.
- Capabilities: patient briefing and timeline, ambient scribe, clinical reasoning with medical/family/social history, drug-interaction review, chest X-ray analysis, autonomous prescribing, and bounded follow-up coordination. Prescribing is scoped to simulated issuance for synthetic patients in the competition prototype, without mandatory clinician approval; see the PRD for evidence requirements and stop conditions.
- Inputs: preloaded synthetic patient records, document/image attachments, and live consultation recording.
- English baseline; demonstrate Malay-English-Mandarin code-switching input with English clinical output. Preserve an editable original transcript. Model performance on clinical code-switching is unverified.
- Baseten Cloud for the initial deployment; hybrid deployment is a future option. Cloud hosting is not a demonstrated local-inference capability.
- MedGemma is a core candidate for medical text/image tasks; Gemma 4 for tool calling and UI composition. Evaluate open-weight speech candidates before deciding on fine-tuning with Unsloth. Model choices and deployment support require verification.
- No clinical reviewer currently available. Present clinical outputs as unvalidated prototype results and evaluate source fidelity and extraction separately from clinical validity.
- Presentation budget: approximately 10–15 minutes, awaiting official confirmation.

## UX principles (standing rules for every screen)

Added 2026-09-27 at the user's request. These apply to Sona (clinicians, ward and hospital management) and Sona Care (patients), and to every future screen. Each screen exists to make hospital operations and care faster and safer, so it is judged on how quickly someone understands, acts and moves on.

1. **Insight first.** The first thing on a screen answers "where do I stand?" in one line: a count, a state or a change (e.g. "3 discharges blocked", "Day 2 at home · 1 thing needs you"). No one should have to read a list to find out whether anything is wrong.
2. **Action in place.** The most important thing that needs the person now sits in one feature card, and it can be done right there: approve, acknowledge, answer, send, track. Don't send people to another screen for the main action.
3. **Highlight what matters.** Colour carries meaning, never decoration: red for must-not-miss (critical results, allergies, worse after discharge), amber for soon or blocked, teal/green for done or safe, blue for the next step. Everything else stays neutral ink and grey.
4. **Review before deciding.** Consequential actions show what will happen and why (the evidence, the criteria met, what's still open) next to the button, and the result is confirmed afterwards (a receipt, a done line, who was told).
5. **Suggest the next step.** After an action or an answer, offer the likely next move (e.g. "Call back", "Book in", "Answer and send again", "Read and reply"), so the flow keeps going without hunting.
6. **Minimal by default.** One lead and at most one feature surface per screen; trimmed copy; detail on demand behind a tap; no duplicate actions; empty states that reassure ("nothing needs you today") rather than blank space.
7. **Built for operations.** Favour what saves time and prevents harm across the hospital: live state over stale snapshots (updates arrive without refresh), ranked work over flat lists, one tap to hand off or assign an owner, and numbers management can act on (beds freed, hours saved, money at risk).

**Checklist before any screen is called done:** Can someone tell in 3 seconds whether anything needs them? Is the main action on this screen, not one tap away? Is every colour meaningful? Is the next step suggested? Could anything be removed?

## Visual reference hierarchy

1. **Monogram is the primary interaction and motion reference:** calm conversational canvas, ambient pulse, floating voice/text dock, progressive response reveal, liquid-glass treatment on appropriate controls.
2. **The supplied Figma UI kit and user-provided Oria PNGs establish the visual direction, with pink replaced by blue.** Use the screenshots now for surface treatment, hierarchy, and overall atmosphere. Exact source tokens remain unverified; implementation tokens will be an intentional blue adaptation, not claimed Figma measurements.
3. **Arc Search provides selected secondary effects:** meaningful generation progress, source-to-summary continuity, and focused voice activation. It does not replace the Monogram direction.

Figma references:

- [UI kit overview, node 0:1](https://www.figma.com/design/pfJcGi7mW8WKJWjBxGMHdJ/AI-Assistant-UI-Kit?node-id=0-1)
- [Earlier reference, node 12:6246](https://www.figma.com/design/pfJcGi7mW8WKJWjBxGMHdJ/AI-Assistant-UI-Kit?node-id=12-6246)
- [Earlier reference, node 41:9952](https://www.figma.com/design/pfJcGi7mW8WKJWjBxGMHdJ/AI-Assistant-UI-Kit?node-id=41-9952)
- [Additional reference, node 90:1022](https://www.figma.com/design/pfJcGi7mW8WKJWjBxGMHdJ/AI-Assistant-UI-Kit?node-id=90-1022)

Inspection status: Figma is configured locally but unavailable in the active MCP session; a direct server check returned an unknown-server error. The overview URL was inaccessible through the web reader. The user subsequently supplied two PNGs, inspected visually, so the visual-direction dependency is resolved for planning. Exact Figma tokens remain uninspected.

## Supplied PNGs and blue adaptation

- [Selected assistant state](references/oria-selected-assistant-reference.png): a removable capability chip above the composer, generous open space, central glowing orb, dotted halo, translucent controls.
- [Assistant shortcuts state](references/oria-assistant-shortcuts-reference.png): the same shell with a two-column grid of large, lightly frosted shortcut cards above the composer.
- Both images show a pale grey canvas, dark charcoal text/icons, soft rounded surfaces with thin light borders, restrained shadows, a large central greeting, a pill-shaped text composer, and a separate dark circular voice button.
- User requirement: replace the pink orb and pink ambient background wash with blue. Proposed interpretation: pale ice-blue atmospheric light with a richer blue orb and restrained cyan highlights, maintaining the neutral grey canvas and charcoal typography. These are proposed colour relationships, not sampled hex values.
- Keep the dotted halo subtle and concentrated around the idle-state orb; reduce visual activity once clinical results occupy the workspace.
- Carry the frosted/liquid-glass treatment into the floating input dock, chips, and suitable controls. Use readable, sufficiently opaque surfaces for dense clinical results and editing.
- The shortcut and selected-chip screenshots remain layout references for a later hybrid mode. Automatic routing is the initial experience; the clinician need not select a specialist before entering a prompt.
- Use an original product identity and clinical copy. The reference's Oria logo, upgrade promotion, and generic image/programming shortcuts are not product requirements.
- Keep Monogram's motion as the primary reference and use Arc's selected transitions within this blue/grey visual system.

## UI review feedback: Monogram generative-UI direction (2026-09-23)

User review of the implemented home screen: **too crowded**. Redesign around Monogram's concept, tailored to a clinician healthcare assistant. Not yet implemented.

User's framing of Monogram: ask anything and it responds with a **visual, interactive interface instead of a wall of text**; the whole UI is generated on the fly in seconds with a consistent, crafted experience; built for everyday use. Sona applies the same idea to clinical/medical work.

Reference: [Monogram App Store screenshots](references/monogram-app-store-reference.png). Observed patterns:

- **Home:** personal greeting with one contextual line (e.g. next appointment) and one or two quick-action pills; a **Continue** row of recent-conversation cards; a **New ideas** row of suggestion cards; bottom dock with only `+`, a centred dark mic pill and a keyboard toggle. Lots of white space, no dense content on first view.
- **Response:** the user's prompt as a large quoted title, one short conversational line, then generated sections, each with a bold heading and one-line subtitle: horizontal image/icon tiles ("What you need"), numbered stepper with horizontally scrolling step cards, icon + title + caption lists ("Why this works"), image card carousel ("Little details that help").
- **Close:** a "What's next?" block of follow-up prompt cards with trailing arrows.
- **Chrome:** minimal header (back, menu, bookmark); white/very light grey surfaces with soft rounded cards; charcoal type; imagery carries the visual interest.

Healthcare translation (to confirm with the user before building): greeting with next patient/clinic context; Continue = recent encounters; New ideas = suggested clinical prompts; responses composed from the existing json-render catalogue as sectioned visual blocks (e.g. timeline, medication tiles, stepwise plan, evidence list, X-ray tile) ending in suggested follow-ups. Move dense detail (sources, limitations, receipts) behind taps rather than inline.

### First implementation pass (2026-09-23, awaiting review)

Studied with the 60fps MCP (details, motion breakdowns, SwiftUI code and frame-by-frame video): `monogram-tap-and-hold-mic-liquid-blur-pulse-interaction`, `monogram-pulse-calendar-connect-reveal-interaction`, `monogram-pulse-sweep-chat-response-reveal-interaction`, `monogram-rich-chat-response-card-swipe-interaction`, `monogram-keyboard-icon-morph-to-chat-input-interaction`. Translated to React Native with Reanimated CSS transitions/layout animations, Gesture Handler and Skia:

- **Home:** greeting, one context line with the patient and time, two pills, a three-row "You might want to ask" list; no patient shows today's visits. Floating menu and patient capsule replace the old header. `features/encounter/conversation.tsx`.
- **Canvas:** Skia light pools (ice blue, teal, periwinkle) drifting slowly; a pulse glow from the upper left while thinking. `components/sona/ambient.tsx`.
- **Dock:** `+`, dark mic capsule with white rim, keyboard. Tap shows "Hold while you speak"; hold blurs the canvas (static blur crossfaded), grows the mic and streams an authored transcript; release submits. The mic morphs into a "Thinking…" / capability status pill with a stop control. Keyboard morphs into a composer card with image, consultation, note and send actions. `features/encounter/voice-dock.tsx`.
- **Answers:** quiet prompt line, a large streamed lead sentence, then generated sections; a grey "You might want to ask" band of follow-ups. Each new answer scrolls to the top.
- **Briefing:** "At a glance" tiles, "How it unfolded" timeline carousel synced to a milestone track (`components/sona/timeline-carousel.tsx`), "History that matters" icon rows. `components/sona/sections.tsx` holds the reusable section parts.
- **Aurora core orb (mic button):** 64 pt Skia glass sphere (after the Wabi glass button shot) holding a small halftone aurora in Sona colours that curls slowly inside it; fixed highlight, crescent reflection, bright rim and faint cool iridescence. The mic glyph is dark ink on a soft white bloom for contrast. Holding scales it to 1.12, raises and brightens the aurora and adds a blue glow; thinking circles it at medium speed with a stop glyph and a status pill above. Speed eases over 0.6 s on the UI thread; still under Reduce Motion. `components/sona/glass-orb.tsx`.
- **Living orb glyphs:** after Wabi's animated glass icons, the orb's centre glyph morphs by state on a spring (0.45 s, damping 0.72; scale 0.55 → 1 with a slight turn): mic (idle), rising voice bars (listening), orbiting magnifier (searching), page with a scanning light (reading, briefing), turning sparkles (solving, reasoning), breathing lungs (X-ray), rocking capsule (checking, medication), tracing pen (composing, prescription and note), pulsing linked points (connecting, follow-up) and a ✓ for 1.4 s when an answer completes. The status pill above the orb carries a stop mark. Static under Reduce Motion. `components/sona/orb-glyph.tsx`.
- **Voice discoverability:** the orb accepts both gestures. A tap starts hands-free listening (✕ replaces `+` to cancel; the request sends after a 1.3 s pause or a second tap on the orb); a hold of 400 ms or more is push-to-talk (release to send). Until the first voice use, a "Tap or hold to talk" label sits above the orb, and the listening caption says how to send ("Pause or tap the orb to send" or "Release to send"). VoiceOver double-tap still sends the sample command directly.
- **Performance guards:** the ambient wash and orb loops pause while the workspace is covered or the app is backgrounded (`components/sona/use-visible.ts`) and respect Reduce Motion toggled live; the veil cancels its clocks when dismissed, disposes its captured images, captures on touch-down, and skips blur samples with zero weight; the orb shadow crossfades two pre-shadowed layers instead of animating `boxShadow`; dock gestures are memoized. Frame rate stays at the default 60 fps cap (no `CADisableMinimumFrameDurationOnPhone`).
- **Keyboard-to-composer morph:** after Monogram's keyboard icon morph, the dock is a row of glass buttons (`+`, orb, keyboard) and a single bottom-anchored surface fades in and resizes from that row (76 pt, radius 38) and the composer card (measured height, radius 26, 8 pt wider each side). `react-native-keyboard-controller` (`KeyboardProvider` at the root, `useKeyboardHandler`, bundled in Expo Go SDK 57) feeds the keyboard's own frame-by-frame progress into the morph, so the surface expands and lifts in step with the system keyboard and folds back as it slides away; a 260 ms fallback (starting 140 ms late) covers a hardware keyboard. Bar contents fade and sink over the first 40 %, composer contents fade in over the last 55 %, and an aurora halftone band sweeps across the surface mid-morph (sin π·p). Transform/opacity plus width/height on a childless absolute shell; instant under Reduce Motion.
- **Control icons:** dock and composer use Solar "line duotone" (Iconify, CC BY 4.0) through `components/sona/brand-icon.tsx` and `react-native-svg`: keyboard, add, close, mic (orb idle), image, soundwave, note and send. The dock has no bar background at rest; `+` and the keyboard are frosted glass circles, and the surface only appears as it morphs into the composer.
- **Attachments menu:** the dock's `+` morphs into a floating menu (Photos, Camera, Files), which extends near full-screen into a recycled photo grid (`@legendapp/list`, teaching radiograph first, then the photo library via `expo-media-library/legacy`) or a live camera (`expo-camera`) with a shutter. Geometry blends closed → open → extended continuously from two springs (450 ms, damping 0.86), so tapping outside collapses from any depth straight back into the `+` (380 ms timing on the iOS sheet curve `cubic-bezier(0.32, 0.72, 0, 1)`, no overshoot; menu items and the grid clear in the first ~40 % and the glass blends into the button's own fill and rim as it lands); an aurora halftone sweep rides the morph. Picking an image attaches it and starts the X-ray review; Files uses `expo-document-picker` (PDFs are noted for the backend). `components/sona/attachments-menu.tsx`. The top-left menu icon is a left-aligned three-line glyph at Solar's 1.5 stroke.
- **Sidebar:** the menu button slides the whole page right (translateX 300 pt, scale 0.96, 44 pt corners, soft shadow, faded surface) to reveal a sidebar underneath: clinician + settings, Home, Patients, Consultation, Notes, Follow-up tasks, Share feedback, and History (encounters with requests; tapping one resumes it), with a "New visit" pill. Springs (420 ms, damping 0.9) because a finger can drag it closed from the page with velocity handoff; tap the page to close. `features/encounter/sidebar.tsx`.
- **Top bar:** menu on the left; on the right a follow-up tasks button (checklist, blue count badge for open tasks: the visit's own inside a visit, all visits' on home). It always opens Follow-up tasks: with no visit selected that screen lists follow-ups across today's visits and offers "Add a follow-up for" each patient in place; inside a visit, other visits' open follow-ups sit under "Other visits" and switch to that visit on tap. The patient chip (initials + first name) appears beside it only inside an encounter, so the subject of every answer stays visible; on the home screen patients are chosen from today's visits instead.
- **Chatbox glass:** the composer card is liquid glass (native `GlassView` on iOS 26+ over a thin-material blur so typed text stays legible above busy answers; blur alone before iOS 26; solid white with Reduce Transparency), with a bright 1 pt rim and inner top highlight. Dithering is limited to small accents: a still halftone glint on the top-left rim, the existing halftone shimmer while the bar morphs, and a dotted glint on the send button once there is text (empty state is a glass bubble). Tools gain a small glass press bubble.
- **Follow-up tasks:** a minimal feature card: one editable sentence, two quiet tokens (owner, due) and a round add button that stays a faint glass bubble until the task is complete, then turns ink with a dotted glint (the same control as the chatbox send). Typing does the same inline (after Superlist's create-task animation): `@nur` tints blue and pops an ink suggestion popover (spring 350 ms, damping 0.72, rows staggered 40 ms) offering matching roles, or "Assign <name>" when none match; a trailing date phrase ("tomorrow", "in 2 weeks", "10d", "mon", "next thursday") tints blue and offers "Due Thu 8 Oct". Nothing applies until tapped; taking one removes the phrase from the sentence and the filled token pops in from 0.6 (spring 380 ms, damping 0.7) while its neighbour glides aside. Owner opens role choices or a free-text name; Due opens a day ruler (after Habitastic's timeline scroll): one tick per day, with no end (another year of days loads before you reach the last), slides under a fixed ink marker with a small halftone glow; month and year labels ride above the ticks, review intervals below (Today, 1, 2, 4, 6, 8, 12 weeks, 6 months, then every yearly anniversary; tap to jump). It scrolls with momentum (fast deceleration), snaps to a day, ticks a selection haptic per day passed (the day index crosses to React only on change, via `useAnimatedReaction`), shows the date and a relative hint above, and commits when it settles. Ticks are virtualised (`Animated.FlatList`). For far dates, the native compact date pill beside the readout opens the system calendar popover, whose month/year wheel reaches any date in a couple of taps; the ruler follows. Dates outside this year show the year ("Fri 13 Oct 2028"). Nothing is chosen until the ruler moves; VoiceOver adjusts it one day per swipe. Tapping the chosen owner again clears it. Tapping anywhere on a task row completes or reopens it (the Source link keeps its own tap). Choices open in place with `Expand`. Rows are one title line and one meta line (owner · due · Source); completing fills the circle, strikes the title and glides the row into Completed; swipe right does the same or reopens. Tapping a row no longer opens an editor. Save/retry, provenance, source links and duplicate protection are unchanged (`features/tasks/state.ts`).
- **Attachments menu:** the plus grows into the same glass as the composer (native glass over thin-material frost), bare line icons without tinted circles, and a dotted glint on its top rim. Motion after Whistle's plus menu: the screen behind frosts over (static blur crossfaded by opacity), the plus spins 135° toward a close mark as the glass grows over it (spring 420 ms, damping 0.8; Whistle uses 0.42 s / 0.76), and Photos, Camera, Files rise from the bottom edge top-first (translate 12 pt, scale 0.9, staggered along the open progress) and leave in reverse. Whistle also sharpens each item out of a blur; iOS views cannot be blurred cheaply, so the rise and fade carry it instead.
- Canvas lightened to `#F5F6F8`; cards are white with soft shadows. `expo-haptics` added for hold and carousel ticks.

- **Aurora glass (hold-to-talk):** on hold, the screen is captured once (`makeImageFromView`) and pre-blurred at two strengths; a Skia runtime shader draws frosted liquid glass that widens out of the mic with rounded corners (460 ms ease-out) while lifting (spring 560 ms, no bounce). Its top is a soft organic sine wave (one broad travelling sine, ~1.2 wavelengths across, with a gentle harmonic over a low arch) drawn only by refraction, faint dispersion, a travelling sheen and a contact shadow. Roughly 80% of the effect is glass; the rest is dithering: halftone aurora curtains (teal to periwinkle, violet with height) rise 40–100 pt above the wave and sway slowly, plus a faint halftone band inside the edge. It breathes on a 4 s in / 6 s out cycle; each heard word is a gust: the whole wave swells in amplitude (~40%) and glides a little further, then eases back (~1 s), while a band of light climbs the curtains and fades near their tips (gusts at most every 450 ms). Release without speech sinks it back into the mic; release with speech floods upward (420 ms). On the way back into the mic, an exit value (300 ms ease-out) widens the corners and flattens the walls into a soft bell, feathers the edge and fades the glass and its dots to transparent, so it ends as a haze rather than a cone. With no patient selected, a voice command opens the patient picker. Reduce Transparency or a failed capture falls back to the plain blur; Reduce Motion keeps it static. `components/sona/liquid-veil.tsx`.

Not yet done: the other six capabilities as generated sections, and on-device feel checks (release build, physical iPhone).

## Design system: glass first, dithering as accent (2026-09-24)

**Minimalist first.** Every screen says one thing: a lead sentence and at most one feature surface. Copy is trimmed to what a clinician needs; safety and provenance notes stay but as one quiet line each. Detail is on demand (opens in place with `Expand`), never all shown at once. No duplicate labels, hints or actions that do the same thing; no decoration without a job. When in doubt, remove.

Roughly 90% of what a clinician sees is liquid glass and quiet material; about 10% is halftone dithering, and it is only ever an accent that marks where to act or where Sona is working. Primitives live in `components/sona/ui.tsx` and `components/sona/motion.ts`; screens compose them rather than styling their own cards.

| Layer | Use | Material | Dithering |
| --- | --- | --- | --- |
| Canvas | Every screen | Pale grey with soft aurora colour fields (blue, lilac, teal) so glass has something to show; the ambient Skia wash on home and in sessions (80% while answers are shown) | None |
| Content surface (`Surface`, `Card`, `surfaceStyle`) | Answers, lists, tiles, visits | Translucent glass: a white gradient (66% at the top edge to about 30% lower down) so the aurora canvas tints through, a bright rim with a sheen along the top, a faint blue catch along the bottom, a hairline outline and a soft blue lift. No live blur, so long lists stay cheap | None |
| Feature surface (`Card feature`, `Surface feature`) | The one card per screen that asks for action or carries Sona's proposal (task composer, proposed follow-up, next-step card) | Content surface, a touch brighter, blue-tinted lift | Halftone glint in the top-right corner |
| Floating chrome (`GlassView`) | Top bar, dock, composer, sheets over content | Native liquid glass on iOS 26+, blur before, solid with Reduce Transparency | Composer rim glint; morph shimmer |
| Pills and round buttons (`Chip`, `pillStyle`) | Filters, quick choices, top bar | Glass pill with rim; chosen value = blue wash; picked option = ink | None |
| Primary action (`Action`) | One per card | Ink capsule | Dotted glint, top-left |
| Secondary action (`Action secondary`) | Everything else | Quiet glass capsule | None |
| Live states | Orb, hold-to-talk veil, thinking | Aurora glass | Halftone curtains and bands |

Rules: never put dithering on body content, list rows, secondary controls or more than one surface per screen. Every pressable scales to 0.96 on press (120 ms). Motion uses `EASE_OUT` for entrances and exits, and one no-bounce layout spring (`LAYOUT`, 380 ms) for anything that resizes or reflows. In-place disclosure uses `Expand`: its clip grows on that same spring while siblings carry `layout={LAYOUT}`, so a card and everything below it move as one piece.

## Answer structure: digest, sections, tabs (2026-09-24)

Generated answers no longer read as one long scroll (`components/sona/answer-kit.tsx`):
- **Takeaways first:** every answer opens with at most three toned lines (caution, good, info) with key terms tinted, on the one feature surface.
- **Sections:** detail below is grouped into named sections (`Anchor`, or `Fold` for a section collapsed to a one-line preview that opens in place).
- **Pinned tabs:** when the latest answer has two or more sections, a frosted tab bar pins under the top bar; tapping glides to the section (and opens a fold), and the ink thumb follows scrolling (spring 380 ms, no bounce).
- **Briefing as pages:** the pre-visit briefing shows its detail as swipeable pages (Vitals, Timeline, History, Next) with segmented progress; side pages sit back at 0.96 and dim.
Takeaway text is authored for the fixtures; generated responses should emit takeaways and sections in the json-render spec.

## Section headers and grouped sources (2026-09-24)

- Each generated section opens with a landmark header: a 30 pt tinted icon tile (blue, teal, amber or violet by meaning), the title in the heading style, and an optional one-line subtitle. `Anchor` sections draw the same header when given an icon.
- Sources no longer sit inline. Every `SourceLink` or `IconRow` source inside a section registers with the section, which shows one quiet pill on the right of its header (up to three stacked badges plus "N sources", after Slack's summarize pill). Ten or twenty sources still cost one pill.
- Tapping the pill opens a native sheet listing the sources, with a filter once there are more than six. Picking a row closes the sheet and opens the source detail.
- Briefing deck pages show the pill at the bottom right of each page.
- Each source has a stable id (falling back to its label), so different sources that share a label stay separate and two links citing one source count once. Same-label rows carry a one-line detail in the sheet (for history: "Revision 3 · Social history · 22 Sep · Patient"). `SourceRef` (`components/sona/sources.tsx`) registers a source with an id, detail and kind, and draws a plain link outside a scope.
- The sheet groups rows by kind under small overlines, "From the record", "Published references", "Demo notes", only once more than one kind is present. The filter also searches detail lines. Rows are at least 52 pt and rise in on a 30 ms stagger capped at eight rows (after the Emphasis focus-areas list: fixed header, rows slide up and fade on a subtle ease-out stagger), so twenty sources settle as quickly as five.
- The pill's count rolls through a clipped slot, up when sources are added and down when removed, on a subtle spring (after GO Club's step-count ticker: only the digit moves through a vertical mask). Reduce Motion swaps it in place.
- History now has its own landmark (person-and-record icon, teal): the last update and every version collect into its pill even while the editor is collapsed. The medication "See an example" alert gathers its DailyMed citation into its own pill above the alert's top right.
- Consecutive answer landmarks (`Anchor`) are parted by a hairline and 20 pt of extra air, so each section starts a new band. "No consultation sample" on the recording page now has its icon (amber, waveform slashed); the X-ray empty-state section still lacks one.

## Medicine thumbnails (2026-09-24)

- Each medicine row shows an illustrative dosage-form thumbnail (inhaler, tablet, caplet, capsule, liquid) drawn in-app from a trusted catalogue (`features/clinical/medicine-catalog.ts`). The model only names a catalogue medicine (`MedicineThumb` in the json-render catalogue accepts catalogue IDs only); it never supplies or chooses an image. Unknown products fall back to the reported form, never to another medicine.
- Unconfirmed medicines show a dashed outline of the reported form. Confirming morphs it into the drawn medicine with a check badge (after Fold's placeholder-to-logo morph: outline rotates and fades, drawing springs in at 380 ms, damping 0.72). Reduce Motion crossfades only.
- Thumbnails show the dosage form, not a brand's pack or imprint, and the medication footnote says so.

## Next-step decision bar (2026-09-24)

- Medication and prescribing answers show a floating glass bar above the dock: a progress ring, the one step blocking progress, and its action (Confirm, Run, Record, View). Steps come from the same checks the prescribing panel runs (`features/encounter/next-steps.ts`), so the bar never disagrees with them.
- Tapping or swiping the bar up sinks it away as a sheet of every step rises (spring 0.45 s, damping 0.82), each with its own action; dismissing springs the bar back with a slight overshoot (0.5 s, damping 0.72). This follows Moonlitt's floating bottom bar. When a step completes, its label slides out left and the next slides in.
- Actions jump to the relevant section and open it (a medicine's confirm form, the eligibility inputs) instead of acting silently. Reduce Motion replaces movement with fades.

## Camera capture scan (2026-09-25)

- Camera stays on `expo-camera`; the effect is a Skia overlay, so no new dependency. VisionCamera is only worth adding for live frame analysis.
- On shutter the photo freezes, a blue halftone band sweeps bottom to top (1.1 s, ease-in-out), the surround dims to a cornered focus frame, and a glass sheet springs up (0.45 s, damping 0.72) asking what the image is (Chest X-ray, Skin, Wound, Document, Other) with Retake and "Attach as …". This follows CapWords' snap-and-mask shot.
- The sweep is an overlay that fades out; the photo's pixels are never tinted. Nothing is read from the image at this step: the type is the clinician's choice and is stored on the attachment for the analysis backend. Reduce Motion skips the sweep and fades the sheet in.

## My day, ranked (2026-09-25)

- Update (25 Sep, later): the greeting and the ranked day are one section. The header reads the greeting, a tappable date line ("Today, Fri 25 Sep ▾" with "N need you · N visits"), the blue **Re-rank** (spinning sparkle while sorting), then All patients / Hand over shift. There is no week strip: tapping the date line springs a month card down from it (after Days' calendar top modal: scales up from its top-left anchor, spring 0.45 s, damping 0.72, weeks rise 40 ms apart) with visit dots and a Today ring; picking a day folds it back. The 24-hour ruler opens on now for today and on the first visit for other days; the list slides in for the chosen day ("Looking back" / "Coming up"), and a **Today** button returns. Other days are an authored synthetic, read-only schedule.

- Home without a selected visit shows one list ordered by urgency: a synthetic unactioned lab result, blockers found in visits (unconfirmed medicines blocking prescribing), today's visits and open follow-up tasks. The top item is the one feature card; every row carries its reason ("Low result · 2 h · no action yet", "Running 1 h late"). A time ruler (after Habitastic’s check-in timeline) shows 5-minute ticks with hour labels, a red "Now" bubble, and each visit as a round avatar pin with first name and time ("Amelia · 14:00"; blue complete record, amber history to complete). Drag it with momentum; it settles on the nearest visit or back on now (spring 0.6 s, damping 0.85) with one haptic; tap a pin to open the visit.
- Ranking is a transparent rule score over fixtures (`features/day/model.ts`); a model ranking replaces the score later, and the reason stays mandatory. The footer says the ranking is demo rules.
- Motion follows Superlist's AI list making: a "Sorting your day…" pill pulses, then items drop in by rank (spring 0.45 s, damping 0.72, 90 ms apart). It plays on first open and on "Re-rank", not on every return home. Rows can be pinned or snoozed for an hour; re-ranking glides them to their new place. Tapping an item opens that visit, asking the matching question (a medication blocker opens the medication answer and its Next-step bar).

## Shift handover (2026-09-25)

- A handover screen (sidebar "Shift handover", home "Hand over shift") stacks one SBAR card per patient: situation, background, assessment, and recommendations derived from state (pending result, unconfirmed medicines, missing history, open tasks, unsigned note) with the card's sources. Patients to watch come first. Today's two visits are real encounters; three ward patients are labelled synthetic examples.
- Motion follows Slack's swipe-to-triage cards: drag right to hand over, left to flag for verbal discussion; the card tilts (x / 16 degrees) and tints teal or amber, flies off past 110 pt or a quick flick (spring 0.38 s, damping 0.72) while the next card scales up from 0.95. Buttons do the same; Undo restores the last card. The counter reads "N of 5 left".
- The receiving clinician then holds "Accept handover" (1.5 s linear fill; releasing early springs back in 0.2 s) and an acknowledged receipt names who accepted how many patients and when. VoiceOver gets an activate action instead of the hold; Reduce Motion skips the fly-off and tilt.

## Patient picker and patient sheet (2026-09-25)

- The patient picker lists one compact row per patient (avatar, name, status dot and reason, time). Tapping a row slides up a patient sheet over the dimmed list (after Must's leaderboard profile sheet: spring 0.42 s, damping 0.82; sections rise in 60 ms apart; drag past 120 pt or flick to dismiss).
- The sheet is built for a decision in one glance: who and when ("Starts in 44 min"), **Needs attention** chips derived from state (pending result, allergy to confirm, unconfirmed medicines, missing history), each opening the visit on the answer that resolves it, the reason for the visit with observations, and actions: Open visit, Brief me, Consultation, Medicines, Hand over. The previous "Patient details" / "Open encounter" buttons are gone.

## Quick actions (2026-09-25)

- One shared component (`components/sona/quick-actions.tsx`): four raised liquid-glass **keys** (2×2) that read as pressable before they are touched: a lit top edge and a 2 pt shadow ledge, the glyph in a filled blue circle (red when urgent), a small ↗ circle in the corner, a label and a one-line live status. Pressing sinks the key 2 pt and flattens the ledge (after Duolingo's tactile button; spring back 0.26 s, damping 0.6) while the glyph pulses like a droplet, with a haptic. Home, the patient sheet and a visit start use the same keys. The first time a shelf appears in a session, a halftone shimmer sweeps across the keys once, 120 ms apart (after Queue's update-button shimmer: 1.1 s ease-in-out). Urgent keys keep a warm dot glint. On home the keys sit below the 24-hour timeline.
- Home: Patients (next visit), Results (new, red when urgent), Hand over (patients to hand over), Tasks (open count), under the date line. After District's category grid that morphs into tabs, the shelf flattens into a slim frosted glass capsule of glyphs and counts under the top bar once it scrolls away (fades and settles in over 40 pt of scroll, driven on the UI thread).
- Inside a visit and in the patient sheet: Brief me (new result to review / history incomplete), Consultation (recording now / lines captured), Medicines (N unconfirmed), X-ray (image attached / film on file); the duplicate "You might want to ask" suggestions on the visit start are gone.

## One-card prescribing (2026-09-26)

- Prescribing is one card on the latest medication or prescribing answer; nothing navigates and no new answers stream in during the flow. A progress ring and the regimen sit at the top; below it only the checks that still block, each fixable where it sits: weight as a number field, paracetamol allergy, liver, kidney and alcohol as No/Yes pills, and the medication review as an inline Run (it goes last, so it runs once after the other answers). Passed checks fold into "N checks passed ›".
- A resolved blocker follows Particle News' step check: its number badge crossfades into a teal check with a small spring (0.36 s, damping 0.6), a line draws through the label (0.26 s) and the text greys, then the row folds away. The ring fills and "N left" counts down. The button morphs from a disabled "Resolve N to prescribe" to "Prescribe paracetamol", shows "Checking all 11…", and the receipt stamps in the same card.
- If an edit invalidates an earlier review, the row says "Needs rerun · eligibility or medicines changed since the last review" and its chip reads "Rerun review". The Next-step bar runs the review and the simulation in place too. Earlier answers keep a one-line summary.

## Small workflow touches (2026-09-26)

- (26 Sep) The capture sheet preselects the image type from what the clinician typed (rash → Skin, wound → Wound, letter/lab → Document, otherwise Chest X-ray); the clinician still confirms. Demo visit times re-time themselves when the first unstarted visit falls 10 minutes behind. Note, follow-up and prescribing answers end with a "Done with <patient>? Hand over shift" row.

## Typography and AI text (2026-09-24)

- **Type scale** (`type` in `components/sona/theme.ts`, iOS-sized, named by use): display 27/35, title 22/31, heading 19/25, headline 17/23, body 16/24, callout 15/21, subhead 14/20, footnote 13/18, caption 12/16, overline 11/14 uppercase +0.8 tracking. Headings track slightly negative; body text sits near 1.5; nothing thinner than 400 below 18 pt except display numerals (timers, clocks). One-off sizes were folded onto the scale. The shared `Text` uses iOS "push-out" line breaking so a lone word doesn't strand on the last line.
- **Key terms in AI text are colour-coded** (`MarkedText`, `components/sona/marked-text.tsx`): a quiet tint behind symptoms (blue), medicines (violet), cautions (amber) and findings (teal), in answer leads and evidence rows. Terms come from explicit `[[text|kind]]` markup (what a generated response should emit) or a small clinical dictionary for the fixtures. Streaming reveals words in place without reflow.
- **Markdown rendering for generated responses:** plan to adopt `react-native-enriched-markdown` (Software Mansion; native Fabric, GFM, streaming, native selection, VoiceOver) as a json-render `Markdown` component when the backend streams responses. It needs a dev/Release build (not Expo Go), so it is deferred during UI review. Its `linkVariants` can carry typed entity tints; rounded chips stay in `MarkedText`.

## Navigation model: home, visit sessions and tool pages (2026-09-24)

- **Home** (`app/index.tsx`) is the launchpad: greeting, today's visits and "All patients". It never shows answers and has no visit open (entering it calls `leaveVisit`, which also stops an answer still arriving). A visit with a conversation shows "Continue · N answers" on its card.
- **Session** (`app/session/[patientId].tsx`) is one patient visit's conversation, pushed over home with the native stack (slide in; edge swipe or the back button returns home). Empty, it shows the visit greeting and suggestions; otherwise the thread, opening at the latest answer while earlier answers of the same visit stay reachable above. New answers still land at the top like a fresh page. Everything asked about that visit (briefing, reasoning, medicines, X-ray, follow-up) stays in its session so context carries through the visit.
- **Tool pages** (recording, note, X-ray viewer, tasks, source) keep a preset layout with generated content and open from a session. Opening one without a visit goes through the patient picker, which opens the session and then the page.
- Entry points: a visit card, the sidebar's History and the settings "Resume" open a session; asking without a visit opens the patient picker, which opens the session and runs the question there; the patient chip in a session switches visits by replacing the session.

## Motion reference study

The Arc entries below were retrieved using both `60fps_get_shot` and `60fps_get_motion_breakdown`. Descriptions are from 60fps; timing/easing categories are estimates, not measurements of original source code. Prior Monogram research included search, related shots, details, breakdowns, and generated SwiftUI reference code. Generated reference code is not Monogram's implementation and does not establish real model streaming.

| Reference | Observed pattern described by 60fps | Proposed application |
| --- | --- | --- |
| [Monogram response reveal](https://60fps.design/shots/monogram-pulse-sweep-chat-response-reveal-interaction) | Ambient pulse, upward fade/reveal, compact microphone pill expanding into input controls | Primary prompt-to-response transition; clinical cards appear progressively |
| [Monogram action-card reveal](https://60fps.design/shots/monogram-pulse-calendar-connect-reveal-interaction) | Processing pill changes into voice controls as an actionable card appears | Transition from tool execution to information request or task proposal |
| [Monogram keyboard morph](https://60fps.design/shots/monogram-keyboard-icon-morph-to-chat-input-interaction) | Expanded text input collapses into a floating voice dock | Continuity between text and voice entry; match keyboard movement |
| [Arc AI generation loader](https://60fps.design/shots/arc-search-ai-generation-loader) | Fluid full-screen gradient, fading progress/source text, loader fading as results slide upward; ease-out, subtle stagger | Use a restrained ambient field with actual tool progress, e.g. retrieving history; reveal available results promptly |
| [Arc summarize](https://60fps.design/shots/arc-search-summarize-interaction) | Source page shrinks to a card, briefly wiggles, moves upward; summary enters below and source preview remains visible | Condense an attached document or X-ray into a stable preview above its summary/findings; keep access to the original |
| [Arc long-press assistant](https://60fps.design/shots/arc-search-long-press-assistant) | Background dims/blurs, gradient voice overlay expands upward, waveform appears | Optional focused voice-entry state with a visible microphone alternative and explicit stop/cancel controls |

Arc's magenta/purple palette and playful mascot are reference details, not adopted brand elements. Prefer a calm settle over the source-card wiggle for frequently viewed clinical information. Keep X-ray pixels unfiltered and clinical text on legible surfaces; glass belongs primarily on surrounding controls.

## Streaming and interaction contract

- Drive UI state from actual events: request accepted, tool started, partial result, result complete, cancellation, or failure.
- Show activity immediately, but never invent source counts, percent completion, or completed tool work.
- Do not delay usable content to finish a decorative loading sequence.
- Compose from a validated catalogue of clinical components and allowed actions. Bind patient facts to retrieved records and validated results.
- Animate newly available sections, not every token. Retain stable component identity and preserve edits.
- Keep patient context visible. Preserve the reader's position if they scroll away from the latest result.
- Treat completion, validity, and clinician review as separate states. An incomplete result must not enable a consequential action.
- Document no-data, uncertain output, interruption, retry, and cancellation alongside the successful flow.
- A long press is an optional shortcut, never the only route to a required task. Do not require holding the screen throughout a consultation recording.
- Reduced motion, text scaling, screen-reader support, and opaque/high-contrast surface fallbacks are part of the initial UI specification.

## Implementation direction when UI work begins

- React Native / Expo, prioritizing the iPhone demonstration.
- Reanimated for response entrances, input transitions, and interruptible gesture-driven motion.
- Skia for the ambient field, pulse, and custom effects where a canvas is appropriate. Keep clinical text and controls accessible in native views.
- Use native navigation and platform behaviour where appropriate; preserve Monogram-inspired continuity within the conversational workspace.
- Use the named skills: `emil-design-eng`, `animate-expo`, `global-dev-toolkit:animations`, `global-dev-toolkit:expo-native-ui`, and `global-dev-toolkit:react-native-best-practices`. Check actual project versions and current official APIs before applying snippets.
- Adapt the motion intent of SwiftUI examples rather than translating API calls or spring constants literally.
- Verify motion on a physical iPhone in a release build under streaming load. No frame-rate or performance claims until measured.

## Inspiration and implementation workflow

When additional interaction inspiration is needed, use the **60fpsdesign MCP**. Reuse already studied references where they answer the design question; do not fetch more shots merely to fill a research checklist.

| Tool | Purpose in this project |
| --- | --- |
| `search_shots` | Describe the desired interaction and find the closest examples, prioritising Monogram |
| `list_filters` | Discover available filters when a search needs narrowing |
| `get_shot` | Inspect shot details, keyframes, filters and mood |
| `get_motion_breakdown` | Understand the trigger, starting state, movement, settling and purpose |
| `get_related_shots` | Explore useful variations before choosing an interaction |
| `get_motion_code` | Obtain the generated SwiftUI motion reference for the selected interaction |

Use the callable MCP equivalents of these tool names. Treat generated SwiftUI as a behavioural reference, not the original application's source or a React Native implementation. Even when the service reports SwiftUI compilation checks, the converted React Native code requires its own verification.

Convert selected interactions to React Native by mapping their states, gestures, layout changes, timing and interruption behaviour. Use **Reanimated** for view motion and gesture-linked transitions, **Skia** for justified custom ambient graphics, and Expo's native glass facilities for liquid-glass materials with an accessible fallback. Do not translate SwiftUI spring parameters mechanically or embed the generated SwiftUI wholesale as the animation implementation.

Apply `emil-design-eng`, `animate-expo` and `global-dev-toolkit:animations` to motion craft; apply `global-dev-toolkit:expo-native-ui` and `global-dev-toolkit:react-native-best-practices` to UI implementation. The supplied native-UI skill directs checking `expo-ui` before selecting controls, and `expo-router` for navigation. Load the relevant specialist references when that implementation decision arises. Native Expo controls may internally use SwiftUI; the app's adapted interaction code remains React Native.

Preserve the accepted Monogram-first liquid glass, pale grey and subtle blue direction throughout reference adaptation. Validate the resulting interaction on iPhone with actual streaming behaviour and accessibility settings; reference code does not establish streaming correctness or device performance.

This update records the workflow and clarifies scope. It does not start UI implementation.

## Next planning deliverables

1. [Compact PRD](prd.md) — drafted for review, with bounded feature definitions, acceptance criteria, evidence/data dependencies, and explicit unresolved assumptions.
2. [Patient-encounter storyboard](demo-storyboard.md) — drafted for review, linking briefing, consultation capture, contextual reasoning, X-ray review, medication review, and follow-up.
3. [Screen-by-screen UI specification](ui-specification.md) — defines the workspace, focused views, component/event contracts, motion, failure states and UI implementation order. Refine exact tokens from Figma if it becomes accessible.
4. [Eighteen-day UI-first delivery plan](delivery-plan.md) — proposed allocation with integration, evaluation, and rehearsal allowances; rebase against the actual remaining time.

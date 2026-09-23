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
- **Top bar:** menu on the left; on the right a follow-up tasks button (checklist, blue count badge for open tasks, opens the tasks screen). The patient chip (initials + first name) appears beside it only inside an encounter, so the subject of every answer stays visible; on the home screen patients are chosen from today's visits instead.
- **Chatbox glass:** the composer card is liquid glass (native `GlassView` on iOS 26+ over a thin-material blur so typed text stays legible above busy answers; blur alone before iOS 26; solid white with Reduce Transparency), with a bright 1 pt rim and inner top highlight. Dithering is limited to small accents: a still halftone glint on the top-left rim, the existing halftone shimmer while the bar morphs, and a dotted glint on the send button once there is text (empty state is a glass bubble). Tools gain a small glass press bubble.
- **Follow-up tasks:** one sentence composer with owner and due-date chips (after Superlist); each chip opens quick choices in place (owner roles, or someone else; Today, Tomorrow, In 3 days, In 1 week, In 2 weeks, or pick a date, after Canopi). Completing fills the circle into a check and draws a strike across the title (after Particle), then the row glides into Completed and the section count updates; swiping a row right does the same, or reopens a completed one (after Twodos). Creating hands back a blank composer. Save/retry, provenance, source links and edit rules are unchanged (`features/tasks/state.ts`).
- Canvas lightened to `#F5F6F8`; cards are white with soft shadows. `expo-haptics` added for hold and carousel ticks.

- **Aurora glass (hold-to-talk):** on hold, the screen is captured once (`makeImageFromView`) and pre-blurred at two strengths; a Skia runtime shader draws frosted liquid glass that widens out of the mic with rounded corners (460 ms ease-out) while lifting (spring 560 ms, no bounce). Its top is a soft organic sine wave (one broad travelling sine, ~1.2 wavelengths across, with a gentle harmonic over a low arch) drawn only by refraction, faint dispersion, a travelling sheen and a contact shadow. Roughly 80% of the effect is glass; the rest is dithering: halftone aurora curtains (teal to periwinkle, violet with height) rise 40–100 pt above the wave and sway slowly, plus a faint halftone band inside the edge. It breathes on a 4 s in / 6 s out cycle; each heard word is a gust: the whole wave swells in amplitude (~40%) and glides a little further, then eases back (~1 s), while a band of light climbs the curtains and fades near their tips (gusts at most every 450 ms). Release without speech sinks it back into the mic; release with speech floods upward (420 ms). On the way back into the mic, an exit value (300 ms ease-out) widens the corners and flattens the walls into a soft bell, feathers the edge and fades the glass and its dots to transparent, so it ends as a haze rather than a cone. With no patient selected, a voice command opens the patient picker. Reduce Transparency or a failed capture falls back to the plain blur; Reduce Motion keeps it static. `components/sona/liquid-veil.tsx`.

Not yet done: the other six capabilities as generated sections, and on-device feel checks (release build, physical iPhone).

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

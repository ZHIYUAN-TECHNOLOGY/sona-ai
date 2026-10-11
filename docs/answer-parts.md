# Answer parts: marks, cards and the fast lane

The shared contract for richer Sona answers in Sona Care and Sona Pro, on the iPhone apps and the web portals (11 Oct 2026, Jay's ask: the Clef fast lane, and answers that render beautifully with medical terms colour-coded). The code is `packages/domain/src/answer-parts.ts` (pure TS and zod); this page says what each surface does with it.

An answer keeps its words exactly as today. Three optional fields ride beside them:

| Field | What it is | Who writes it |
|---|---|---|
| `marks?: Mark[]` | The words to colour, `{ text, kind }`, each copied from the answer | The model chooses them; the server keeps only words really in the answer (`marksIn`, `marksOf`) |
| `cards?: AnswerCard[]` | Facts and drafted actions shown under the words | The server, from the database. Never the model |
| `lane?: Lane` | `{ intent, confidence, by: "clef-omni" }` when the Clef fast lane answered the turn without Gemma | The server. Telemetry and debugging only |

They go on `care.ask` and `ask.free`. The web portals call the same oRPC procedures, so they get the same fields. A call's `sona_turn` does not carry them yet: the call's prompt asks Gemma for no marks. The Care app and the web call page read `sona_turn.marks` loosely, so they colour a call's answer once it does.

**Reading them:** every client calls `partsOf(answer)`. It reads all three loosely: an unknown mark kind, an unknown card type or a card missing a field is left out, never the answer. An old server sends none of them, and the answer shows as it does today.

## Backward compatibility

- Every new field is optional. The judge iPhone builds ignore `cards` and `lane` (care.ask's answer is read loosely in `apps/care/features/assistant/answers.ts`; ask.free's `spec` is unchanged), and they drop `sona_turn` altogether.
- No answer's words lean on a card an old build cannot show. A Care booking, dose or reading draft rides under Gemma's own answer. A Pro task is drafted only when the app sends `cards: true` on ask.free (an older server ignores the field), so the judge Sona Pro build still gets Gemma's answer to "remind me to…".
- `marks` already exists on care.ask and ask.free. New kinds are safe on old builds: the Care app colours only medicine, dose and warning (`INK` in `apps/care/features/assistant/marked.tsx`) and shows any other kind as semibold ink, with no crash; the Pro app ignores ask.free's marks. New clients read old kinds through `markKindOf`.
- Cards are a field beside `spec`, not an `AskCards` element in the ask catalogue: an old build's `checkAskSpec` refuses an element type it does not know, and the whole answer would vanish. So `packages/api/src/ask-spec.ts` is unchanged apart from a note saying this.
- A card object may grow fields: unknown fields are stripped, so an older app keeps the card.

## Marks

The model judges which words matter; no new keyword rules (founder decision). The apps' word lists stay only as the stand-in for authored answers with no marks (`marksOf` returns `undefined` then; `[]` means the model chose none).

| Kind | Meaning | Old names | Hue | Legend label |
|---|---|---|---|---|
| `warning` | Must not be missed: an emergency sign, an allergy, a critical or clearly abnormal result, calling 999 | Pro `alert` | red | Must not miss |
| `caution` | Unconfirmed, pending or missing, or a value just out of range: something to check | Pro `caution` | amber | Check |
| `medicine` | A medicine, drug class or treatment, by name | both `medicine` | blue | Medicine |
| `dose` | How much and when: a dose or amount, how often, how long, a visit, check-in, date or time | Care `dose`, Care prompt `when` | violet | How much and when |
| `condition` | A diagnosis or condition | Pro `finding` | teal | Condition or symptom |
| `symptom` | A symptom or sign | Pro `symptom` | teal | Condition or symptom |
| `test` | A test or measurement, with its value when given | none | ink (weight only) | Test |

Notes:
- The hue for each kind is `MARK_HUE` in code. Each surface maps the hue to its own palette (table below).
- Five hues and ink, each with one meaning: red must not miss, amber check, blue a medicine, violet how much and when, teal what the patient has.
- Two changes from today, both in Sona Pro. Medicine moves from violet to blue, so it matches Sona Care. Symptom moves from blue to teal, sharing it with condition. Sona Care's colours are unchanged.
- A visit date is `dose` on purpose. It shares violet with the dose ("how much and when", as the Care prompt already says), and it keeps its colour on the judge builds, which know only `dose`.

## Cards

The server builds cards from database rows the answer is about. The model's words explain what something means, and the card shows the facts and the next step. An answer has at most `MAX_CARDS` (6) cards, and at most one of them is an action (`cardsOf` drops a second). Cards follow the words, then the next steps.

| Card | Fields | Built from | Tone (`toneOf`) |
|---|---|---|---|
| `medicine` | name, dose?, how?, times? ("08:00"), note?, source | The plan's medicines (`patientMeds` in care.ts: `line`, `take`, `at`); Pro: the visit's prescriptions | calm |
| `result` | test, value, unit?, flag? (high, low, normal, critical), range?, at?, source | `lab_results`; flag from the lab, else `rangeFlagOf`; critical from `criticalOf`; range from lab-ranges.ts | critical: urgent; high or low: soon; else calm |
| `reading` | label, value, unit, at?, flag? | `observations` (home readings: `source = "patient"`, labels and units from `READING_KINDS`; ward vitals for Pro) | as result |
| `appointment` | title, when, where?, status | `appointments` (`followUpTiming` gives upcoming, due-soon, attended, missed) and `booking_requests` (requested, confirmed, declined) | confirmed: good; due-soon, requested, declined, missed: soon; else calm |
| `warning` | level (urgent, soon, info), title, items | The plan's warning signs (`warningSigns`); urgent on a turn the 999 rules, Gemma or Clef flagged | urgent: urgent; soon: soon; info: calm |
| `steps` | title, items (1 to 8) | Not built yet. Every surface draws it, for when the plan's instructions or a cited leaflet's steps are | calm |
| `doctor` | id, name, specialty, room, rating, careTeam? | `doctors` (care.doctors.list); the same fields as Care's doctor card | calm |
| `action` | do, title, items?, what?, confirm, done, payload | A lane intent Clef is sure of (below). `tellCareTeam` is not drafted yet: an urgent turn already tells the care team | calm |

The `source` on medicine and result is the line the screen shows, in the answer's language ("Your discharge plan", "Lab result").

### Actions: drafted, confirmed, then a receipt

An action card is a draft. Nothing happens until the person taps `confirm` (UX rule 4). Then `done` replaces the button, and the screen-reader announces it. The app sends `payload` as the input of an existing procedure, which checks it again:

| `do` | App | Calls | Payload |
|---|---|---|---|
| `book` | Care | `care.bookings.request` | doctorId, startsAt, reason? |
| `logDose` | Care | `care.doses.take` | key (`doseKey(name, dueAt)`) |
| `logReading` | Care | `care.readings.add` | kind, value, value2?, takenAt? |
| `tellCareTeam` | Care | `care.messages.send` (the app adds `requestId`) | text |
| `createTask` | Pro | `tasks.create` (the app adds `requestId`) | encounterId, title, owner, due? |

## The Clef fast lane

The lane is `clef-omni` on Workers AI (`env.AI`), on while `CLEF_LANE` is "1" (`packages/api/src/decide.ts`). It is approved for routing and triage only (Jay, 11 Oct, an exception to Malaysia-only). It is sent the transcript and one fixed line about the app, nothing from the record. These rules come from the Clef trial (152/160 intents right, median 0.28 s; at confidence 0.7 it took 44 of 160 turns with no errors, and no medical or emergency question):

- **The lane takes only these intents** (`LANE_INTENTS`): Care book_appointment, next_appointment, log_dose, log_reading; Pro create_task, ward_overview. It never answers a medical question and never decides an emergency. `laneSchema` refuses any other intent.
- **These turns skip the lane:** confidence under 0.7, an emergency read of 0.25 or more, the 999 words, a turn with cancel, wait, undo, batal or 取消, a turn Clef reads as calling off, changing or moving something already planned, and a turn that also asks a question (`asks_question`).
- **Clef is never waited for.** It runs beside the turn's own reads (her record and the leaflet search; the visit's record; the web's page) and takes the turn only when it is in first, so an answer Gemma gives is never slower for it.
- **What the lane does:**
  - Care next_appointment: answered at once from her visits (`comingVisits`, the same list Gemma's visit cards use), without Gemma. This is the only Care turn Gemma does not answer.
  - Care book, log_dose and log_reading: Gemma answers as always (a sugar of 2.1 or four paracetamol needs her words), and the lane's drafted action rides under the answer, unless Gemma flags it urgent. A dose is drafted only for the medicine she names; one she does not name is never guessed.
  - Pro ward_overview: the web's rule answer for the ward's list.
  - Pro create_task: a task for the open visit, said as "Drafted, not added yet", with its Review card. Only for an app that sends `cards: true` (the new Sona Pro build; the web panel opens no visit), and only for a role that may add a task. An older build shows the spec alone, so it gets Gemma's answer as before.
- **Escalation** (tell the care team) happens if any one of these holds: the 999 keyword floor, Gemma's urgent flag, or Clef's emergency probability is 0.25 or more. Nothing cancels an escalation. Clef's read makes the care team's task urgent and brings the 999 warning card, but it does not set the answer's `urgent`: that stays Gemma's, because the Care app shows its 999 card in place of the words on an urgent answer, and a near miss (0.22) is close to the cut.
- `lane` is set only when the lane answered the turn. Patients see nothing of it.

## Which surface renders what

All four surfaces keep the answer inside their existing shell: the Pro in-page conversation (no new sheets), and the web's right-side Sona panel. Cards stack under the words with the surface's usual gap. They appear with the answer's own entrance, and with none under Reduce Motion.

| | Sona Care iPhone (`app/assistant.tsx`, `features/assistant/voice.tsx`) | Care web (`routes/care/_app/ask.tsx`, `lib/sona.tsx` text kind) | Sona Pro iPhone (`features/ask/index.tsx` `AnswerView`, `encounter/conversation.tsx`) | Pro web (`lib/sona.tsx` rules kind, `components/ai/rule-answer.tsx`) |
|---|---|---|---|---|
| Marks | `Marked` with the new `INK` map; voice mode passes the marks too | `CareMarked` (`.care-mark[data-mark]`) | ask.free marks fed to `MarkedText` / `SweptLead` as chips (today they are ignored) | `Marked` chips (`.mark[data-mark]`) |
| medicine | Glass row (`surfaceStyle`, as `DoctorCard`): name, dose and times, how; tap opens `/medicine` | `ListCard` row | `ListRow` (title name, detail dose and times) | rule row |
| result, reading | Glass row: value and unit large, flag as a word in its tone, range and when below | `ListCard` row with `Status` in its tone | `ListRow` with `tone` | rule row with tone |
| appointment | Glass row: title, day and time, where, status word; tap opens Visits | `ListCard` row with `Status` | `ListRow` with `tone` | rule row with tone |
| warning | urgent: the existing `Call999` card; soon or info: a plain list under a heading | urgent: `features/care-messages/urgent-card.tsx`; else a list | `Notice` (`warning` for soon); urgent is a red block of its own (`AlertRow` is amber) | `Signal` in its tone, then the list |
| steps | Numbered list under a heading | Numbered list | Numbered list in a `Surface` | Numbered list |
| doctor | The existing `DoctorCard` | `ListRow` with avatar, opens Follow-ups, where she books | not used | not used |
| action | One glass card: title, items, what, the ink `Action` pill, then `Done` | `Card` with `Button` and a done line | The existing `Review` (title, items, what, confirm, done) | A port of `Review` (`Card` + `Button`) in place of the flattened rows |

Pro uses medicine, result, reading, appointment, warning, steps and createTask. The doctor card and the book, logDose, logReading and tellCareTeam actions are Care only.

## Colour table

One semantic token per mark kind and per tone. Web names are CSS variables under `.pro` and `.care` in `apps/web/src/styles/tokens.css`. On the iPhone, Sona Pro's marks are `TINT` in `apps/native/components/sona/marked-text.tsx`, and Sona Care's are `markInk` and `tones` in `apps/care/lib/theme.ts`.

Sona Pro draws a mark as a tinted chip: the text colour on its wash. Sona Care draws a mark as coloured semibold text with no wash, as today. The text colours below are deeper than the plain `palette` colours, so they still reach 4.5:1 on the darkest part of Pro's canvas gradient (#CDDEF5) under a wash.

**Contrast** is the worst case measured (WCAG 2), on these backgrounds:
- Pro light: white, #F5F6F8 and #CDDEF5, with the wash
- Pro dark: #1D1F23 and #282C33, with the wash
- Care light: white, #FAFAFA and the blue wash #EFF6FF
- Care dark: #141414 and #1F1F1F

**Dark** values are the spec for when dark mode lands. All three apps are light-only today: `userInterfaceStyle: "light"` in both app.json files, and the web has no dark theme.

### Marks

| Token (web var) | Kinds | Pro light: text / wash | Care light: text | Pro dark: text / wash | Care dark: text | Contrast (Pro L / Care L / Pro D / Care D) |
|---|---|---|---|---|---|---|
| `mark.warning` (`--mark-warning`) | warning | #8F3434 / #A23E3E at 12% | #C81E2E (`palette.red`) | #F09A9A / at 16% | #FF8A8A | 4.81 / 5.24 / 4.81 / 7.26 |
| `mark.caution` (`--mark-caution`) | caution | #764510 / #8B5518 at 14% | #C2410C (`palette.amber`) | #E8B66E / at 16% | #FDBA74 | 4.88 / 4.76 / 5.37 / 9.77 |
| `mark.medicine` (`--mark-medicine`) | medicine | #1E4FB8 / #245BCC at 10% | #2563EB (`palette.blue`) | #8FB2F5 / at 16% | #93C5FD | 4.72 / 4.75 / 4.79 / 9.14 |
| `mark.dose` (`--mark-dose`) | dose | #5A3DB8 / #6E50D2 at 11% | #9333EA (`palette.violet`) | #BCA8F5 / at 16% | #D8B4FE | 4.81 / 4.94 / 4.86 / 9.32 |
| `mark.teal` (`--mark-teal`) | condition, symptom | #0B5E57 / #0F6E66 at 12% | #0F766E (new `palette.teal`) | #6CCFC2 / at 16% | #5EEAD4 | 4.79 / 5.03 / 5.36 / 11.14 |
| `mark.test` (`--mark-test`) | test | #1D1F23 (ink) / #1D1F23 at 6% | #1F1F1F (ink) | #ECEDEF / at 10% | #F5F5F5 | 10.80 / 15.15 / 8.98 / 15.12 |

### Tones (card flags, statuses and levels)

Each tone is a word in the colour on its wash, as `Chip` and `Status` already draw it.

| Token (web var) | Means | Pro light: text on wash | Care light: text on wash | Pro dark | Care dark | Contrast (Pro L / Care L / Pro D / Care D) |
|---|---|---|---|---|---|---|
| `tone.urgent` (`--red`, `--red-wash`) | critical, urgent | #A23E3E on #F6E4E4 | #C81E2E on #FEF2F2 | #F09A9A on #3A2626 | #FF8A8A on #3B1A1D | 5.20 / 5.22 / 6.59 / 6.85 |
| `tone.soon` (`--amber`, `--amber-wash`) | high, low, due soon, requested, declined, missed | #8B5518 on #F6EBDD | #C2410C on #FFF7ED | #E8B66E on #3A3022 | #FDBA74 on #3A2414 | 5.23 / 4.88 / 6.98 / 8.63 |
| `tone.good` (`--green`, `--green-wash`) | confirmed, an action's done line | #0F6E66 on #E3F1EF | #15803D on #F0FDF4 | #6CCFC2 on #1F3633 | #86EFAC on #14301E | 5.26 / 4.79 / 6.94 / 10.17 |
| `tone.calm` (`--muted`, `--fill-selected`) | normal, upcoming, info, the rest | #59616B on #EEF0F3 | #4E4E4E on #F5F5F5 | #A3AAB4 on #2A2E35 | #A3A3A3 on #262626 | 5.50 / 7.63 / 5.82 / 6.00 |

A normal result stays calm, with "Normal" written out. Colour is kept for what needs the reader (UX rule 3). In Sona Pro, the green tone and the teal mark are the same colour (`palette.green`, as findings are today). This is accepted: one is a word in text, the other a status word on a wash.

## Accessibility: colour plus weight or line, never colour alone

- Every mark is semibold (600), where plain text is regular. In Pro the mark is also a chip, so a marked word reads as marked without its hue.
- `warning` is also underlined (2 px, its own colour, offset 2 px), and `caution` has a dotted underline. So "must not miss" and "check" stand apart from the other kinds for colour-blind readers.
- Every flag, status and level is written as a word ("High", "Critical", "Requested"), never shown as a dot or colour alone.
- Marks never change what a screen reader says (the words are the same). Each card has one accessibility label that reads it as a sentence, for example "Potassium 3.1 mmol/L, low, usual range 3.5 to 5.1". An action card's button is labelled with `confirm`, and `done` is announced after the tap.
- Cards appear with no stagger, and Pro's lead sweep is off, under Reduce Motion. Cards wrap at large text and never set a fixed height.

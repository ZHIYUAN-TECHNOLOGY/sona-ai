# Evidence answer, OpenEvidence style: implementation spec

Status: specified 29 Sep 2026; built 29 Sep 2026, awaiting the owner's review on the iPhone (screenshots in `verification/evidence-answer/`). Decisions below were made by the product owner; build them as written.
Read `CLAUDE.md`, [the handoff](handoff.md) and the [UX principles](design-direction.md#ux-principles-standing-rules-for-every-screen) first.

## 1. Goal

A clinician asks a clinical question inside a patient's visit (typed now, spoken later) and gets an answer in the style of OpenEvidence: every sentence cites numbered sources, how strong the evidence is is said in the words, the sources are one numbered list, and suggested follow-up questions continue the thread. Sona's edge stays: answers are tied to the patient (CURB-65 from the chart), cite the hospital's and the doctor's own library, and record which sources each answer used.

This is Flow 4, `evidence.ask`. It already exists with a rule-based certainty chip, an uncited three-line answer, a PubMed study carousel and a separate library passage list. This spec replaces the answer and certainty parts and merges the two source lists.

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Citations | Like OpenEvidence. The answer is a list of claims; each claim ends with inline numbered citation pills `[1][2]`. Tapping a pill brings that source into view. PubMed studies and library passages form one numbered reference list, studies first. |
| No source, no claim | The server drops any claim with no citation, or citing a number that is not in the reference list. If no claim is left, the answer says there is not enough evidence to answer, instead of guessing. |
| Certainty | Like OpenEvidence. Remove the rule-based certainty chip (`GRADE`, `certaintyOf`, "certainty by rule"). Strength is stated in the claim's words ("a randomised trial found…", "the adult guideline advises…"); each reference shows its design. |
| Follow-ups | Like OpenEvidence. Up to 3 suggested follow-up questions under each answer ("Related"). Tapping one asks it. A question typed right after an evidence answer continues the thread. The earlier questions and answers (up to 4, oldest first) are sent with each follow-up. |
| Deep research (DeepConsult) | Out of scope. |
| Voice questions | Out of scope for this build. The mic plays a fixed scripted sentence today; real voice needs the hosted speech-to-text model (see section 8). |
| Anything needing a hosted model | Mocked now, clearly marked for replacement (section 6). Never touch or call hosted models; ask the owner before any paid Baseten job. |

## 3. User flow

1. In a visit, the clinician types "Should she get steroids for her pneumonia?" (or taps a suggestion). The prompt routes to `evidence`.
2. The evidence card appears in the thread with a working state: "Searching PubMed and your library…", then claims appear.
3. The answer: 2–4 sentences, each ending with citation pills. A caption says whether it is the rehearsed answer, a sample (mock) or a model's synthesis.
4. Sources: one numbered, swipeable list (PubMed studies, then library passages). Tapping a pill in the answer moves the list to that source and highlights it briefly.
5. CURB-65 card, as today.
6. Related: up to 3 follow-up questions. Tapping one adds a new evidence card below with that question and its own cited answer. Typing any question next also continues the thread, even if it would not otherwise route to evidence.
7. Not enough evidence: the card says "Not enough evidence found to answer this. Sona only says what a source supports." and still shows the sources it searched (if any) and Related.

## 4. Architecture

Now (this build):

```
typed question → routePrompt → evidence.ask (oRPC)
  → PubMed search + cache, library search (hybrid, owner-scoped)      [real]
  → one numbered reference list                                        [real]
  → synthesiseEvidence(question, thread, sources)                      [MOCK]
  → sourcedClaims: drop uncited claims; none left → enough: false      [real]
  → provenance row (question, claims, source ids)                      [real]
  → EvidenceCard renders claims + pills, sources, Related, CURB-65     [real UI]
```

Later (when models are hosted, from `docs/delivery-plan.md`): speech-to-text (Qwen3-ASR, box ②) → Laya `pickCard` chooses `evidence` (replaces the regex in `routePrompt`) → the encounter's Cloudflare Agent runs the same evidence tool → Gemma (box ①) writes the claims JSON → citation check → json-render renders the app-owned EvidenceCard (evidence is a predefined page; the model fills words and numbers, never layout or clinical values) → optional text-to-speech reply. The answer streams so claims appear as they are written.

## 5. Data contract

`evidence.ask` input:

```ts
{
  encounterId: string;
  question: string;                                   // trimmed, 1–500 chars
  thread?: { question: string; answer: string }[];    // earlier turns, max 4, oldest first; default []
}
```

Output:

```ts
{
  question: string;
  claims: { text: string; cites: number[] }[];        // cites are 1-based reference numbers
  enough: boolean;                                    // false when no sourced claim is left
  followUps: string[];                                // max 3
  source: "cached" | "fixture" | string;              // rehearsed, mock, or the model's version
  references: {
    n: number;                                        // 1-based, studies first then library
    id: string;                                       // "pmid:…" or the library chunk's source id
    kind: "study" | "library";
    design: "Guideline" | "Review" | "Trial" | "Narrative review" | "Study" | "Library";
    title: string;
    year: number;
    from?: string;                                    // journal, or the library source name
    text: string;                                     // reviewed summary, abstract conclusion, or passage
    url?: string;                                     // PubMed link for studies
    pmid?: string;
    documentId?: string;                              // library only
    section?: string;                                 // library only
  }[];
  pubmed: "live" | "cached" | "unavailable";
  curb65: …;                                          // unchanged
}
```

Remove `answer`, `grade`, `studies` and `passages` from the output (they become `claims` and `references`).

## 6. Server and model seam

- `packages/domain/src/evidence.ts`: add `type Claim = { text: string; cites: number[] }`; turn `ANSWER` into `Claim[]`; add `FOLLOW_UPS` (section 9); add `sourcedClaims(claims, count)` which keeps a claim only if it cites at least one existing reference, merges duplicate numbers and trims text; delete `GRADE` and `certaintyOf` and their test. Test `sourcedClaims` and that the authored content only cites the three rehearsed studies.
- `packages/api/src/models.ts`: change the seam to
  `synthesiseEvidence(input: { question: string; thread: { question: string; answer: string }[]; sources: { n: number; design: string; year?: number; title: string; text: string }[] }): Answer<{ claims: Claim[]; followUps: string[] }>`.
  In `stubModels`, mock it and start the comment with **`MOCK, replace with the hosted evidence model:`** followed by the shape the real model must return. Mock behaviour: one claim per top source (max 3), worded `"A randomised trial (2015) reports: <first sentence>"` citing `[n]`; fixed follow-ups ("What do the guidelines recommend?", "What are the main harms?", "Does this change for severe cases?") minus the question itself. It stays labelled `source: "fixture"`, so the app shows it as a sample.
- The hosted model's instructions (for whoever wires Gemma later): answer only from the numbered sources; 2–4 short claims; every claim cites at least one number; say the strength in words using each source's design; never invent doses or numbers not in a source; return JSON only in the shape above; up to 3 follow-ups the sources could answer.
- `packages/api/src/routers/evidence.ts`: accept `thread`; build `references` (studies from `articlesFor`, then `passagesFor`); rehearsed question or an exact authored follow-up answers from `ANSWER` / `FOLLOW_UPS` with `source: "cached"`, others call the model; apply `sourcedClaims` (for authored content count only the studies, so a missing study drops its claims); store provenance `{ question, claims }` with all reference ids; return the output above.
- Tests: update `packages/api/src/routers/evidence.test.ts` and `packages/retrieval/src/library.test.ts` (they read `passages`; read library references instead, `from` replaces `source`); add tests for a suggested follow-up, for "PubMed down and never fetched → no references, no claims, enough false", and for a model returning uncited or out-of-range claims (all dropped, `enough: false`). Update `packages/api/src/models.test.ts` for the new seam input.

## 7. App (apps/native)

Files: `features/evidence/index.tsx` (EvidenceCard), `features/live/evidence-sync.ts` (send `thread`, cache per request), `features/encounter/state.ts` + `workspace-screen.tsx` (continue the thread), `packages/domain/src/types.ts` (`FeatureProps.onRequest(kind, prompt?)`; `run` already accepts a prompt).

EvidenceCard, top to bottom (one feature surface for the answer; everything else plain `Surface`):

1. **Answer** (`Surface feature`): the claims as short paragraphs. After each claim, citation pills: small rounded pills with the number (13 pt, semibold, blue text on a light blue fill, 44 pt hit area via `hitSlop`), accessibility label "Source 2, randomised trial, Lancet 2015". No certainty chip. Below: the existing `SampleLabel` for fixture answers and a one-line caption ("Rehearsed answer" / "Sample: not a model's reading" / "Written by <model>").
2. **Not enough evidence** (when `enough` is false): replace the claims with the sentence from section 3, in the muted amber used for notices.
3. **Sources** (reuse the existing swipeable carousel and year track, after Monogram's rich-response carousel): one card per reference with a number badge, design chip (Guideline in blue, others neutral, Library in teal), `year · journal/source`, title, excerpt, and "Open abstract" for PubMed or the section name for library passages. Tapping a pill in the answer springs the carousel to that card (same spring as a tap on the track, 0.38 s, damping 0.82) and gives the card a short highlight (ring or tint fading over ~600 ms). Remove the separate "From your library" list.
4. **CURB-65** card, unchanged.
5. **Related**: up to 3 rows (question text + `arrow.up.right` or chevron), pressable (scale 0.96, 120 ms), `haptic("select")`, calling `onRequest("evidence", question)`. Hidden while the answer is loading.

States: loading shows the existing "Searching PubMed and your library, checking the chart…" line (dithering only while Sona is working, per the design system); error shows the error line; offline (fixture mode, not live) shows the rehearsed answer for the rehearsed question and the authored follow-up answers for the three suggested follow-ups, and for any other question says live mode answers it, instead of borrowing the steroid answer.

Thread: each follow-up is its own evidence card in the conversation, showing its question. `useLiveEvidence` passes the earlier evidence questions in this encounter (and their claims joined as text, from the session cache) as `thread`. In `workspace-screen.tsx` `submit`, if `routePrompt` returns null and the most recent request in the encounter is `evidence`, route to `evidence`.

Rules: follow the design system (glass first, dithering as accent, one feature surface), Reduce Motion (no spring, no highlight animation; keep the scroll), VoiceOver order (claim, then its citations), and the UX principles. Use the `animate-expo` guidance for the pill-to-carousel motion; no new animation libraries.

## 8. Voice (not in this build)

The mic in the dock (`features/encounter/voice-dock.tsx`) plays a scripted transcript and never records. Real voice questions come with the hosted Qwen3-ASR (box ②) and Laya routing. Do not change the mic in this build.

## 9. Authored rehearsed content

Rehearsed question: steroids for community-acquired pneumonia (regex `REHEARSED` in the router). References 1–3 are the existing `STUDIES`: [1] ATS/IDSA adult CAP guideline 2019 (PMID 31573350), [2] Blum 2015 Lancet, prednisone (25608756), [3] Dequin 2023 NEJM, CAPE COD hydrocortisone (36942789).

Answer:
- "Routine corticosteroids are not recommended for non-severe community-acquired pneumonia; the adult guideline advises against them." [1]
- "In severe pneumonia treated in intensive care, a large randomised trial found hydrocortisone lowered 28-day mortality, so steroids can be considered there." [3]
- "Outside severe cases, a randomised trial found a week of prednisone reached stability about a day sooner but raised blood glucose, with no difference in mortality." [2, 1]

Suggested follow-ups and their answers:
- "When would steroids be reasonable for her?"
  - "Only if her pneumonia becomes severe enough for intensive care: that is where the randomised trial found hydrocortisone lowered 28-day mortality." [3]
  - "While it stays non-severe, the guideline advises against routine steroids." [1]
- "What harms should I watch for?"
  - "High blood glucose: patients given prednisone had it more often, sometimes needing insulin." [2]
  - "That trial found no difference in mortality, so the harm is not offset by survival outside severe cases." [2]
- "What dose and duration did the trials use?"
  - "Prednisone 50 mg once daily for 7 days in hospitalised patients." [2]
  - "Intravenous hydrocortisone 200 mg a day for 4 days, then tapered, for 8 or 14 days in all, in intensive care." [3]

Have a clinician check these sentences before a live demo.

## 10. Mock register

Add a "Mocked until models are hosted" section to `docs/handoff.md` listing: evidence synthesis and follow-ups (`stubModels.synthesiseEvidence`, replaced by Gemma, box ①); question routing (regex `routePrompt`, replaced by Laya `pickCard`); voice transcript (scripted, replaced by Qwen3-ASR, box ②); library embeddings (`stubEmbedder`, replaced by EmbeddingGemma); passage reranking (none, bge-reranker). Each entry: file, what it does now, what replaces it, and the shape to keep.

## 11. Done when

- `bun run check-types` and `bun run test` pass, including the new tests in section 6.
- Offline demo: the rehearsed question shows the cited answer, pills move the source carousel, and each Related question shows its authored cited answer.
- Live mode (local server or staging): any other question shows a sample-labelled cited answer from real PubMed and library sources; a follow-up sends the thread; a question with no sources shows "not enough evidence".
- The owner reviews it on the iPhone; screenshots of the flow go in `docs/verification/`.

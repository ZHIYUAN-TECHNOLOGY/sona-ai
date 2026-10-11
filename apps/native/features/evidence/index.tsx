import { ErrorLine, Press, PressScale } from "@/components/sona/parts";
import * as WebBrowser from "expo-web-browser";
import { Image } from "expo-image";
import { router } from "expo-router";
import { QuestionList } from "@/components/sona/list";
import { MarkedText, markStyle, segments, type Mark } from "@/components/sona/marked-text";
import { useEffect, useRef, useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { FadeIn, FadeInDown, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { SampleLabel } from "@/components/sona/model-answer";
import { EASE_OUT, EASE_OUT_CSS, riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Icon, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { useSeenOnce } from "@/components/sona/use-visible";
import { haptic } from "@/features/clinical/medication-parts";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { StreamedLead } from "@/features/encounter/conversation";
import type { Patient } from "@/features/encounter/types";
import { ImageEdge, VIEWING, type ImageMarker } from "@/features/imaging/viewer";
import { markerAt } from "@/features/imaging/zoom";
import { api } from "@/features/live";
import { threadBefore, useLiveEvidence, type EvidenceStep, type ServerEvidence, type Turn } from "@/features/live/evidence-sync";
import { wakingOf } from "@/features/live/waking";
import { basis, calmTerms, fallbackNote, forPatient, searchedLine, sections, stepLines, strength, unanswered } from "./answer";
import { dataUri, filmMarkers, leadImage, openLabels } from "./film";
import { authoredAnswer, authoredReferences, curb65, quotedClaims, severityApplies, type Claim, type Reference } from "./model";

/*
 * Evidence answer, OpenEvidence style (docs/evidence-answer-spec.md): short claims, each ending in
 * numbered citation pills; one numbered source list; follow-up questions under "Related". The
 * sources sit in a swipeable row synced to a small track above it (after Monogram's rich-response
 * carousel): the row follows the finger, and on release it snaps on a spring (0.36 s, damping 0.82)
 * to the next card past 55 pt or a 260 pt/s flick, while the track's pill glides to the matching
 * year. A citation pill springs the row to its source (0.38 s, damping 0.82) and the card glows
 * briefly. Cards off-centre shrink to 0.93 and dim. The severity score then fills like 1Password's
 * Watchtower meter: the arc sweeps on an ease-out as each factor is checked, and the score settles.
 */
const TEAL = palette.green;
const SNAP = { duration: 360, dampingRatio: 0.82 }, TAP = { duration: 380, dampingRatio: 0.82 };

/** The rehearsed demo question, for an answer opened without its prompt. */
const REHEARSED_QUESTION = "Steroids for this patient with community-acquired pneumonia?";
const SOURCES_NOTE: Record<ServerEvidence["pubmed"], string> = { live: "PubMed · conclusions quoted from each abstract", cached: "PubMed, saved copy · offline now", unavailable: "PubMed unreachable · no studies" };
const DESIGN_WORDS: Record<Reference["design"], string> = { Guideline: "guideline", Review: "systematic review", Trial: "randomised trial", "Narrative review": "narrative review", Study: "study", Library: "your library", Imaging: "the patient's X-ray", "Patient record": "the patient's record" };
const NOT_ENOUGH = "Not enough evidence found to answer this.";

type Shown = { bottomLine?: string; claims: Claim[]; enough: boolean; followUps: string[]; references: Reference[]; source?: string; note: string };

/** A visit's evidence card: the request's question, answered for this patient (their CURB-65), its follow-ups asked in the visit. */
export function EvidenceCard({ patient, result, onRequest }: FeatureProps) {
  const { encounters } = useEncounter();
  const requests = encounters[patient.id]?.requests ?? [];
  const question = requests.find(r => r.id === result?.requestId)?.prompt || REHEARSED_QUESTION;
  return <EvidenceAnswer question={question} encounterId={patient.encounterId} answerKey={result?.requestId ?? `${patient.encounterId}:${question}`}
    thread={threadBefore(requests, result?.requestId)} patient={patient} onAsk={q => onRequest("evidence", q)} />;
}

/**
 * One evidence answer, in a visit or anywhere else (no `patient`): while Sona works, the steps it has taken so far; then,
 * when `lead`, its bottom line (a visit says it as the visit's lead instead), what the answer rests on, the line tying it
 * to this patient, the claims under their topics with each citation's strength, in a visit what the evidence means for
 * this patient (each point with its source and the recorded fact it rests on), the sources, and Related questions.
 * A citation opens, under its claim, the sentence from that source that supports it. Live mode asks the server;
 * otherwise the authored answers show, for the rehearsed question and its follow-ups only.
 */
type AnswerProps = { question: string; encounterId?: string; answerKey: string; thread: Turn[]; patient?: Patient; lead?: boolean; onAsk: (question: string) => void };
export function EvidenceAnswer(props: AnswerProps) {
  // Retry asks the same question again: a failed answer is never kept (evidence-sync's `keeps`), so mounting the answer afresh asks the server once more.
  const [attempt, setAttempt] = useState(0);
  return <Answer key={attempt} {...props} onRetry={() => setAttempt(a => a + 1)} />;
}

function Answer({ question, encounterId, answerKey, thread, patient, lead = false, onAsk, onRetry }: AnswerProps & { onRetry: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const { live, data, steps, written, error } = useLiveEvidence(encounterId, answerKey, question, thread);
  const [focus, setFocus] = useState<{ n: number; at: number }>();
  // The reveal plays once, for an answer that lands while this is on screen; one already fetched just shows.
  const [landing] = useState(() => live && !data);
  const at = (i: number) => (landing && !reducedMotion ? rise(i) : undefined);
  // Streamed from the moment its first part is written: the steps fold away and the answer grows in place, part by part.
  const writing = live && !data && written && (written.bottomLine || written.claims.length) ? written : undefined;
  if (live && !data && !writing) return error ? <Surface feature style={{ padding: 16 }}><ErrorLine text={`The evidence answer didn't load: ${error}`} onRetry={onRetry} /></Surface>
    : <Animated.View exiting={reducedMotion ? undefined : fold} style={{ transformOrigin: "top" }}><EvidenceSteps steps={steps} /></Animated.View>;
  const authored = data || writing ? undefined : authoredAnswer(question);
  const shown: Shown | undefined = data
    ? { ...data, note: data.source === "cached" && data.references.some(r => r.kind === "study") ? `${data.pubmed === "live" ? "PubMed records" : "PubMed, saved copy"} · reviewed summaries` : data.references.some(r => r.kind === "library") && data.pubmed !== "live" ? "Your library · PubMed unreachable" : SOURCES_NOTE[data.pubmed] }
    : writing ? { bottomLine: writing.bottomLine, claims: writing.claims, enough: true, followUps: [], references: writing.references ?? [], note: "" }
    : authored && { ...authored, claims: quotedClaims(authored.claims, authoredReferences()), enough: true, references: authoredReferences(), source: undefined, note: "Authored summaries · links open PubMed" };
  const caption = !shown || writing ? "" : !data ? "Rehearsed answer" : data.source === "cached" ? "Rehearsed answer" : "";
  const cite = (n: number) => { haptic("select"); setFocus({ n, at: Date.now() }); };
  const rests = shown?.enough ? basis(shown.claims, shown.references) : "";
  // The model did not answer (or is starting, and is asked again by itself): said as that, not as thin evidence or a sample.
  const failed = unanswered(data, wakingOf(data));
  // A real answer made with less than usual (cut short, or the library found without its search or ranking model) says so in one line.
  const fallback = failed ? undefined : fallbackNote(data);
  // Tied to the patient once the server's CURB-65 is in (or, without the server, the chart's own).
  const mine = patient && !writing && forPatient(question, patient.name.split(" ")[0]!, data ? data.curb65 : curb65(patient));
  // An answer about the patient's X-ray leads with the film itself, its findings ringed, above the claims.
  const film = shown && leadImage(shown.references);

  return <View style={{ gap: 14 }}>
    {/* The steps, folded to one line: writing while the answer streams in, then what was searched, read and cited. */}
    {(data || writing) && <Animated.View key="status" entering={at(0)} accessible accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <StepMark done={Boolean(data)} still={reducedMotion} />
      <Text numberOfLines={1} style={{ ...type.footnote, flexShrink: 1, color: palette.muted }}>{data ? searchedLine(data.claims, data.references) : "Writing the answer…"}</Text>
    </Animated.View>}
    {lead && shown?.bottomLine && <Animated.View entering={at(1)}><StreamedLead text={calmTerms(shown.bottomLine)} animate /></Animated.View>}
    {/* The card's surface only fades in; what it holds rises, block by block. */}
    <Animated.View entering={landing && !reducedMotion ? riseIn({ delay: REVEAL.step, distance: 0, duration: 300 }) : undefined}><Surface feature style={{ padding: 16, gap: 12 }}>
      {(rests || mine) && <Animated.View entering={at(2)} style={{ gap: 4 }}>
        {rests ? <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>{rests}</Text> : null}
        {mine && <Text style={{ ...type.subhead, fontWeight: "600", color: palette.blue }}>{mine}</Text>}
      </Animated.View>}
      {film && <Animated.View entering={at(2)}><FilmLead reference={film} /></Animated.View>}
      {!shown ? <Text style={{ ...type.callout, color: palette.muted }}>Live mode answers this question from PubMed and your library. Switch it on in Settings.</Text>
        : shown.enough ? sections(shown.claims).map((section, i) => <Animated.View key={section.topic} entering={at(3 + i)} style={{ gap: 10 }}>
          {section.title && <Text style={{ ...type.overline, color: palette.muted }}>{section.title}</Text>}
          {section.claims.map((c, j) => <ClaimLine key={j} claim={c} references={shown.references} onCite={cite} />)}
        </Animated.View>)
        : data?.general ? <View style={{ gap: 4 }}>
          <Text selectable style={{ ...type.callout, color: palette.ink }}>{data.general}</Text>
          <Text selectable style={{ ...type.caption, color: palette.muted }}>General answer · no source found for this</Text>
        </View>
        : failed ? <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text selectable style={{ ...type.callout, flex: 1, color: palette.amber }}>{failed}</Text>
          {/* While the model starts the card asks again by itself (every 45 s); Retry asks now. */}
          <Press onPress={onRetry} accessibilityLabel={`Retry. ${failed}`} scale={0.96} style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={{ ...type.callout, fontWeight: "600", color: palette.blue }}>Retry</Text>
          </Press>
        </View>
        : <Text selectable style={{ ...type.callout, color: palette.amber }}>{NOT_ENOUGH}</Text>}
      {/* Asked in a visit: what the evidence means for this patient, set apart under the claims and labelled as theirs. Each
          point keeps its source pills, and under it the fact from the patient's record it rests on, in the record's own words. */}
      {data?.enough && data.patientPoints?.length ? <Animated.View entering={at(5)} style={{ gap: 10, paddingTop: 12, borderTopWidth: 1, borderColor: "rgba(20,28,40,0.06)" }}>
        <Text style={{ ...type.overline, color: palette.blue }}>{patient ? `For ${patient.name.split(" ")[0]}` : "For this patient"} · from the record</Text>
        {data.patientPoints.map((p, j) => <View key={j} style={{ gap: 4 }}>
          <ClaimLine claim={p} references={data.references} onCite={cite} />
          <Text selectable style={{ ...type.caption, color: palette.muted }}>Recorded: {p.fact}</Text>
        </View>)}
      </Animated.View> : null}
      {shown && <View style={{ gap: 4 }}>
        {fallback ? <Text selectable style={{ ...type.caption, color: palette.amber }}>{fallback}</Text> : null}
        {data && data.references.length > 0 && !failed && <SampleLabel source={data.source === "fixture" || data.source === "cached" ? data.source : "model"} model={data.source} waking={wakingOf(data)} what="evidence" />}
        {caption ? <Text selectable style={{ ...type.caption, color: palette.muted }}>{caption}</Text> : null}
      </View>}
    </Surface></Animated.View>
    {shown && shown.references.length > 0 && <Animated.View entering={at(6)}><Sources references={shown.references} note={shown.note} focus={focus} /></Animated.View>}
    {data && !data.references.length && <Text selectable style={{ ...type.footnote, color: palette.amber }}>{data.pubmed === "unavailable" ? SOURCES_NOTE.unavailable : "Nothing on this in PubMed or your library"}</Text>}
    {/* Only where pneumonia is the subject (severityApplies, as the server decides): the question, its thread, or the visit's recorded condition. */}
    {patient && severityApplies([question, ...thread.map(t => t.question)], [patient.complaint, patient.subtitle, ...patient.history]) && <Animated.View entering={at(7)}><Severity patient={patient} server={data?.curb65 ?? undefined} /></Animated.View>}
    <Animated.View entering={at(7)}><QuestionList title="Related" questions={shown?.followUps.map(q => ({ key: q, text: q })) ?? []} onAsk={onAsk} /></Animated.View>
  </View>;
}

/*
 * The answer lands (after Monogram's pulse-sweep reveal, 60fps): the searched line, the bottom line, then each block of
 * the card rise 24 pt into place and fade in over 0.55 s on the ease-out, 60 ms apart; the card's own surface only fades.
 * The steps fold away meanwhile: their card lifts 10 pt, flattens toward its top edge and fades (0.28 s).
 */
const REVEAL = { distance: 24, duration: 550, step: 60 };
const rise = (i: number) => riseIn({ delay: REVEAL.step * i, distance: REVEAL.distance, duration: REVEAL.duration });
function fold() {
  "worklet";
  const config = { duration: 280, easing: EASE_OUT };
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }, { scaleY: 1 }] },
    animations: { opacity: withTiming(0, { duration: 220, easing: EASE_OUT }), transform: [{ translateY: withTiming(-10, config) }, { scaleY: withTiming(0.5, config) }] },
  };
}

/*
 * What Sona is doing while the answer is made (after Remy's analysis checklist, 60fps), one line per step as the server
 * reports it: each slides up 10 pt and fades in over 0.45 s; the step in progress breathes (a dot with a soft halo that
 * swells and fades every 1.1 s, only while it works); a finished step's tick pops in on a spring (0.35 s, damping 0.55)
 * with a short teal glow that settles to a faint halo. Reduced motion: the same marks, still.
 */
function EvidenceSteps({ steps }: { steps: EvidenceStep[] }) {
  const { reducedMotion } = useAccessibleEffects();
  const lines = stepLines(steps);
  return <Surface feature style={{ padding: 16, gap: 12 }}>
    <View accessible accessibilityLiveRegion="polite" accessibilityLabel={lines.at(-1)!.text} style={{ gap: 12 }}>
      {lines.map(line => <Animated.View key={line.key} entering={reducedMotion ? undefined : riseIn({ distance: 10, duration: 450 })} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <StepMark done={line.done} still={reducedMotion} />
        <Text style={{ ...type.subhead, flex: 1, color: line.done ? palette.muted : palette.ink, fontWeight: line.done ? "400" : "600" }}>{line.text}</Text>
      </Animated.View>)}
    </View>
  </Surface>;
}

const BLUE_HALO = "rgba(36,91,204,0.22)";
/** A step's mark: while it works, a dot breathing in its halo; once done, a tick that pops in with a short glow. */
function StepMark({ done, still }: { done: boolean; still: boolean }) {
  return <View style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
    {done ? <>
      {/* The glow ends where its style rests (a faint halo), so nothing jumps when the animation hands over. */}
      <Animated.View key="glow" entering={still ? undefined : glow} style={{ position: "absolute", width: 22, height: 22, borderRadius: 11, backgroundColor: TEAL, opacity: 0.12, transform: [{ scale: still ? 1 : 1.3 }] }} />
      <Animated.View key="tick" entering={still ? undefined : pop}><Icon name="checkmark" size={13} color={TEAL} /></Animated.View>
    </> : <>
      <Animated.View key="halo" style={{ position: "absolute", width: 22, height: 22, borderRadius: 11, backgroundColor: BLUE_HALO, ...(still ? { opacity: 0.6 } : BREATHE) }} />
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.blue }} />
    </>}
  </View>;
}
const BREATHE = { animationName: { from: { opacity: 0.9, transform: [{ scale: 0.55 }] }, to: { opacity: 0, transform: [{ scale: 1.2 }] } }, animationDuration: 1100, animationIterationCount: "infinite", animationTimingFunction: EASE_OUT_CSS } as const;
function pop() {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ scale: 0.6 }] }, animations: { opacity: withTiming(1, { duration: 120 }), transform: [{ scale: withSpring(1, { duration: 350, dampingRatio: 0.55 }) }] } };
}
function glow() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.8 }] },
    animations: { opacity: withSequence(withTiming(0.4, { duration: 120 }), withTiming(0.12, { duration: 600, easing: EASE_OUT })), transform: [{ scale: withTiming(1.3, { duration: 700, easing: EASE_OUT }) }] },
  };
}

/**
 * One claim laid out word by word so its citation pills are real rounded pills that wrap with the last words. Key terms
 * keep their tint, and a term of several words reads as one tint. Each pill says its number and strength ("1 · Guideline");
 * tapping it opens, under the claim, the sentence from that source that supports the claim. VoiceOver reads the claim
 * once, then each citation.
 */
function ClaimLine({ claim, references, onCite }: { claim: Claim; references: Reference[]; onCite: (n: number) => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const [open, setOpen] = useState<number>();
  // Words with their tint, and whether a space follows: punctuation after a tinted term ("pneumonia;") stays attached.
  const words: { word: string; mark?: Mark; space: boolean }[] = [];
  for (const seg of segments(calmTerms(claim.text))) {
    if (/^\s/.test(seg.text) && words.length) words[words.length - 1]!.space = true;
    for (const m of seg.text.matchAll(/(\S+)(\s*)/g)) words.push({ word: m[1]!, mark: seg.mark, space: m[2]!.length > 0 });
  }
  const plainText = segments(claim.text).map(s => s.text).join("");
  const proof = open === undefined ? undefined : { source: references.find(r => r.n === open), quote: claim.quotes?.find(q => q.n === open)?.text };
  return <View style={{ gap: 8 }}>
    <Text accessible accessibilityLabel={plainText} style={{ position: "absolute", opacity: 0 }}>{plainText}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: 2 }}>
      {words.map((w, i) => {
        // The space inside a term of several words takes the tint too, so "intensive care" is one tint, not two.
        const joined = w.mark && w.space && words[i + 1]?.mark === w.mark;
        return <Text key={i} accessible={false} style={{ ...type.callout, color: palette.ink }}>{w.mark ? <Text style={markStyle(w.mark)}>{joined ? `${w.word} ` : w.word}</Text> : w.word}{w.space && !joined ? " " : ""}</Text>;
      })}
      {claim.cites.map(n => { const r = references.find(x => x.n === n), on = open === n;
        return <Pressable key={n} accessibilityRole="button" accessibilityState={{ expanded: on }} accessibilityLabel={`Source ${n}${r ? `, ${DESIGN_WORDS[r.design]}, ${[r.from, r.year].filter(Boolean).join(" ")}` : ""}`} accessibilityHint="Shows what this source says"
          hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }} onPress={() => { setOpen(on ? undefined : n); if (!on) onCite(n); }}
          style={{ marginLeft: 4 }}>{({ pressed }) => <PressScale pressed={pressed} style={{ height: 22, paddingHorizontal: 7, borderRadius: 11, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: on ? palette.blue : "rgba(36,91,204,0.12)" }}>
          <Text style={{ ...type.caption, fontWeight: "700", color: on ? palette.white : palette.blue, fontVariant: ["tabular-nums"] }}>{n}</Text>
          {r && <Text style={{ ...type.caption, fontWeight: "500", color: on ? palette.white : palette.blue }}>· {strength(r.design)}</Text>}
        </PressScale>}</Pressable>; })}
    </View>
    {proof?.source && <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(200)} style={{ gap: 6, padding: 12, borderRadius: radius.control, backgroundColor: "rgba(36,91,204,0.06)", borderLeftWidth: 3, borderLeftColor: palette.blue }}>
      {proof.quote ? <Text selectable style={{ ...type.subhead, color: palette.ink }}>“{proof.quote}”</Text>
        : <Text style={{ ...type.footnote, color: palette.muted }}>This source has no single sentence quoted for this claim. Open it to read the whole of it.</Text>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text numberOfLines={1} style={{ ...type.caption, flex: 1, color: palette.muted }}>{[DESIGN_WORDS[proof.source.design].replace(/^./, c => c.toUpperCase()), proof.source.year, proof.source.from].filter(Boolean).join(" · ")}</Text>
        {proof.source.url ? <Pressable accessibilityRole="link" accessibilityLabel={`Open the PubMed abstract for ${proof.source.title}`} hitSlop={8} onPress={() => { void WebBrowser.openBrowserAsync(proof.source!.url!).catch(() => {}); }} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={{ ...type.caption, fontWeight: "600", color: palette.blue }}>Open abstract</Text>
          <Icon name="arrow.up.right" size={10} color={palette.blue} />
        </Pressable> : null}
      </View>
    </Animated.View>}
  </View>;
}

function Sources({ references, note, focus }: { references: Reference[]; note: string; focus?: { n: number; at: number } }) {
  const { width } = useWindowDimensions();
  const { reducedMotion } = useAccessibleEffects();
  const area = width - 40, cardW = Math.round(area * 0.84), step = cardW + 12, last = references.length - 1;
  const pos = useSharedValue(0), start = useSharedValue(0);
  const [active, setActive] = useState(0);
  const land = (i: number) => { setActive(i); haptic("select"); };
  const go = (i: number) => { pos.set(reducedMotion ? i : withSpring(i, TAP)); land(i); };
  // A citation pill: spring to its source, and flash that card.
  useEffect(() => { if (!focus) return; const i = references.findIndex(r => r.n === focus.n); if (i < 0) return; pos.set(reducedMotion ? i : withSpring(i, TAP)); setActive(i); }, [focus?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const pan = Gesture.Pan().activeOffsetX([-10, 10]).failOffsetY([-12, 12])
    .onStart(() => { start.set(pos.value); })
    .onUpdate(e => { pos.set(Math.min(last + 0.15, Math.max(-0.15, start.value - e.translationX / step))); })
    .onEnd(e => {
      const from = Math.round(start.value);
      const target = e.translationX < -55 || e.velocityX < -260 ? Math.min(last, from + 1) : e.translationX > 55 || e.velocityX > 260 ? Math.max(0, from - 1) : from;
      pos.set(withSpring(target, { ...SNAP, velocity: -e.velocityX / step }));
      if (target !== from) scheduleOnRN(land, target);
    });

  return <View style={{ gap: 12 }} accessibilityLabel={`${references.length} sources`}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <Text style={{ ...type.overline, color: palette.muted }}>Sources · swipe</Text>
      <Text numberOfLines={1} style={{ ...type.caption, flexShrink: 1, color: palette.muted }}>{note}</Text>
    </View>
    <Track references={references} pos={pos} active={active} onPick={go} />
    <GestureDetector gesture={pan}>
      <View style={{ height: 196, marginHorizontal: -20, overflow: "hidden" }}>
        {references.map((r, i) => <SourceCard key={r.id} source={r} index={i} pos={pos} left={20 + (area - cardW) / 2} width={cardW} step={step} flash={focus && references[i]?.n === focus.n && !reducedMotion ? focus.at : undefined} />)}
      </View>
    </GestureDetector>
  </View>;
}

/** The track above the row: one node per source, a pill that glides with the row's position. */
function Track({ references, pos, active, onPick }: { references: Reference[]; pos: SharedValue<number>; active: number; onPick: (i: number) => void }) {
  const [w, setW] = useState(0);
  const gap = references.length > 1 ? w / (references.length - 1) : 0;
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: Math.min(references.length - 1, Math.max(0, pos.value)) * gap - 12 }] }));
  return <View style={{ paddingHorizontal: 28, gap: 6 }}>
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height: 24, justifyContent: "center" }}>
      <View style={{ height: 1.5, backgroundColor: "rgba(20,28,40,0.1)" }} />
      {references.map((r, i) => <Pressable key={r.id} accessibilityRole="button" accessibilityState={{ selected: active === i }} accessibilityLabel={`Source ${r.n}, ${DESIGN_WORDS[r.design]} ${r.year}`} hitSlop={10} onPress={() => onPick(i)}
        style={{ position: "absolute", left: i * gap - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: "rgba(20,28,40,0.14)" }} />)}
      <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: palette.white, boxShadow: "0 1px 4px rgba(20,28,40,0.14)" }, pill]}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: palette.blue }} />
      </Animated.View>
    </View>
    <View style={{ height: 16 }}>
      {references.map((r, i) => { const edge = i === 0 ? "left" : i === references.length - 1 ? "right" : "center";
        return <Text key={r.id} style={{ position: "absolute", left: edge === "left" ? -12 : edge === "right" ? i * gap - 68 : i * gap - 40, width: 80, textAlign: edge, ...type.caption, fontWeight: active === i ? "700" : "500", color: active === i ? palette.ink : palette.muted, fontVariant: ["tabular-nums"] }}>{r.year}</Text>; })}
    </View>
  </View>;
}

function SourceCard({ source, index, pos, left, width, step, flash }: { source: Reference; index: number; pos: SharedValue<number>; left: number; width: number; step: number; flash?: number }) {
  const glow = useSharedValue(0);
  useEffect(() => { if (flash) glow.set(withSequence(withTiming(1, { duration: 120 }), withTiming(0, { duration: 600, easing: EASE_OUT }))); }, [flash, glow]);
  const style = useAnimatedStyle(() => {
    const d = Math.abs(index - pos.value);
    return { opacity: Math.max(0.55, 1 - d * 0.35), zIndex: Math.round(10 - d), transform: [{ translateX: (index - pos.value) * step }, { scale: Math.max(0.93, 1 - d * 0.07) }] };
  });
  const ring = useAnimatedStyle(() => ({ opacity: glow.value }));
  const chip = source.design === "Guideline" ? { bg: "rgba(36,91,204,0.1)", fg: palette.blue } : source.design === "Library" ? { bg: "rgba(15,110,102,0.1)", fg: TEAL } : { bg: "rgba(20,28,40,0.06)", fg: palette.ink };
  return <Animated.View style={[{ position: "absolute", top: 4, left, width }, style]}>
    <Surface style={{ padding: 16, gap: 8, height: 186, borderRadius: radius.group }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(36,91,204,0.12)" }}>
          <Text style={{ ...type.caption, fontWeight: "700", color: palette.blue, fontVariant: ["tabular-nums"] }}>{source.n}</Text>
        </View>
        <View style={{ height: 22, paddingHorizontal: 8, borderRadius: 11, justifyContent: "center", backgroundColor: chip.bg }}>
          <Text style={{ ...type.caption, fontWeight: "700", color: chip.fg }}>{source.design}</Text>
        </View>
        <Text numberOfLines={1} style={{ ...type.caption, flex: 1, color: palette.muted, fontVariant: ["tabular-nums"] }}>{source.year}{source.from ? ` · ${source.from}` : ""}</Text>
      </View>
      <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "700", color: palette.ink }}>{source.title}</Text>
      {/* An image source is the film, small, with its findings ringed; the reading stays in the lead and the imaging screen. */}
      {source.kind === "image" ? <Film reference={source} style={{ flex: 1 }} /> : <MarkedText selectable={false} text={source.text} style={{ ...type.footnote, flex: 1, color: palette.ink }} />}
      {source.url ? <Pressable accessibilityRole="link" accessibilityLabel={`Open the PubMed abstract for ${source.title}`} hitSlop={8} onPress={() => { void WebBrowser.openBrowserAsync(source.url!).catch(() => {}); }} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>Open abstract</Text>
        <Icon name="arrow.up.right" size={10} color={palette.blue} />
      </Pressable> : source.section ? <Text numberOfLines={1} style={{ ...type.footnote, fontWeight: "600", color: TEAL }}>{source.section}</Text> : null}
    </Surface>
    <Animated.View pointerEvents="none" style={[{ position: "absolute", inset: 0, borderRadius: radius.group, borderWidth: 2, borderColor: palette.blue, backgroundColor: "rgba(36,91,204,0.06)" }, ring]} />
  </Animated.View>;
}

/*
 * The patient's film in the answer: fetched once per visit for the session (the bytes are large, and an answer re-renders
 * often), shown as it is stored with the findings read from it ringed at their points. No zoom here: the film opens the
 * visit's imaging screen, where the viewer already has pinch, torch and the findings list. Nothing moves while idle.
 */
export type FilmData = { uri: string; markers: ImageMarker[]; open: string[] };
const films = new Map<string, Promise<FilmData>>();
function filmOf(encounterId: string) {
  let film = films.get(encounterId);
  if (!film) {
    film = Promise.all([api.xray.image({ encounterId }), api.findings.list({ encounterId })]).then(([image, findings]) => ({ uri: dataUri(image), markers: filmMarkers(findings, image.key), open: openLabels(findings, image.key) }));
    // A failed fetch is not kept, so the next answer about this visit asks again.
    film.catch(() => films.delete(encounterId));
    films.set(encounterId, film);
  }
  return film;
}
/** A visit's film with its marks, once per session (`filmOf`); the imaging card's Compare row shares it. */
export function useFilm(encounterId?: string) {
  const [film, setFilm] = useState<FilmData | "failed">();
  useEffect(() => {
    if (!encounterId) { setFilm("failed"); return; }
    let gone = false;
    filmOf(encounterId).then(f => { if (!gone) setFilm(f); }, () => { if (!gone) setFilm("failed"); });
    return () => { gone = true; };
  }, [encounterId]);
  return film;
}

const RING = 24;
/** A film's pixels filling their box, its findings ringed at their points; no zoom, nothing moves. */
export function RingedFilm({ film }: { film: FilmData }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [aspect, setAspect] = useState(0);
  return <View style={{ flex: 1 }} onLayout={e => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
    <Image source={{ uri: film.uri }} contentFit="contain" style={{ flex: 1 }} transition={0} onLoad={e => { if (e.source.width && e.source.height) setAspect(e.source.width / e.source.height); }} />
    {aspect > 0 && box.w > 0 && film.markers.map(m => { const [px, py] = markerAt(box.w, box.h, aspect, m.x, m.y);
      return <View key={m.id} pointerEvents="none" style={{ position: "absolute", left: px - RING / 2, top: py - RING / 2, width: RING, height: RING, borderRadius: RING / 2, borderWidth: 2, alignItems: "center", justifyContent: "center", borderColor: "#9CC0FF", backgroundColor: "rgba(36,91,204,0.3)" }}>
        <Text style={{ ...type.caption, fontWeight: "700", color: palette.white, fontVariant: ["tabular-nums"] }}>{m.n}</Text>
      </View>; })}
  </View>;
}
/** The film with its findings ringed, dark while it loads (its title in place of the film), one line when it cannot be shown; tapping opens the visit's imaging screen. */
function Film({ reference, style }: { reference: Reference; style: { flex: number } | { height: number } }) {
  const film = useFilm(reference.encounterId);
  const markers = film && film !== "failed" ? film.markers : [];
  const open = () => router.push({ pathname: "/xray", params: { encounterId: reference.encounterId } });
  return <Pressable accessibilityRole="imagebutton" accessibilityLabel={`${reference.title}${markers.length ? `, ${markers.length} findings marked` : ""}`} accessibilityHint="Opens the visit's imaging" onPress={open} style={[VIEWING, style]}>{({ pressed }) => <PressScale pressed={pressed} scale={0.98} style={{ flex: 1 }}>
    {film === "failed" ? <Text style={{ ...type.footnote, color: palette.line, margin: 12 }}>Film not available</Text>
      : !film ? <Text numberOfLines={2} style={{ ...type.footnote, color: palette.line, margin: 12 }}>{reference.title}</Text>
      : <RingedFilm film={film} />}
    <ImageEdge />
  </PressScale>}</Pressable>;
}

/** The film as the answer's lead: its title, the film with its findings ringed, and the reading in two lines that open on a tap. */
function FilmLead({ reference }: { reference: Reference }) {
  const [more, setMore] = useState(false);
  return <View style={{ gap: 8 }}>
    <Text style={{ ...type.subhead, fontWeight: "700", color: palette.ink }}>{reference.title}</Text>
    <Film reference={reference} style={{ height: 220 }} />
    <Text selectable numberOfLines={more ? undefined : 2} onPress={() => setMore(m => !m)} accessibilityRole="button" accessibilityState={{ expanded: more }} accessibilityHint={more ? "Shows less of the reading" : "Shows the whole reading"} style={{ ...type.footnote, color: palette.muted }}>{reference.text}</Text>
  </View>;
}

const R = 34, C = 2 * Math.PI * R, SWEEP = 0.75;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** CURB-65: the arc sweeps as each factor is checked, then the score settles in the middle. */
function Severity({ patient, server }: { patient: FeatureProps["patient"]; server?: ServerEvidence["curb65"] }) {
  const { reducedMotion } = useAccessibleEffects();
  // Live: the server's score from recorded readings (each factor citing its source); otherwise the app's chart fixture.
  const { factors, score, recorded, risk } = server ?? curb65(patient);
  const [checked, setChecked] = useState(reducedMotion ? factors.length : 0);
  const p = useSharedValue(reducedMotion ? recorded / factors.length : 0);
  // The sweep waits until the card is on screen, so it is seen rather than played below the fold.
  const ref = useRef<View>(null);
  const seen = useSeenOnce(ref, reducedMotion);
  useEffect(() => {
    if (reducedMotion || !seen) return;
    p.set(withDelay(200, withTiming(recorded / factors.length, { duration: 900, easing: EASE_OUT })));
    const timers = factors.map((_, i) => setTimeout(() => setChecked(i + 1), 200 + (i + 1) * 180));
    return () => timers.forEach(clearTimeout);
  }, [reducedMotion, seen, p, recorded, factors.length]);
  const arc = useAnimatedProps(() => ({ strokeDashoffset: C * (1 - SWEEP * p.value) }));
  const done = checked >= factors.length;
  const tone = !risk ? palette.amber : score <= 1 ? TEAL : score === 2 ? palette.amber : palette.red;

  return <View ref={ref} collapsable={false}><Surface style={{ padding: 16, gap: 14 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
      <View style={{ width: 84, height: 84, alignItems: "center", justifyContent: "center" }}>
        <Svg width={84} height={84} style={{ position: "absolute", transform: [{ rotate: "135deg" }] }}>
          <Circle cx={42} cy={42} r={R} stroke="rgba(20,28,40,0.08)" strokeWidth={7} fill="none" strokeLinecap="round" strokeDasharray={`${C * SWEEP} ${C}`} />
          <AnimatedCircle cx={42} cy={42} r={R} stroke={tone} strokeWidth={7} fill="none" strokeLinecap="round" strokeDasharray={`${C} ${C}`} animatedProps={arc} />
        </Svg>
        {done ? <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(200)} style={{ alignItems: "center" }}>
          <Text style={{ fontSize: 24 /* score numeral, between title and display */, fontWeight: "700", color: palette.ink, fontVariant: ["tabular-nums"] }}>{risk ? score : "?"}</Text>
          <Text style={{ ...type.caption, color: palette.muted }}>of 5</Text>
        </Animated.View> : <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted, fontVariant: ["tabular-nums"] }}>{checked}/5</Text>}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.overline, color: palette.muted }}>CURB-65 · severity</Text>
        <Text style={{ ...type.subhead, fontWeight: "700", color: done ? tone : palette.muted }}>{done ? (risk ?? `${recorded} of 5 recorded · can't score yet`) : "Checking the chart…"}</Text>
        <Text style={{ ...type.caption, color: palette.muted }}>{risk ? "So the non-severe evidence applies." : "Record the missing factors to score."}</Text>
      </View>
    </View>
    <View>
      {factors.map((f, i) => { const shown = i < checked; return <View key={f.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 36, borderTopWidth: 1, borderColor: "rgba(20,28,40,0.06)", opacity: shown ? 1 : 0.35 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink }}>{f.label}{f.value ? ` · ${f.value}` : ""}</Text>
          <Text style={{ ...type.caption, color: palette.muted }}>Point if {f.rule}</Text>
        </View>
        {shown && <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(160)} style={{ height: 22, paddingHorizontal: 8, borderRadius: 11, justifyContent: "center", backgroundColor: f.point === undefined ? "rgba(196,120,20,0.12)" : f.point ? "rgba(162,62,62,0.1)" : "rgba(15,110,102,0.1)" }}>
          <Text style={{ ...type.caption, fontWeight: "700", color: f.point === undefined ? palette.amber : f.point ? palette.red : TEAL }}>{f.point === undefined ? "Not recorded" : f.point ? "+1" : "0"}</Text>
        </Animated.View>}
      </View>; })}
    </View>
  </Surface></View>;
}

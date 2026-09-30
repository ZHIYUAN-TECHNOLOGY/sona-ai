import * as WebBrowser from "expo-web-browser";
import { QuestionList } from "@/components/sona/list";
import { MarkedText, TINT, segments, type Mark } from "@/components/sona/marked-text";
import { useEffect, useRef, useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { FadeIn, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { SampleLabel } from "@/components/sona/model-answer";
import { EASE_OUT } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Icon, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { useSeenOnce } from "@/components/sona/use-visible";
import { haptic } from "@/features/clinical/medication-parts";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { threadBefore, useLiveEvidence, type ServerEvidence } from "@/features/live/evidence-sync";
import { authoredAnswer, authoredReferences, curb65, type Claim, type Reference } from "./model";

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
const DESIGN_WORDS: Record<Reference["design"], string> = { Guideline: "guideline", Review: "systematic review", Trial: "randomised trial", "Narrative review": "narrative review", Study: "study", Library: "your library" };
const NOT_ENOUGH = "Not enough evidence found to answer this. Sona only says what a source supports.";

type Shown = { claims: Claim[]; enough: boolean; followUps: string[]; references: Reference[]; source?: string; note: string };

export function EvidenceCard({ patient, result, onRequest }: FeatureProps) {
  // Live mode asks the server; otherwise the authored answers show, for the rehearsed question and its follow-ups only.
  const { encounters } = useEncounter();
  const requests = encounters[patient.id]?.requests ?? [];
  const question = requests.find(r => r.id === result?.requestId)?.prompt || REHEARSED_QUESTION;
  const { live, data, error } = useLiveEvidence(patient.encounterId, result?.requestId, question, threadBefore(requests, result?.requestId));
  const [focus, setFocus] = useState<{ n: number; at: number }>();
  if (live && !data) return <Surface feature style={{ padding: 16, gap: 8 }}>
    <Text style={{ ...type.subhead, color: error ? palette.red : palette.muted }}>{error ?? "Searching PubMed and your library, checking the chart…"}</Text>
  </Surface>;
  const authored = data ? undefined : authoredAnswer(question);
  const shown: Shown | undefined = data
    ? { ...data, note: data.source === "cached" && data.references.some(r => r.kind === "study") ? `${data.pubmed === "live" ? "PubMed records" : "PubMed, saved copy"} · reviewed summaries` : data.references.some(r => r.kind === "library") && data.pubmed !== "live" ? "Your library · PubMed unreachable" : SOURCES_NOTE[data.pubmed] }
    : authored && { ...authored, enough: true, references: authoredReferences(), source: undefined, note: "Authored summaries · links open PubMed" };
  const caption = !shown ? "" : !data ? "Rehearsed answer" : data.source === "cached" ? "Rehearsed answer" : data.source === "fixture" ? "Sample: not a model's reading" : `Written by ${data.source}`;
  const cite = (n: number) => { haptic("select"); setFocus({ n, at: Date.now() }); };

  return <View style={{ gap: 14 }}>
    <Surface feature style={{ padding: 16, gap: 12 }}>
      {!shown ? <Text style={{ ...type.callout, color: palette.muted }}>Live mode answers this question from PubMed and your library. Switch it on in Settings.</Text>
        : shown.enough ? shown.claims.map((c, i) => <ClaimLine key={i} claim={c} references={shown.references} onCite={cite} />)
        : <Text selectable style={{ ...type.callout, color: palette.amber }}>{NOT_ENOUGH}</Text>}
      {shown && <View style={{ gap: 4 }}>
        <SampleLabel source={data?.source} what="evidence" />
        <Text selectable style={{ ...type.caption, color: palette.muted }}>{caption}</Text>
      </View>}
    </Surface>
    {shown && shown.references.length > 0 && <Sources references={shown.references} note={shown.note} focus={focus} />}
    {data && !data.references.length && <Text selectable style={{ ...type.footnote, color: palette.amber }}>{data.pubmed === "unavailable" ? SOURCES_NOTE.unavailable : "Nothing on this in PubMed or your library"}</Text>}
    <Severity patient={patient} server={data?.curb65} />
    <QuestionList title="Related" questions={shown?.followUps.map(q => ({ key: q, text: q })) ?? []} onAsk={q => onRequest("evidence", q)} />
  </View>;
}

/**
 * One claim laid out word by word so its citation pills are real rounded pills that wrap with the
 * last words. Key terms keep their tint. VoiceOver reads the claim once, then each citation.
 */
function ClaimLine({ claim, references, onCite }: { claim: Claim; references: Reference[]; onCite: (n: number) => void }) {
  // Words with their tint, and whether a space follows: punctuation after a tinted term ("pneumonia;") stays attached.
  const words: { word: string; mark?: Mark; space: boolean }[] = [];
  for (const seg of segments(claim.text)) {
    if (/^\s/.test(seg.text) && words.length) words[words.length - 1]!.space = true;
    for (const m of seg.text.matchAll(/(\S+)(\s*)/g)) words.push({ word: m[1]!, mark: seg.mark, space: m[2]!.length > 0 });
  }
  return <View>
    <Text accessible accessibilityLabel={claim.text} style={{ position: "absolute", opacity: 0 }}>{claim.text}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: 2 }}>
      {words.map((w, i) => <Text key={i} accessible={false} style={{ ...type.callout, color: palette.ink }}>{w.mark ? <Text style={{ ...TINT[w.mark], fontWeight: "500" }}>{w.word}</Text> : w.word}{w.space ? " " : ""}</Text>)}
      {claim.cites.map(n => { const r = references.find(x => x.n === n);
        return <Pressable key={n} accessibilityRole="button" accessibilityLabel={`Source ${n}${r ? `, ${DESIGN_WORDS[r.design]}, ${[r.from, r.year].filter(Boolean).join(" ")}` : ""}`} accessibilityHint="Shows this source below"
          hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }} onPress={() => onCite(n)}
          style={({ pressed }) => ({ marginLeft: 4, minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(36,91,204,0.12)", transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
          <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue, fontVariant: ["tabular-nums"] }}>{n}</Text>
        </Pressable>; })}
    </View>
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
          <Text style={{ fontSize: 11, fontWeight: "700", color: chip.fg }}>{source.design}</Text>
        </View>
        <Text numberOfLines={1} style={{ ...type.caption, flex: 1, color: palette.muted, fontVariant: ["tabular-nums"] }}>{source.year}{source.from ? ` · ${source.from}` : ""}</Text>
      </View>
      <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "700", color: palette.ink }}>{source.title}</Text>
      <MarkedText selectable={false} text={source.text} style={{ ...type.footnote, flex: 1, color: palette.ink }} />
      {source.url ? <Pressable accessibilityRole="link" accessibilityLabel={`Open the PubMed abstract for ${source.title}`} hitSlop={8} onPress={() => { void WebBrowser.openBrowserAsync(source.url!).catch(() => {}); }} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>Open abstract</Text>
        <Icon name="arrow.up.right" size={10} color={palette.blue} />
      </Pressable> : source.section ? <Text numberOfLines={1} style={{ ...type.footnote, fontWeight: "600", color: TEAL }}>{source.section}</Text> : null}
    </Surface>
    <Animated.View pointerEvents="none" style={[{ position: "absolute", inset: 0, borderRadius: radius.group, borderWidth: 2, borderColor: palette.blue, backgroundColor: "rgba(36,91,204,0.06)" }, ring]} />
  </Animated.View>;
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
          <Text style={{ fontSize: 24, fontWeight: "700", color: palette.ink, fontVariant: ["tabular-nums"] }}>{risk ? score : "?"}</Text>
          <Text style={{ fontSize: 11, color: palette.muted }}>of 5</Text>
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
          <Text style={{ fontSize: 11, fontWeight: "700", color: f.point === undefined ? palette.amber : f.point ? palette.red : TEAL }}>{f.point === undefined ? "Not recorded" : f.point ? "+1" : "0"}</Text>
        </Animated.View>}
      </View>; })}
    </View>
  </Surface></View>;
}

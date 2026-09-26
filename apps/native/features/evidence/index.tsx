import * as WebBrowser from "expo-web-browser";
import { MarkedText } from "@/components/sona/marked-text";
import { useEffect, useRef, useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { FadeIn, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { EASE_OUT } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Icon, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { useSeenOnce } from "@/components/sona/use-visible";
import { haptic } from "@/features/clinical/medication-parts";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { useLiveEvidence, type ServerEvidence } from "@/features/live/evidence-sync";
import { ANSWER, GRADE, STUDIES, curb65, pubmedUrl, type Study } from "./model";

/*
 * Evidence answer. The studies sit in a swipeable row synced to a small track above it (after
 * Monogram's rich-response carousel): the row follows the finger, and on release it snaps on a
 * spring (0.36 s, damping 0.82) to the next card past 55 pt or a 260 pt/s flick, while the track's
 * pill glides to the matching year. Cards off-centre shrink to 0.93 and dim. The severity score
 * then fills like 1Password's Watchtower meter: the arc sweeps on an ease-out as each factor is
 * checked, and the score settles in the middle.
 */
const TEAL = "#0F6E66";
const SNAP = { duration: 360, dampingRatio: 0.82 }, TAP = { duration: 380, dampingRatio: 0.82 };

/** The rehearsed demo question, for an answer opened without its prompt. */
const REHEARSED_QUESTION = "Steroids for this patient with community-acquired pneumonia?";
const SOURCES_NOTE: Record<ServerEvidence["pubmed"], string> = { live: "PubMed · conclusions quoted from each abstract", cached: "PubMed, saved copy · offline now", unavailable: "PubMed unreachable · no sources" };

export function EvidenceCard({ patient, result }: FeatureProps) {
  // Live mode asks the server; the authored answer shows otherwise. While the server answers, nothing authored is shown in its place.
  const { encounters } = useEncounter();
  const question = encounters[patient.id]?.requests.find(r => r.id === result?.requestId)?.prompt || REHEARSED_QUESTION;
  const { live, data, error } = useLiveEvidence(patient.encounterId, result?.requestId, question);
  if (live && !data) return <Surface feature style={{ padding: 16, gap: 8 }}>
    <Text style={{ ...type.subhead, color: error ? palette.red : palette.muted }}>{error ?? "Searching PubMed and checking the chart…"}</Text>
  </Surface>;
  const grade = data ? data.grade : { ...GRADE, rule: undefined };
  const answer = data ? data.answer : ANSWER;
  const studies: Study[] = data ? data.studies : STUDIES;
  const note = !data ? "Authored summaries · links open PubMed" : data.source === "cached" && data.studies.length ? `${data.pubmed === "live" ? "PubMed records" : "PubMed, saved copy"} · reviewed summaries` : SOURCES_NOTE[data.pubmed];
  return <View style={{ gap: 14 }}>
    <Surface feature style={{ padding: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <View style={{ height: 24, paddingHorizontal: 10, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(15,110,102,0.1)" }}>
          <Icon name="checkmark.seal.fill" size={11} color={TEAL} />
          <Text style={{ fontSize: 12, fontWeight: "700", color: TEAL }}>{grade.certainty}</Text>
        </View>
        {grade.direction && <Text style={{ ...type.subhead, fontWeight: "700", color: palette.ink }}>{grade.direction}</Text>}
        {grade.scope && <Text style={{ ...type.caption, color: palette.muted }}>in {grade.scope}</Text>}
      </View>
      {answer.map((line, i) => <View key={i} style={{ flexDirection: "row", gap: 10 }}>
        <Text style={{ ...type.footnote, fontWeight: "700", color: palette.blue, width: 12 }}>{i + 1}</Text>
        <MarkedText text={line} style={{ ...type.subhead, flex: 1, color: palette.ink }} />
      </View>)}
      {data && <Text selectable style={{ ...type.caption, color: palette.muted }}>{data.source === "cached" ? "Rehearsed answer, cached" : "Sample synthesis · no model has checked these sources for relevance yet"}{grade.rule ? ` · certainty by rule: ${grade.rule.toLowerCase()}` : ""}</Text>}
    </Surface>
    {studies.length > 0 && <Studies studies={studies} note={note} />}
    {data && !studies.length && <Text selectable style={{ ...type.footnote, color: palette.amber }}>{note}</Text>}
    <Severity patient={patient} server={data?.curb65} />
  </View>;
}

function Studies({ studies: STUDIES, note }: { studies: Study[]; note: string }) {
  const { width } = useWindowDimensions();
  const { reducedMotion } = useAccessibleEffects();
  const area = width - 40, cardW = Math.round(area * 0.84), step = cardW + 12, last = STUDIES.length - 1;
  const pos = useSharedValue(0), start = useSharedValue(0);
  const [active, setActive] = useState(0);
  const land = (i: number) => { setActive(i); haptic("select"); };
  const go = (i: number) => { pos.set(reducedMotion ? i : withSpring(i, TAP)); land(i); };
  const pan = Gesture.Pan().activeOffsetX([-10, 10]).failOffsetY([-12, 12])
    .onStart(() => { start.set(pos.value); })
    .onUpdate(e => { pos.set(Math.min(last + 0.15, Math.max(-0.15, start.value - e.translationX / step))); })
    .onEnd(e => {
      const from = Math.round(start.value);
      const target = e.translationX < -55 || e.velocityX < -260 ? Math.min(last, from + 1) : e.translationX > 55 || e.velocityX > 260 ? Math.max(0, from - 1) : from;
      pos.set(withSpring(target, { ...SNAP, velocity: -e.velocityX / step }));
      if (target !== from) scheduleOnRN(land, target);
    });

  return <View style={{ gap: 12 }} accessibilityLabel={`${STUDIES.length} sources`}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ ...type.overline, color: palette.muted }}>Sources · swipe</Text>
      <Text style={{ ...type.caption, color: palette.muted }}>{note}</Text>
    </View>
    <Track studies={STUDIES} pos={pos} active={active} onPick={go} />
    <GestureDetector gesture={pan}>
      <View style={{ height: 196, marginHorizontal: -20, overflow: "hidden" }}>
        {STUDIES.map((s, i) => <StudyCard key={s.id} study={s} index={i} pos={pos} left={20 + (area - cardW) / 2} width={cardW} step={step} />)}
      </View>
    </GestureDetector>
  </View>;
}

/** The track above the row: one node per study, a pill that glides with the row's position. */
function Track({ studies: STUDIES, pos, active, onPick }: { studies: Study[]; pos: SharedValue<number>; active: number; onPick: (i: number) => void }) {
  const [w, setW] = useState(0);
  const gap = STUDIES.length > 1 ? w / (STUDIES.length - 1) : 0;
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: Math.min(STUDIES.length - 1, Math.max(0, pos.value)) * gap - 12 }] }));
  return <View style={{ paddingHorizontal: 28, gap: 6 }}>
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height: 24, justifyContent: "center" }}>
      <View style={{ height: 1.5, backgroundColor: "rgba(20,28,40,0.1)" }} />
      {STUDIES.map((s, i) => <Pressable key={s.id} accessibilityRole="button" accessibilityState={{ selected: active === i }} accessibilityLabel={`${s.kind} ${s.year}`} hitSlop={10} onPress={() => onPick(i)}
        style={{ position: "absolute", left: i * gap - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: "rgba(20,28,40,0.14)" }} />)}
      <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: palette.white, boxShadow: "0 1px 4px rgba(20,28,40,0.14)" }, pill]}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: palette.blue }} />
      </Animated.View>
    </View>
    <View style={{ height: 16 }}>
      {STUDIES.map((s, i) => { const edge = i === 0 ? "left" : i === STUDIES.length - 1 ? "right" : "center";
        return <Text key={s.id} style={{ position: "absolute", left: edge === "left" ? -12 : edge === "right" ? i * gap - 68 : i * gap - 40, width: 80, textAlign: edge, fontSize: 12, fontWeight: active === i ? "700" : "500", color: active === i ? palette.ink : palette.muted, fontVariant: ["tabular-nums"] }}>{s.year}</Text>; })}
    </View>
  </View>;
}

function StudyCard({ study, index, pos, left, width, step }: { study: Study; index: number; pos: SharedValue<number>; left: number; width: number; step: number }) {
  const style = useAnimatedStyle(() => {
    const d = Math.abs(index - pos.value);
    return { opacity: Math.max(0.55, 1 - d * 0.35), zIndex: Math.round(10 - d), transform: [{ translateX: (index - pos.value) * step }, { scale: Math.max(0.93, 1 - d * 0.07) }] };
  });
  return <Animated.View style={[{ position: "absolute", top: 4, left, width }, style]}>
    <Surface style={{ padding: 16, gap: 8, height: 186, borderRadius: 22 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ height: 22, paddingHorizontal: 8, borderRadius: 11, justifyContent: "center", backgroundColor: study.kind === "Guideline" ? "rgba(36,91,204,0.1)" : "rgba(20,28,40,0.06)" }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: study.kind === "Guideline" ? palette.blue : palette.ink }}>{study.kind}</Text>
        </View>
        <Text numberOfLines={1} style={{ ...type.caption, flex: 1, color: palette.muted, fontVariant: ["tabular-nums"] }}>{study.year}{study.journal ? ` · ${study.journal}` : ""}</Text>
      </View>
      <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "700", color: palette.ink }}>{study.title}</Text>
      <MarkedText selectable={false} text={study.finding} style={{ ...type.footnote, flex: 1, color: palette.ink }} />
      <Pressable accessibilityRole="link" accessibilityLabel={`Open the PubMed abstract for ${study.title}`} hitSlop={8} onPress={() => { void WebBrowser.openBrowserAsync(pubmedUrl(study)).catch(() => {}); }} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>Open abstract</Text>
        <Icon name="arrow.up.right" size={10} color={palette.blue} />
      </Pressable>
    </Surface>
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
        </Animated.View> : <Text style={{ fontSize: 13, fontWeight: "600", color: palette.muted, fontVariant: ["tabular-nums"] }}>{checked}/5</Text>}
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

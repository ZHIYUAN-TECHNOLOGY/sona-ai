import * as Haptics from "expo-haptics";
import { MarkedText } from "@/components/sona/marked-text";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, TextInput, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, FadeIn, FadeOut, ZoomIn, cancelAnimation, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { riseIn } from "@/components/sona/motion";
import { SourcesPill } from "@/components/sona/sources";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { ErrorLine } from "@/components/sona/parts";
import { Icon, useAccessibleEffects } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import { useFindings } from "@/features/live/findings-sync";
import { errorText } from "@/features/live";
import { useLiveHandover } from "@/features/live/handover-sync";
import { LockedAction, useRole } from "@/features/live/roles";
import { buildHandover, type HandoverCard } from "./model";

/*
 * Shift handover (after Slack's swipe-to-triage cards): one SBAR card per patient on a stack.
 * Drag right to hand over, left to flag for a verbal discussion; the card tilts with the drag
 * (x / 16 degrees), tints toward the decision, and past 110 pt or a quick flick flies off on a
 * spring (0.38 s, damping 0.72) while the next card scales up from 0.95. Buttons do the same.
 * The receiving clinician then holds "Accept handover" (1.5 s, linear fill; release early and it
 * springs back in 0.2 s) and an acknowledged receipt stamps in.
 */
type Decision = "handed" | "discuss";
const TINT: Record<Decision, { fill: string; label: string; icon: string }> = {
  handed: { fill: "#0F6E66", label: "Handed over", icon: "checkmark.circle.fill" },
  discuss: { fill: "#8B5518", label: "Discuss verbally", icon: "bubble.left.and.bubble.right.fill" },
};
const FLY = { duration: 380, dampingRatio: 0.72 }, BACK = { duration: 350, dampingRatio: 0.72 };
const haptic = (kind: "select" | "light" | "success" = "select") => {
  if (process.env.EXPO_OS !== "ios") return;
  (kind === "success" ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : kind === "light" ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) : Haptics.selectionAsync()).catch(() => {});
};

function Line({ tag, children }: { tag: string; children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", gap: 10 }}>
    <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: "rgba(36,91,204,0.1)", alignItems: "center", justifyContent: "center", marginTop: 1 }}><Text style={{ fontSize: 11, fontWeight: "700", color: palette.blue }}>{tag}</Text></View>
    <View style={{ flex: 1 }}>{children}</View>
  </View>;
}

function Card({ card }: { card: HandoverCard }) {
  const sources = card.patientId ? card.sources.map(id => ({ id, label: { history: "Intake & history", vitals: "Observations", consultation: "Consultation transcript" }[id] ?? id, kind: "record" as const, onPress: () => router.push({ pathname: "/source", params: { id, patientId: card.patientId! } }) })) : [];
  return <View style={{ flex: 1, borderRadius: 28, borderCurve: "continuous", backgroundColor: palette.white, borderWidth: 1, borderColor: "rgba(20,28,40,0.06)", boxShadow: "0 10px 30px rgba(24,32,48,0.10)", padding: 18, gap: 14 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{card.name}</Text>
        <Text style={{ ...type.footnote, color: palette.muted }}>{card.meta}</Text>
      </View>
      <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, backgroundColor: card.priority === "watch" ? "rgba(196,120,20,0.14)" : "rgba(20,140,130,0.12)" }}>
        <Text style={{ ...type.caption, fontWeight: "700", color: card.priority === "watch" ? palette.amber : "#0F6E66" }}>{card.priority === "watch" ? "Watch" : "Stable"}</Text>
      </View>
    </View>
    <View style={{ height: 1, backgroundColor: "rgba(20,28,40,0.06)" }} />
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
      <Line tag="S"><MarkedText text={card.situation} style={{ ...type.callout, color: palette.ink }} /></Line>
      <Line tag="B"><MarkedText text={card.background} style={{ ...type.callout, color: palette.muted }} /></Line>
      <Line tag="A"><MarkedText text={card.assessment} style={{ ...type.callout, color: palette.muted }} /></Line>
      <Line tag="R"><View style={{ gap: 6 }}>{card.recommendation.map(item => <View key={item} style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ width: 5, height: 5, borderRadius: 3, marginTop: 8, backgroundColor: palette.amber }} />
        <MarkedText text={item} style={{ flex: 1, ...type.callout, fontWeight: "500", color: palette.ink }} />
      </View>)}</View></Line>
    </ScrollView>
    {sources.length > 0 && <View style={{ alignItems: "flex-end" }}><SourcesPill sources={sources} /></View>}
  </View>;
}

function HoldToAccept({ onDone }: { onDone: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const fill = useSharedValue(0);
  const hold = Gesture.LongPress().minDuration(1500).maxDistance(40)
    .onBegin(() => { fill.set(withTiming(1, { duration: 1500, easing: Easing.linear })); })
    .onStart(() => { scheduleOnRN(onDone); })
    .onFinalize((_e, success) => { if (!success) { cancelAnimation(fill); fill.set(withTiming(0, { duration: 200, easing: Easing.bezier(0.23, 1, 0.32, 1) })); } });
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.value }] }));
  const press = useAnimatedStyle(() => ({ transform: [{ scale: reducedMotion ? 1 : interpolate(fill.value, [0, 0.05, 1], [1, 0.97, 0.97]) }] }));
  return <GestureDetector gesture={hold}>
    <Animated.View accessible accessibilityRole="button" accessibilityLabel="Accept handover" accessibilityHint="Press and hold to accept responsibility" accessibilityActions={[{ name: "activate" }]} onAccessibilityAction={onDone}
      style={[{ height: 56, borderRadius: 28, overflow: "hidden", backgroundColor: palette.ink, justifyContent: "center", alignItems: "center" }, press]}>
      <Animated.View style={[{ position: "absolute", left: 0, top: 0, bottom: 0, right: 0, backgroundColor: "#0F6E66", transformOrigin: "left" }, bar]} />
      <Text style={{ fontSize: 16, fontWeight: "600", color: palette.white }}>Hold to accept handover</Text>
    </Animated.View>
  </GestureDetector>;
}

export function HandoverScreen() {
  const { patients, encounters } = useEncounter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibleEffects();
  const { findings } = useFindings();
  const [fixtureCards] = useState(() => buildHandover(patients, encounters, findings));
  // Live backend mode: the server's cards, and the acceptance is written there.
  const server = useLiveHandover();
  const role = useRole();
  const cards = server.live ? server.cards ?? [] : fixtureCards;
  const [done, setDone] = useState<{ id: string; decision: Decision }[]>([]);
  const [receiver, setReceiver] = useState("Dr Lim · night registrar");
  const [accepted, setAccepted] = useState<string>();
  const [acceptError, setAcceptError] = useState<string>();
  const remaining = cards.filter(card => !done.some(d => d.id === card.id));
  const [top, next] = remaining;
  const x = useSharedValue(0), y = useSharedValue(0), busy = useSharedValue(false);

  const settle = (decision: Decision) => {
    if (!top) return;
    haptic("light");
    setDone(list => [...list, { id: top.id, decision }]);
    x.set(0); y.set(0); busy.set(false);
  };
  const fly = (decision: Decision) => {
    "worklet";
    if (busy.value) return;
    busy.set(true);
    const to = decision === "handed" ? width * 1.3 : -width * 1.3;
    x.set(withSpring(to, FLY, finished => { if (finished) scheduleOnRN(settle, decision); }));
    y.set(withSpring(y.value + 20, FLY));
  };
  const decide = (decision: Decision) => { if (reducedMotion) { settle(decision); return; } fly(decision); };
  const pan = Gesture.Pan().enabled(Boolean(top)).onUpdate(e => { if (busy.value) return; x.set(e.translationX); y.set(e.translationY * 0.3); })
    .onEnd(e => {
      if (busy.value) return;
      if (e.translationX > 110 || e.velocityX > 350) fly("handed");
      else if (e.translationX < -110 || e.velocityX < -350) fly("discuss");
      else { x.set(withSpring(0, BACK)); y.set(withSpring(0, BACK)); }
    });
  const topStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { rotate: `${x.value / 16}deg` }] }));
  const handedTint = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [20, 110], [0, 0.92], "clamp") }));
  const discussTint = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-110, -20], [0.92, 0], "clamp") }));
  const nextStyle = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(Math.abs(x.value), [0, 200], [10, 0], "clamp") }, { scale: interpolate(Math.abs(x.value), [0, 200], [0.95, 1], "clamp") }] }));
  const undo = () => { haptic(); setDone(list => list.slice(0, -1)); };
  const handed = done.filter(d => d.decision === "handed").length;
  const clock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const accept = () => {
    if (!server.live) { haptic("success"); setAccepted(clock(new Date())); return; }
    // A refusal shows under the hold button with Retry; nothing is stamped until the server accepts.
    setAcceptError(undefined);
    server.accept(cards.map(c => c.id), receiver).then(at => { haptic("success"); setAccepted(clock(at)); }, e => setAcceptError(`Not accepted: ${errorText(e)}`));
  };

  // Live: not readable for this role, still loading, failed, or nothing to hand over. One calm line each.
  const blocked = server.live && !role.can("handover.list") ? role.why("handover.list") : undefined;
  if (server.live && (blocked || !server.cards || !server.cards.length)) return <View style={{ flex: 1, backgroundColor: palette.canvas, paddingTop: insets.top + 56, paddingHorizontal: 20, gap: 12 }}>
    <Stack.Screen options={{ title: "Shift handover" }} />
    {blocked ? <Text accessibilityLiveRegion="polite" style={{ ...type.callout, color: palette.muted }}>{blocked}</Text>
      : server.error ? <ErrorLine text={`The handover didn't load: ${server.error}`} onRetry={server.retry} />
      : !server.cards ? <Text accessibilityLiveRegion="polite" style={{ ...type.callout, color: palette.muted }}>Loading the handover…</Text>
      : <Animated.View entering={reducedMotion ? FadeIn : riseIn({ distance: 12, duration: 380 })} style={{ borderRadius: 28, borderCurve: "continuous", backgroundColor: palette.white, padding: 20, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Icon name="checkmark.circle.fill" size={18} color="#0F6E66" /><Text style={{ ...type.heading, color: palette.ink }}>Nothing to hand over</Text></View>
        <Text style={{ ...type.callout, color: palette.muted }}>No patients on your list this shift. New admissions and results will appear here.</Text>
      </Animated.View>}
  </View>;
  const discuss = done.filter(d => d.decision === "discuss");

  return <View style={{ flex: 1, backgroundColor: palette.canvas, paddingTop: insets.top + 56, paddingBottom: Math.max(insets.bottom, 16), paddingHorizontal: 20, gap: 14 }}>
    <Stack.Screen options={{ title: "Shift handover" }} />
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 34 }}>
      <Text accessibilityLiveRegion="polite" style={{ ...type.headline, color: palette.ink, fontVariant: ["tabular-nums"] }}>{top ? `${remaining.length} of ${cards.length} left` : "All patients reviewed"}</Text>
      {done.length > 0 && !accepted && <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Undo last decision" onPress={undo} hitSlop={8} style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, borderRadius: 16, backgroundColor: "rgba(36,91,204,0.1)" }}>
          <Icon name="arrow.uturn.backward" size={11} color={palette.blue} /><Text style={{ fontSize: 13, fontWeight: "600", color: palette.blue }}>Undo</Text>
        </Pressable>
      </Animated.View>}
    </View>

    {top ? <>
      <View style={{ flex: 1 }}>
        {next && <Animated.View key={`n-${next.id}`} pointerEvents="none" style={[{ position: "absolute", inset: 0 }, reducedMotion ? { transform: [{ scale: 0.95 }] } : nextStyle]}><Card card={next} /></Animated.View>}
        <GestureDetector gesture={pan}>
          <Animated.View key={top.id} entering={reducedMotion ? FadeIn.duration(150) : undefined} style={[{ position: "absolute", inset: 0 }, topStyle]}>
            <Card card={top} />
            {(["handed", "discuss"] as const).map(decision => <Animated.View key={decision} pointerEvents="none"
              style={[{ position: "absolute", inset: 0, borderRadius: 28, borderCurve: "continuous", backgroundColor: TINT[decision].fill, alignItems: "center", justifyContent: "center", gap: 10 }, decision === "handed" ? handedTint : discussTint]}>
              <Icon name={TINT[decision].icon} size={48} color={palette.white} />
              <Text style={{ fontSize: 18, fontWeight: "700", color: palette.white }}>{TINT[decision].label}</Text>
            </Animated.View>)}
          </Animated.View>
        </GestureDetector>
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Discuss ${top.name} verbally`} onPress={() => decide("discuss")} style={({ pressed }) => ({ flex: 1, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: palette.white, borderWidth: 1, borderColor: "rgba(20,28,40,0.1)", opacity: pressed ? 0.8 : 1 })}>
          <Text style={{ fontSize: 16, fontWeight: "600", color: palette.ink }}>Discuss</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Hand over ${top.name}`} onPress={() => decide("handed")} style={({ pressed }) => ({ flex: 1.4, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: palette.ink, transform: [{ scale: pressed && !reducedMotion ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
          <Text style={{ fontSize: 16, fontWeight: "600", color: palette.white }}>Hand over</Text>
        </Pressable>
      </View>
    </> : <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 20 }}>
      <Animated.View entering={reducedMotion ? FadeIn : riseIn({ distance: 12, duration: 380 })} style={{ borderRadius: 28, borderCurve: "continuous", backgroundColor: palette.white, padding: 20, gap: 12, boxShadow: "0 10px 30px rgba(24,32,48,0.08)" }}>
        <Text style={{ ...type.heading, color: palette.ink }}>{handed} handed over{discuss.length ? ` · ${discuss.length} to discuss` : ""}</Text>
        {discuss.length > 0 && <Text style={{ ...type.callout, color: palette.muted }}>Talk through: {discuss.map(d => cards.find(c => c.id === d.id)?.name).join(", ")}</Text>}
        <View style={{ gap: 6 }}>
          <Text style={{ ...type.overline, color: palette.muted }}>Receiving clinician</Text>
          <TextInput value={receiver} onChangeText={setReceiver} editable={!accepted} accessibilityLabel="Receiving clinician" style={{ minHeight: 48, borderRadius: 14, paddingHorizontal: 14, fontSize: 16, color: palette.ink, backgroundColor: "rgba(20,28,40,0.05)" }} />
        </View>
      </Animated.View>
      {accepted ? <Animated.View entering={reducedMotion ? FadeIn : ZoomIn.springify().duration(420).dampingRatio(0.72)} accessibilityLiveRegion="polite"
        style={{ borderRadius: 28, borderCurve: "continuous", backgroundColor: "#0F6E66", padding: 20, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><Icon name="checkmark.seal.fill" size={26} color={palette.white} /><Text style={{ ...type.heading, color: palette.white }}>Handover acknowledged</Text></View>
        <Text style={{ ...type.callout, color: "rgba(255,255,255,0.9)" }}>{receiver} accepted {cards.length} patients at {accepted}. Each patient’s open items are on their card.</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={{ alignSelf: "flex-start", marginTop: 6, minHeight: 40, paddingHorizontal: 16, borderRadius: 20, justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: palette.white }}>Done</Text>
        </Pressable>
      </Animated.View> : server.live && !role.can("handover.accept") ? <LockedAction label="Needs a doctor or a nurse to accept" path="handover.accept" height={56} /> : <HoldToAccept onDone={accept} />}
      {acceptError && !accepted && <ErrorLine text={acceptError} onRetry={accept} />}
      <Text style={{ ...type.caption, color: palette.muted }}>{server.live ? "Clinic patients from the server’s records." : "Clinic patients come from today’s visits; ward patients are examples without a record to open."}</Text>
    </ScrollView>}
  </View>;
}

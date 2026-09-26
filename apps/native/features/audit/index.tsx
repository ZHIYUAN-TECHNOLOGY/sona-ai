import { useEffect, useRef, useState } from "react";
import { MarkedText } from "@/components/sona/marked-text";
import { Pressable, ScrollView, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { FadeIn, FadeOut, useAnimatedProps, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { LAYOUT } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Icon, Surface, surfaceStyle, useAccessibleEffects } from "@/components/sona/ui";
import { haptic } from "@/features/clinical/medication-parts";
import { useEncounter } from "@/features/encounter/store";
import { api, useLive } from "@/features/live";
import { formatRM, markSent, openItems, totalRisk, useSent, type AuditItem } from "./model";

/*
 * Coding audit (after Twodos' swipe-to-check): drag a row right and its ring fills; past 75 pt it
 * checks, says who the query went to, and the row collapses while the rows below slide up
 * (spring 0.38 s, damping 0.82). The sent count pops (0.75 then 1.25 then 1) and the money at
 * risk rolls down digit by digit (after Finma's number flip: only changed digits move, on a light
 * spring). Tapping a row shows the drafted query with a Send button, so swiping is never required.
 */
const THRESHOLD = 75, TEAL = "#0F6E66";
const RING = 11, RING_C = 2 * Math.PI * RING;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function AuditScreen() {
  const { encounters, patients } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const insets = useSafeAreaInsets();
  const sent = useSent();
  const { on: live } = useLive();
  const [serverItems, setServerItems] = useState<AuditItem[]>();
  // Live: run the audit now and read the server's open items (lab-only gaps until the coding model lands).
  // Once per visit to the screen (the patient list is only read for names, so it is not a dependency).
  const nameOf = useRef((id: string) => patients.find(p => p.id === id)?.name ?? id);
  nameOf.current = id => patients.find(p => p.id === id)?.name ?? id;
  useEffect(() => {
    if (!live) { setServerItems(undefined); return; }
    let alive = true;
    api.audit.run().then(() => api.audit.list()).then(rows => alive && setServerItems(rows.map(r => ({
      id: r.id, bed: "", patient: nameOf.current(r.patientId), doctor: r.doctor, gap: r.gap,
      from: r.fromCode ?? "—", to: r.toCode, risk: Math.round(r.riskCents / 100), query: r.query,
    })))).catch(() => alive && setServerItems([]));
    return () => { alive = false; };
  }, [live]);
  // Live never shows the authored list: empty until the server answers.
  const items = live ? (serverItems ?? []).filter(i => !sent.has(i.id)) : openItems(encounters, sent);
  const [sending, setSending] = useState<string[]>([]);
  const [open, setOpen] = useState<string>();
  const badge = useSharedValue(1);
  const risk = totalRisk(items.filter(i => !sending.includes(i.id)));
  const sentCount = sent.size + sending.length;

  const send = (item: AuditItem) => {
    if (sending.includes(item.id)) return;
    haptic("success");
    setSending(list => [...list, item.id]);
    if (!reducedMotion) badge.set(withSequence(withTiming(0.75, { duration: 80 }), withSpring(1.25, { duration: 140, dampingRatio: 0.5 }), withSpring(1, { duration: 120, dampingRatio: 1 })));
    if (live) void api.audit.query({ itemId: item.id }).catch(() => {});
    // The row says who it went to, then folds away.
    setTimeout(() => { markSent(item.id); setSending(list => list.filter(id => id !== item.id)); }, reducedMotion ? 0 : 650);
  };
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badge.value }] }));

  return <ScrollView style={{ flex: 1, backgroundColor: palette.canvas }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 16 }}>
    <Surface feature style={{ padding: 16, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ ...type.overline, color: live ? palette.blue : palette.muted }}>{live ? "Live audit · from the server" : "Last night’s audit"}</Text>
        <Animated.View style={[{ height: 26, paddingHorizontal: 10, borderRadius: 13, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: sentCount ? "rgba(15,110,102,0.1)" : "rgba(20,28,40,0.05)" }, badgeStyle]}>
          <Icon name="paperplane.fill" size={10} color={sentCount ? TEAL : palette.muted} />
          <Text style={{ fontSize: 12, fontWeight: "700", color: sentCount ? TEAL : palette.muted, fontVariant: ["tabular-nums"] }}>Queries sent · {sentCount}</Text>
        </Animated.View>
      </View>
      <Ticker text={formatRM(risk)} />
      <Text style={{ ...type.subhead, color: palette.muted }}>{live && !serverItems ? "Running the audit on the server…" : items.length ? `at risk across ${items.length - sending.length} under-specified ${items.length - sending.length === 1 ? "note" : "notes"}` : "Nothing left at risk. Every query is out."}</Text>
    </Surface>

    {items.length > 0 && <Text style={{ ...type.caption, color: palette.muted }}>Swipe right to send the drafted query, or tap to read it first.</Text>}
    <View style={{ gap: 10 }}>
      {items.map(item => <Animated.View key={item.id} layout={reducedMotion ? undefined : LAYOUT} exiting={reducedMotion ? undefined : FadeOut.duration(160)}>
        <Row item={item} sending={sending.includes(item.id)} open={open === item.id} onToggle={() => setOpen(o => (o === item.id ? undefined : item.id))} onSend={() => send(item)} />
      </Animated.View>)}
    </View>
  </ScrollView>;
}

/** Money that rolls only the digits that change, like an odometer. */
function Ticker({ text }: { text: string }) {
  const chars = text.split("");
  return <View accessible accessibilityLabel={text} style={{ flexDirection: "row", height: 40, overflow: "hidden" }}>
    {chars.map((c, i) => /\d/.test(c) ? <Digit key={chars.length - i} d={Number(c)} /> : <Text key={`s${chars.length - i}`} style={{ fontSize: 32, lineHeight: 40, fontWeight: "700", color: palette.ink }}>{c}</Text>)}
  </View>;
}
function Digit({ d }: { d: number }) {
  const { reducedMotion } = useAccessibleEffects();
  const y = useSharedValue(-d * 40);
  useEffect(() => { y.set(reducedMotion ? -d * 40 : withSpring(-d * 40, { duration: 420, dampingRatio: 0.8 })); }, [d, reducedMotion, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <View style={{ height: 40, overflow: "hidden" }}>
    <Animated.View style={style}>
      {Array.from({ length: 10 }, (_, n) => <Text key={n} style={{ fontSize: 32, lineHeight: 40, height: 40, fontWeight: "700", color: palette.ink, fontVariant: ["tabular-nums"] }}>{n}</Text>)}
    </Animated.View>
  </View>;
}

function Row({ item, sending, open, onToggle, onSend }: { item: AuditItem; sending: boolean; open: boolean; onToggle: () => void; onSend: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const x = useSharedValue(0);
  const pan = Gesture.Pan().activeOffsetX(10).failOffsetX(-10).failOffsetY([-12, 12]).enabled(!sending)
    .onUpdate(e => { x.set(Math.max(0, e.translationX)); })
    .onEnd(() => {
      if (x.value > THRESHOLD) { x.set(withSpring(THRESHOLD + 20, { duration: 200, dampingRatio: 0.8 })); scheduleOnRN(onSend); }
      else x.set(withSpring(0, { duration: 300, dampingRatio: 0.7 }));
    });
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const ring = useAnimatedProps(() => ({ strokeDashoffset: RING_C * (1 - Math.min(1, x.value / THRESHOLD)) }));
  const reveal = useAnimatedStyle(() => ({ opacity: Math.min(1, x.value / THRESHOLD) }));

  return <View>
    <Animated.View pointerEvents="none" style={[{ position: "absolute", inset: 0, borderRadius: 22, borderCurve: "continuous", paddingLeft: 18, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(36,91,204,0.12)" }, reveal]}>
      <Icon name="paperplane.fill" size={14} color={palette.blue} />
      <Text style={{ ...type.footnote, fontWeight: "700", color: palette.blue }}>Send query</Text>
    </Animated.View>
    <GestureDetector gesture={pan}>
      <Animated.View style={slide}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${item.bed}, ${item.patient}. ${item.gap}. ${formatRM(item.risk)} at risk.`}
          accessibilityActions={[{ name: "activate" }, { name: "send", label: `Send query to ${item.doctor}` }]} onAccessibilityAction={e => (e.nativeEvent.actionName === "send" ? onSend() : onToggle())}
          onPress={onToggle} style={{ ...surfaceStyle, borderRadius: 22, padding: 14, gap: 10 }}>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ width: 26, height: 26, marginTop: 2 }}>
              <Svg width={26} height={26} style={{ position: "absolute" }}>
                <Circle cx={13} cy={13} r={RING} stroke="rgba(20,28,40,0.14)" strokeWidth={2} fill="none" />
                <AnimatedCircle cx={13} cy={13} r={RING} stroke={palette.blue} strokeWidth={2} fill="none" strokeLinecap="round" strokeDasharray={RING_C} animatedProps={ring} transform="rotate(-90 13 13)" />
              </Svg>
              {sending && <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(140)} style={{ position: "absolute", inset: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: TEAL }}>
                <Icon name="checkmark" size={11} color={palette.white} />
              </Animated.View>}
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "700", flex: 1, color: palette.ink }}>{item.patient}</Text>
                <Text style={{ ...type.footnote, fontWeight: "700", color: palette.amber, fontVariant: ["tabular-nums"] }}>{formatRM(item.risk)}</Text>
              </View>
              <MarkedText selectable={false} text={item.gap} style={{ ...type.footnote, color: palette.ink }} />
              <Text style={{ ...type.caption, color: palette.muted }}>{sending ? `Sent to ${item.doctor}` : [item.bed, item.doctor, `${item.from} → ${item.to}`].filter(Boolean).join(" · ")}</Text>
            </View>
          </View>
          {open && !sending && <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(180)} style={{ gap: 10, paddingLeft: 38 }}>
            <Text selectable style={{ ...type.footnote, color: palette.ink, padding: 10, borderRadius: 14, overflow: "hidden", backgroundColor: "rgba(20,28,40,0.04)" }}>{item.query}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Send query to ${item.doctor}`} onPress={onSend}
              style={{ alignSelf: "flex-start", height: 34, paddingHorizontal: 14, borderRadius: 17, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: palette.blue }}>
              <Icon name="paperplane.fill" size={12} color={palette.white} />
              <Text style={{ fontSize: 14, fontWeight: "600", color: palette.white }}>Send to {item.doctor}</Text>
            </Pressable>
          </Animated.View>}
        </Pressable>
      </Animated.View>
    </GestureDetector>
  </View>;
}

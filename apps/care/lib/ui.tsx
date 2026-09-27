import MaskedView from "@react-native-masked-view/masked-view";
import * as Haptics from "expo-haptics";
import { useState, type ReactNode } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, Text, View, type TextStyle, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, Easing, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { HalftoneGlint } from "./halftone";
import { accent, palette, type } from "./theme";

/**
 * Sona's design system for Sona Care, Clean (mirrors apps/native/components/sona/ui.tsx):
 * white cards on hairline edges over a cool misty canvas; one `feature` card per screen for
 * the thing that needs the patient now (a soft blue lift, a faint blue-to-lilac halftone glint); an
 * ink primary pill with a dotted glint, quiet glass for everything else. Press feedback is a 0.96 scale.
 * ponytail: mirrored, not shared; move both apps' copies to a shared UI package once they settle.
 */
const glassFill = "linear-gradient(170deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.82) 100%)";
const glassEdge = "0 0 0 0.5px rgba(20,26,46,0.07), 0 18px 36px -24px rgba(40,60,120,0.22), 0 1px 3px rgba(20,26,46,0.04), inset 0 1px 0 rgba(255,255,255,1)";
export const surfaceStyle: ViewStyle = { borderRadius: 28, borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", backgroundColor: "transparent", experimental_backgroundImage: glassFill, boxShadow: glassEdge } as ViewStyle;
/** A small glass capsule for a value or label (a time, a status, a chip). */
export const pillStyle: ViewStyle = { borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", backgroundColor: "rgba(255,255,255,0.72)", boxShadow: "0 0 0 0.5px rgba(40,24,70,0.06), 0 8px 18px -10px rgba(80,60,140,0.35)" } as ViewStyle;
const featureStyle: ViewStyle = { experimental_backgroundImage: "linear-gradient(170deg, #FFFFFF 0%, rgba(250,251,255,0.96) 100%)", boxShadow: "0 0 0 0.5px rgba(61,90,241,0.12), 0 22px 40px -22px rgba(61,90,241,0.26), 0 1px 3px rgba(20,26,46,0.04), inset 0 1px 0 #FFFFFF" } as ViewStyle;

/** Cards resize on the layout spring (no bounce), so a card that grows in place (a check-in opening) springs rather than jumps. */
const CARD_LAYOUT = LinearTransition.springify().duration(380).dampingRatio(1);

export function Card({ children, feature = false, style }: { children: ReactNode; feature?: boolean; style?: ViewStyle }) {
  const still = useReducedMotion();
  return <Animated.View layout={still ? undefined : CARD_LAYOUT} style={[surfaceStyle, feature && featureStyle, { padding: 18, gap: 12 }, style]}>
    {feature && <View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: 27, overflow: "hidden" }}><HalftoneGlint width={170} height={96} origin={[170, 0]} reach={[160, 90]} strength={0.4} style={{ top: 0, right: 0 }} /></View>}
    {children}
  </Animated.View>;
}

/** Primary: ink capsule with a dotted glint (only the action that matters). `quiet`: a glass capsule. */
export function Button({ label, onPress, busy, disabled, quiet }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; quiet?: boolean }) {
  const off = disabled || busy;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: off, busy }} disabled={off} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 50, borderRadius: 25, paddingHorizontal: 20, overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 1,
      borderColor: quiet ? "rgba(255,255,255,0.95)" : palette.dark, backgroundColor: quiet ? "rgba(255,255,255,0.72)" : palette.dark, opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.96 : 1 }],
      // A quiet pill still reads as a button on a white sheet: a hairline edge and a soft lift.
      boxShadow: quiet ? "0 0 0 0.5px rgba(40,24,70,0.12), 0 8px 18px -12px rgba(80,60,140,0.45)" : undefined })}>
    {!quiet && !disabled && <HalftoneGlint width={76} height={50} origin={[10, 2]} reach={[68, 42]} pitch={3} strength={0.75} hueShift={0.6} style={{ top: 0, left: 0 }} />}
    {busy ? <ActivityIndicator color={quiet ? palette.ink : palette.white} /> : <Text style={{ fontSize: 16, fontWeight: "600", color: quiet ? palette.ink : palette.white }}>{label}</Text>}
  </Pressable>;
}

/**
 * Hold to confirm (after Opal's hold-to-commit): the ink pill fills with the accent gradient over
 * `hold` ms while pressed and drains back if let go early, so a stray tap can't log a dose. On
 * completion it settles into a white pill with a check. VoiceOver's activate confirms at once
 * (holding is a visual gesture, not the only way in). `quiet`: a glass pill for a secondary hold
 * (a dose taken early). Every finish is announced.
 */
export function HoldButton({ label, doneLabel, onDone, done = false, hold = 800, compact = false, quiet = false }: { label: string; doneLabel: string; onDone: () => void; done?: boolean; hold?: number; compact?: boolean; quiet?: boolean }) {
  const still = useReducedMotion();
  const p = useSharedValue(done ? 1 : 0);
  const [holding, setHolding] = useState(false);
  const finish = () => {
    if (process.env.EXPO_OS === "ios") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    AccessibilityInfo.announceForAccessibility(doneLabel);
    onDone();
  };
  const start = () => {
    if (done) return;
    setHolding(true);
    if (process.env.EXPO_OS === "ios") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    p.set(withTiming(1, { duration: hold * (1 - p.get()), easing: Easing.linear }, ok => { if (ok) scheduleOnRN(finish); }));
  };
  const stop = () => {
    setHolding(false);
    if (done || p.get() >= 1) return;
    cancelAnimation(p);
    p.set(withTiming(0, { duration: 250 }));
  };
  const fill = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }));
  const settle = useAnimatedStyle(() => ({ transform: [{ scale: done ? withSpring(1, { duration: 380, dampingRatio: 0.72 }) : withTiming(holding && !still ? 0.98 : 1, { duration: 120 }) }] }));
  const h = compact ? 44 : 56;
  const ink = quiet ? palette.ink : palette.white;
  return <Pressable accessibilityRole="button" accessibilityLabel={done ? doneLabel : label} accessibilityHint={done ? undefined : "Press and hold to confirm"} accessibilityState={{ disabled: done }}
    onPressIn={start} onPressOut={stop} disabled={done}
    onAccessibilityTap={() => { if (!done) finish(); }}>
    <Animated.View style={[{ minHeight: h, borderRadius: h / 2, overflow: "hidden", alignItems: "center", justifyContent: "center", paddingHorizontal: compact ? 12 : 20,
      backgroundColor: done ? palette.white : quiet ? "rgba(255,255,255,0.72)" : palette.dark, borderWidth: quiet && !done ? 1 : 0, borderColor: "rgba(255,255,255,0.95)",
      boxShadow: done ? "0 0 0 1px rgba(30,20,40,0.08), 0 12px 22px -12px rgba(80,60,120,0.45)" : quiet ? "0 8px 18px -12px rgba(80,60,140,0.45)" : "0 10px 20px -12px rgba(33,30,51,0.6)" }, settle]}>
      {!done && <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, bottom: 0, experimental_backgroundImage: `linear-gradient(135deg, ${accent[0]}, ${accent[1]} 50%, ${accent[2]})` } as ViewStyle, fill]} />}
      <Text style={{ fontSize: compact ? 13 : 16, fontWeight: "700", color: done ? palette.green : holding && quiet ? palette.white : ink }}>{done ? `✓  ${doneLabel}` : holding ? "Keep holding…" : label}</Text>
    </Animated.View>
  </Pressable>;
}

/** A tappable row inside a card: what it is, one line of state, and where it goes. */
export function Row({ title, line, tone = "muted", onPress, first }: { title: string; line: string; tone?: "muted" | "amber" | "red" | "green"; onPress: () => void; first?: boolean }) {
  const color = tone === "muted" ? palette.muted : palette[tone];
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${line}`} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderColor: "rgba(40,24,70,0.06)", opacity: pressed ? 0.6 : 1 })}>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ ...type.headline, color: palette.ink }}>{title}</Text>
      <Text numberOfLines={1} style={{ ...type.footnote, fontWeight: tone === "muted" ? "400" : "600", color }}>{line}</Text>
    </View>
    <Text style={{ fontSize: 20, color: palette.muted }}>›</Text>
  </Pressable>;
}

/** Text in the accent gradient (royal blue to periwinkle), for the one accent word on a screen. */
export function AccentText({ children, style }: { children: string; style: TextStyle }) {
  return <MaskedView accessible={false} maskElement={<Text style={style}>{children}</Text>}>
    <View style={{ experimental_backgroundImage: `linear-gradient(90deg, ${accent[0]} 0%, ${accent[1]} 55%, ${accent[2]} 100%)` } as ViewStyle}>
      <Text style={[style, { opacity: 0 }]}>{children}</Text>
    </View>
  </MaskedView>;
}

/**
 * A screen title (after the Sona Care reference kit): an optional light greeting or overline above, then
 * the bold title with its accent (the part to glance at) in the accent gradient, and one line of insight
 * under it. The accent comes first, as in "Day 3 at home".
 */
export function Title({ overline, greeting, accent, children, line, lineTone = "muted" }: { overline?: string; greeting?: string; accent?: string; children?: string; line?: string; lineTone?: "muted" | "amber" | "green" }) {
  const big = { ...type.display, fontWeight: "700" as const, color: palette.ink };
  return <View style={{ gap: 4 }} accessible accessibilityRole="header" accessibilityLabel={[greeting, `${accent ?? ""}${children ?? ""}`, line].filter(Boolean).join(". ")}>
    {overline && <Text style={{ ...type.overline, color: palette.blue }}>{overline}</Text>}
    {greeting && <Text style={{ ...type.greeting, color: palette.faint }}>{greeting}</Text>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end" }}>
      {accent && <AccentText style={big}>{accent}</AccentText>}
      {children && <Text style={big}>{children}</Text>}
    </View>
    {line && <Text style={{ ...type.body, fontWeight: lineTone === "muted" ? "400" : "600", color: palette[lineTone], marginTop: 2 }}>{line}</Text>}
  </View>;
}

/** A two-line section head (reference kit): a light first line over a bold second ("Up / next"). */
export function Section({ light, bold }: { light: string; bold: string }) {
  return <View accessible accessibilityRole="header" accessibilityLabel={`${light} ${bold}`} style={{ marginTop: 4 }}>
    <Text style={{ fontSize: 17, lineHeight: 21, fontWeight: "300", color: palette.faint, letterSpacing: -0.3 }}>{light}</Text>
    <Text style={{ fontSize: 21, lineHeight: 26, fontWeight: "700", color: palette.ink, letterSpacing: -0.6 }}>{bold}</Text>
  </View>;
}

/** A small glass chip that does one thing (a quick reply, a needs shortcut, a filter). */
export function Chip({ label, onPress, dot, tone, accessibilityLabel }: { label: string; onPress: () => void; dot?: string; tone?: { bg: string; fg: string }; accessibilityLabel?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress}
    style={({ pressed }) => [pillStyle, { minHeight: 44, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 7, transform: [{ scale: pressed ? 0.96 : 1 }] }, tone && { backgroundColor: tone.bg, borderColor: tone.bg }]}>
    {dot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} />}
    <Text style={{ fontSize: 13.5, fontWeight: "700", color: tone?.fg ?? palette.ink }}>{label}</Text>
  </Pressable>;
}

export const field = { minHeight: 50, borderRadius: 16, paddingHorizontal: 16, fontSize: 16, color: palette.ink, backgroundColor: "rgba(255,255,255,0.8)", borderWidth: 1, borderColor: "rgba(40,24,70,0.06)" } as const;

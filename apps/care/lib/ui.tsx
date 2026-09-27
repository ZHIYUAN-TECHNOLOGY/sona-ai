import MaskedView from "@react-native-masked-view/masked-view";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { useState, type ReactNode } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, View, type TextStyle, type ViewStyle } from "react-native";
import { Text } from "./text";
import Animated, { cancelAnimation, Easing, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { HalftoneGlint } from "./halftone";
import { accent, palette, type } from "./theme";

/**
 * Sona's design system for Sona Care, after the AI Health Companion kit (mirrors apps/native/components/sona/ui.tsx):
 * liquid-glass cards with 32 pt corners over the aurora canvas; glass capsules for values (a time, "Next in 3:00"); one `feature` card for the thing that
 * needs the patient now (white, a soft blue lift, a faint halftone glint); a near-black primary pill and
 * round glass buttons. Press feedback is a 0.96 scale.
 * ponytail: mirrored, not shared; move both apps' copies to a shared UI package once they settle.
 */
// Liquid glass (Sona's design system, as in apps/native): a translucent fill, bright at the top and cooler
// toward the bottom, a white rim with a defined outer edge so it never melts into the white canvas, a
// sheen along the top, an azure catch along the bottom and a soft azure lift; 24 pt continuous corners.
// No live blur, so long lists stay cheap; real blur is kept for chrome (the bar).
export const CARD_RADIUS = 24;
const glassFill = "linear-gradient(165deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.46) 48%, rgba(228,237,255,0.5) 100%)";
export const surfaceStyle: ViewStyle = { borderRadius: CARD_RADIUS, borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", backgroundColor: "transparent", experimental_backgroundImage: glassFill,
  boxShadow: "0 0 0 0.75px rgba(30,50,110,0.10), 0 1px 2px rgba(30,50,110,0.06), 0 16px 32px -18px rgba(37,70,170,0.32), inset 0 1px 0 #FFFFFF, inset 0 12px 20px -14px rgba(255,255,255,1), inset 0 -14px 24px -16px rgba(37,99,235,0.2)" } as ViewStyle;
/** A glass capsule for a value or label (a time, a status, a chip). */
export const pillStyle: ViewStyle = { borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", backgroundColor: "rgba(255,255,255,0.78)", boxShadow: "0 0 0 0.5px rgba(20,28,40,0.05), 0 4px 12px -6px rgba(40,70,140,0.18), inset 0 1px 0 #FFFFFF" } as ViewStyle;
const featureStyle: ViewStyle = { backgroundColor: palette.white, borderColor: "rgba(37,99,235,0.10)", boxShadow: "0 18px 36px -20px rgba(37,99,235,0.35)" } as ViewStyle;

/** Cards resize on the layout spring (no bounce), so a card that grows in place (a check-in opening) springs rather than jumps. */
const CARD_LAYOUT = LinearTransition.springify().duration(380).dampingRatio(1);

export function Card({ children, feature = false, style }: { children: ReactNode; feature?: boolean; style?: ViewStyle }) {
  const still = useReducedMotion();
  return <Animated.View layout={still ? undefined : CARD_LAYOUT} style={[surfaceStyle, feature && featureStyle, { padding: 22, gap: 14 }, style]}>
    {feature && <View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: CARD_RADIUS, overflow: "hidden" }}><HalftoneGlint width={170} height={96} origin={[170, 0]} reach={[160, 90]} strength={0.4} style={{ top: 0, right: 0 }} /></View>}
    {children}
  </Animated.View>;
}

/** Primary: the kit's near-black capsule (only the action that matters). `quiet`: a white capsule on a hairline. */
export function Button({ label, onPress, busy, disabled, quiet }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; quiet?: boolean }) {
  const off = disabled || busy;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: off, busy }} disabled={off} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 52, borderRadius: 26, paddingHorizontal: 20, overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 1,
      borderColor: quiet ? "#EDEDED" : palette.dark, backgroundColor: quiet ? palette.white : palette.dark, opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
    {busy ? <ActivityIndicator color={quiet ? palette.ink : palette.white} /> : <Text style={{ fontSize: 16, fontWeight: "600", color: quiet ? palette.ink : palette.white }}>{label}</Text>}
  </Pressable>;
}

/**
 * Hold to confirm (after Opal's hold-to-commit): the ink pill fills blue into violet over
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
      backgroundColor: done ? palette.white : quiet ? palette.white : palette.dark, borderWidth: 1, borderColor: done || quiet ? "#EDEDED" : palette.dark }, settle]}>
      {!done && <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, bottom: 0, experimental_backgroundImage: `linear-gradient(135deg, ${accent[1]}, ${accent[2]})` } as ViewStyle, fill]} />}
      <Text style={{ fontSize: compact ? 13 : 16, fontWeight: "700", color: done ? palette.green : holding && quiet ? palette.white : ink }}>{done ? `✓  ${doneLabel}` : holding ? "Keep holding…" : label}</Text>
    </Animated.View>
  </Pressable>;
}

/** The glass back button for screens off the dock (no header band): back, or home if opened directly. */
export function BackButton({ label = "Back" }: { label?: string }) {
  return <View style={{ alignSelf: "flex-start" }}><CircleButton d={ICON.back} label={label} onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/"); }} /></View>;
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

/** Text in the headline gradient (ink, then azure into violet), for the one bold line on a screen. */
export function AccentText({ children, style }: { children: string; style: TextStyle }) {
  return <MaskedView accessible={false} style={{ alignSelf: style.textAlign === "center" ? "center" : "flex-start", maxWidth: "100%" }} maskElement={<Text style={style}>{children}</Text>}>
    <View style={{ experimental_backgroundImage: `linear-gradient(100deg, ${accent[0]} 0%, ${accent[0]} 28%, ${accent[1]} 56%, ${accent[2]} 100%)` } as ViewStyle}>
      <Text style={[style, { opacity: 0 }]}>{children}</Text>
    </View>
  </MaskedView>;
}

/**
 * A screen title (the kit's two-line head): an optional light greeting or overline above, then the bold
 * title (the accent, the part to glance at, then the rest) as one line in the headline gradient, and one
 * line of insight under it, as in "Your / Medicines".
 */
export function Title({ overline, greeting, accent, children, line, lineTone = "muted" }: { overline?: string; greeting?: string; accent?: string; children?: string; line?: string; lineTone?: "muted" | "amber" | "green" | "red" }) {
  const big = { fontSize: 32, lineHeight: 38, letterSpacing: -2, fontWeight: "600" as const, color: palette.ink };
  return <View style={{ gap: 4 }} accessible accessibilityRole="header" accessibilityLabel={[greeting, `${accent ?? ""}${children ?? ""}`, line].filter(Boolean).join(". ")}>
    {overline && <Text style={{ ...type.overline, color: palette.blue }}>{overline}</Text>}
    {greeting && <Text style={{ ...type.greeting, color: palette.faint }}>{greeting}</Text>}
    <AccentText style={big}>{`${accent ?? ""}${children ?? ""}`}</AccentText>
    {line && <Text style={{ ...type.body, fontWeight: lineTone === "muted" ? "400" : "600", color: palette[lineTone], marginTop: 2 }}>{line}</Text>}
  </View>;
}

/** A two-line section head (the kit's "Today's / Latest Updates"): a light grey line over a bold one in the headline gradient, with an optional round action on the right. */
export function Section({ light, bold, action }: { light: string; bold: string; action?: ReactNode }) {
  return <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: 4 }}>
    <View accessible accessibilityRole="header" accessibilityLabel={`${light} ${bold}`} style={{ flexShrink: 1 }}>
      <Text style={{ fontSize: 20, lineHeight: 26, fontWeight: "400", color: palette.faint, letterSpacing: -0.6 }}>{light}</Text>
      <AccentText style={{ fontSize: 28, lineHeight: 33, fontWeight: "600", color: palette.ink, letterSpacing: -1.9 }}>{bold}</AccentText>
    </View>
    {action}
  </View>;
}

/** A round glass icon button (the kit's 48–56 pt white-glass circle): back, close, add, bell, call. `d` is a 24-unit SVG path. */
export function CircleButton({ d, label, onPress, dot, tint = palette.ink, size = 48 }: { d: string; label: string; onPress: () => void; dot?: boolean; tint?: string; size?: number }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={Math.max(0, (44 - size) / 2)} onPress={onPress}
    style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.6)", borderWidth: 1, borderColor: "rgba(255,255,255,0.9)", transform: [{ scale: pressed ? 0.94 : 1 }] })}>
    <Svg width={size * 0.44} height={size * 0.44} viewBox="0 0 24 24"><Path d={d} fill="none" stroke={tint} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /></Svg>
    {dot && <View style={{ position: "absolute", top: size * 0.22, right: size * 0.24, width: 8, height: 8, borderRadius: 4, backgroundColor: palette.blue, borderWidth: 1.5, borderColor: palette.white }} />}
  </Pressable>;
}

/** Icon paths shared across screens (Lucide-style, 24 units). */
export const ICON = {
  back: "m15 18l-6-6l6-6", close: "M18 6L6 18M6 6l12 12", plus: "M12 5v14M5 12h14",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
  phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z",
  chat: "M7.9 20A9 9 0 1 0 4 16.1L2 22Z", pin: "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0ZM12 13a3 3 0 1 0 0-6a3 3 0 0 0 0 6", alarm: "M12 21a8 8 0 1 0 0-16a8 8 0 0 0 0 16M12 9v4l2 2M5 3L2 6M22 6l-3-3",
} as const;

/** A small white chip that does one thing (a quick reply, a needs shortcut, a filter). */
export function Chip({ label, onPress, dot, tone, accessibilityLabel }: { label: string; onPress: () => void; dot?: string; tone?: { bg: string; fg: string }; accessibilityLabel?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress}
    style={({ pressed }) => [pillStyle, { minHeight: 44, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 7, transform: [{ scale: pressed ? 0.96 : 1 }] }, tone && { backgroundColor: tone.bg, borderColor: tone.bg }]}>
    {dot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} />}
    <Text style={{ fontSize: 14, fontWeight: "500", color: tone?.fg ?? palette.ink }}>{label}</Text>
  </Pressable>;
}

export const field = { minHeight: 52, borderRadius: 18, paddingHorizontal: 16, fontSize: 17, color: palette.ink, backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line } as const;

import { useReduceMotionPreference } from "@/components/sona/accessibility";
import { BrandIcon } from "@/components/sona/brand-icon";
import { HalftoneGlint } from "@/components/sona/halftone-shimmer";
import { EASE_OUT, LAYOUT, riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette } from "@/components/sona/theme";
import { glass, Icon } from "@/components/sona/ui";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Pressable, View, type AccessibilityRole, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cubicBezier, FadeIn, FadeOut, withDelay, withTiming } from "react-native-reanimated";
import Svg, { Line } from "react-native-svg";

/**
 * Local parts for the medication review and prescribing answers: a check mark with states, quiet
 * rows, disclosures and the receipt's perforation and seal. Same tokens as components/sona.
 */
const EASE = cubicBezier(0.23, 1, 0.32, 1);
const RING = "rgba(89,97,107,0.42)";
const AMBER_WASH = "rgba(139,85,24,0.08)";

export function useLayoutSpring() { return useReduceMotionPreference() ? undefined : LAYOUT; }

export function haptic(kind: "select" | "success" | "warning") {
  if (process.env.EXPO_OS !== "ios") return;
  const run = kind === "select" ? Haptics.selectionAsync() : Haptics.notificationAsync(kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
  run.catch(() => {});
}

/** Whole-row press target; feedback scale on press-in (120 ms), none under Reduce Motion. */
export function Press({ children, onPress, disabled = false, style, scale = 0.98, accessibilityLabel, accessibilityHint, accessibilityRole = "button", expanded }: { children: ReactNode; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle>; scale?: number; accessibilityLabel?: string; accessibilityHint?: string; accessibilityRole?: AccessibilityRole; expanded?: boolean }) {
  const reduced = useReduceMotionPreference();
  return <Pressable accessibilityRole={accessibilityRole} accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} accessibilityState={{ disabled, expanded }} disabled={disabled} onPress={onPress}>
    {({ pressed }) => <Animated.View style={[style, { transform: [{ scale: pressed && !reduced ? scale : 1 }], transitionProperty: "transform", transitionDuration: 120, transitionTimingFunction: EASE }]}>{children}</Animated.View>}
  </Pressable>;
}

/**
 * A check's state. `done` fills blue and ticks in; `open` is an empty ring (not yet confirmed);
 * `blocked` rings amber with a mark; `pending` pulses while a real check is running. `delay`
 * staggers the change so results resolve down a list.
 */
export type MarkState = "done" | "open" | "blocked" | "pending";
const PULSE = { from: { opacity: 0.25, transform: [{ scale: 0.6 }] }, to: { opacity: 1, transform: [{ scale: 1 }] } };
export function Mark({ state, delay = 0, size = 24 }: { state: MarkState; delay?: number; size?: number }) {
  const reduced = useReduceMotionPreference();
  const done = state === "done", blocked = state === "blocked";
  const inner = (on: boolean) => ({ position: "absolute" as const, opacity: on ? 1 : 0, transform: [{ scale: on || reduced ? 1 : 0.5 }], transitionProperty: ["opacity", "transform"], transitionDuration: 240, transitionDelay: `${delay}ms`, transitionTimingFunction: EASE });
  return <Animated.View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.6, alignItems: "center", justifyContent: "center", borderColor: done ? palette.blue : blocked ? palette.amber : RING, backgroundColor: done ? palette.blue : blocked ? AMBER_WASH : "transparent", transitionProperty: ["backgroundColor", "borderColor"], transitionDuration: 180, transitionDelay: delay }}>
    <Animated.View style={inner(done) as never}><BrandIcon name="check" size={size * 0.62} color={palette.white} strokeWidth={2.4} /></Animated.View>
    <Animated.View style={inner(blocked) as never}><Text style={{ fontSize: size * 0.54, lineHeight: size * 0.66, fontWeight: "700", color: palette.amber }}>!</Text></Animated.View>
    {state === "pending" && <Animated.View style={{ width: size / 3, height: size / 3, borderRadius: size / 6, backgroundColor: palette.blue, opacity: reduced ? 0.5 : undefined, animationName: reduced ? undefined : PULSE, animationDuration: 640, animationDelay: delay, animationDirection: "alternate", animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" }} />}
  </Animated.View>;
}

/** Mark + text, for a short status inside a surface. */
export function StatusLine({ state, children }: { state: MarkState; children: ReactNode }) {
  return <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
    <View style={{ paddingTop: 1 }}><Mark state={state} size={20} /></View>
    <Text selectable style={{ flex: 1, fontSize: 15, lineHeight: 21, color: palette.ink }}>{children}</Text>
  </View>;
}

export function Hairline({ inset = 0 }: { inset?: number }) {
  return <View style={{ height: 1, marginLeft: inset, backgroundColor: glass.hairline }} />;
}

/** Quiet provenance or limit line: no box, muted, with a small icon. Warnings stay in `Notice warning`. */
export function Footnote({ children, icon = "info.circle" }: { children: ReactNode; icon?: string }) {
  return <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
    <View style={{ paddingTop: 2 }}><Icon name={icon} size={14} color={palette.muted} /></View>
    <Text selectable style={{ flex: 1, fontSize: 13, lineHeight: 19, color: palette.muted }}>{children}</Text>
  </View>;
}

export function Detail({ label, value }: { label: string; value: string }) {
  return <View style={{ gap: 2 }}>
    <Text style={{ fontSize: 12, lineHeight: 16, fontWeight: "500", color: palette.muted }}>{label}</Text>
    <Text selectable style={{ fontSize: 15, lineHeight: 21, color: palette.ink }}>{value}</Text>
  </View>;
}

/** Text disclosure with a turning chevron; the body opens below it. */
export function DisclosureButton({ label, open, onToggle, accessibilityLabel }: { label: string; open: boolean; onToggle: () => void; accessibilityLabel?: string }) {
  return <View style={{ alignSelf: "flex-start" }}>
    <Press onPress={onToggle} accessibilityLabel={accessibilityLabel ?? label} expanded={open} scale={0.96} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text style={{ fontSize: 15, fontWeight: "500", color: palette.blue }}>{label}</Text>
      <Animated.View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }], transitionProperty: "transform", transitionDuration: 200, transitionTimingFunction: EASE }}><Icon name="chevron.down" size={12} color={palette.blue} /></Animated.View>
    </Press>
  </View>;
}

/** Quiet secondary action: blue text only, 44 pt target. Used where a capsule would compete with the one primary. */
export function TextLink({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <View style={{ alignSelf: "flex-start" }}>
    <Press onPress={onPress} disabled={disabled} scale={0.96} style={{ minHeight: 44, justifyContent: "center", opacity: disabled ? 0.45 : 1 }}>
      <Text style={{ fontSize: 15, fontWeight: "500", color: palette.blue }}>{label}</Text>
    </Press>
  </View>;
}

/**
 * Disclosure body for native form controls. It rises into place while the surrounding layout
 * springs; a measured-height clip (`Expand`) could cut off native hosts that size a frame late.
 */
export function FormReveal({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReduceMotionPreference();
  return <Animated.View entering={reduced ? FadeIn.duration(150) : riseIn({ distance: 6, duration: 260 })} exiting={FadeOut.duration(120)} layout={reduced ? undefined : LAYOUT} style={style}>{children}</Animated.View>;
}

/** Leading glyph for an interaction pair: amber triangle for a sourced alert, muted for no conclusion. */
export function PairGlyph({ status }: { status: "alert" | "unresolved" | "uncovered" }) {
  const alert = status === "alert";
  return <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: alert ? AMBER_WASH : "rgba(89,97,107,0.08)" }}>
    <Icon name={alert ? "exclamationmark.triangle.fill" : status === "unresolved" ? "questionmark" : "minus"} size={alert ? 14 : 12} color={alert ? palette.amber : palette.muted} />
  </View>;
}

/** A calm alert row: amber glyph, pair, what the label says, and its source. */
export function AlertRow({ title, kind, detail, children }: { title: string; kind: string; detail: string; children?: ReactNode }) {
  return <View accessible={false} style={{ flexDirection: "row", gap: 12, padding: 14, borderRadius: 18, borderCurve: "continuous", backgroundColor: "rgba(139,85,24,0.05)" }}>
    <PairGlyph status="alert" />
    <View style={{ flex: 1, gap: 6 }}>
      <View style={{ gap: 2 }}>
        <Text selectable style={{ fontSize: 16, lineHeight: 22, fontWeight: "600", color: palette.ink }}>{title}</Text>
        <Text style={{ fontSize: 12, fontWeight: "600", letterSpacing: 0.2, color: palette.amber }}>{kind}</Text>
      </View>
      <Text selectable style={{ fontSize: 15, lineHeight: 21, color: palette.ink }}>{detail}</Text>
      {children}
    </View>
  </View>;
}

/** Receipt perforation: a dashed rule across the surface. */
export function Perforation() {
  return <Svg height={2} width="100%" accessibilityElementsHidden importantForAccessibility="no">
    <Line x1="1" y1="1" x2="100%" y2="1" stroke={RING} strokeWidth={1.2} strokeDasharray="3 5" strokeLinecap="round" />
  </Svg>;
}

/** The stamp lands: slightly large and clear, settling to size on a strong ease-out. */
function stampIn(delay: number) {
  return () => {
    "worklet";
    return {
      initialValues: { opacity: 0, transform: [{ scale: 1.28 }] },
      animations: { opacity: withDelay(delay, withTiming(1, { duration: 140 })), transform: [{ scale: withDelay(delay, withTiming(1, { duration: 300, easing: EASE_OUT })) }] },
    };
  };
}

/** The receipt's seal: a blue check inside a small halftone halo (the answer's one dithered accent besides the feature glint). */
export function Seal({ stampDelay }: { stampDelay?: number }) {
  const reduced = useReduceMotionPreference();
  return <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 52, height: 52, alignItems: "center", justifyContent: "center" }}>
    {/* The halo of dots spreads in just after the stamp lands. */}
    <Animated.View entering={stampDelay !== undefined && !reduced ? FadeIn.delay(stampDelay + 80).duration(360) : undefined} style={{ position: "absolute", inset: 0 }}>
      <HalftoneGlint width={52} height={52} origin={[26, 26]} reach={[26, 26]} pitch={3} strength={0.6} style={{ top: 0, left: 0 }} />
    </Animated.View>
    <Animated.View entering={stampDelay !== undefined && !reduced ? stampIn(stampDelay) : undefined} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: palette.blue, alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(36,91,204,0.28), inset 0 1px 0 rgba(255,255,255,0.35)" }}>
      <BrandIcon name="check" size={18} color={palette.white} strokeWidth={2.4} />
    </Animated.View>
  </View>;
}

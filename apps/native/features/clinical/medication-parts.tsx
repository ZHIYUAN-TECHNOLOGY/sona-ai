import { useReduceMotionPreference } from "@/components/sona/accessibility";
import { BrandIcon } from "@/components/sona/brand-icon";
import { HalftoneGlint } from "@/components/sona/halftone-shimmer";
import { EASE_OUT, LAYOUT, riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { glass } from "@/components/sona/ui";
import { DrawnCheck, RING } from "@/components/sona/parts";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeOut, withDelay, withSpring, withTiming } from "react-native-reanimated";
import Svg, { Line } from "react-native-svg";

/**
 * Local parts for the medication review and prescribing answers: detail rows, form reveal and the
 * receipt's perforation and seal. Shared parts are re-exported from components/sona/parts.
 */
export { AlertRow, DisclosureButton, Footnote, Mark, PairGlyph, Press, StatusLine, TextLink, useLayoutSpring, type MarkState } from "@/components/sona/parts";

export function haptic(kind: "select" | "success" | "warning") {
  if (process.env.EXPO_OS !== "ios") return;
  const run = kind === "select" ? Haptics.selectionAsync() : Haptics.notificationAsync(kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
  run.catch(() => {});
}

export function Hairline({ inset = 0 }: { inset?: number }) {
  return <View style={{ height: 1, marginLeft: inset, backgroundColor: glass.hairline }} />;
}

export function Detail({ label, value }: { label: string; value: string }) {
  return <View style={{ gap: 2 }}>
    <Text style={{ ...type.caption, fontWeight: "500", color: palette.muted }}>{label}</Text>
    <Text selectable style={{ ...type.callout, color: palette.ink }}>{value}</Text>
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

/**
 * The seal grows in instead (after CRED's paid check, toned down): from 0.72 on a spring with one soft
 * overshoot (a single pulse, no second wave), so the check can draw inside it as it settles.
 */
function sealIn(delay: number) {
  return () => {
    "worklet";
    return {
      initialValues: { opacity: 0, transform: [{ scale: 0.72 }] },
      animations: { opacity: withDelay(delay, withTiming(1, { duration: 160 })), transform: [{ scale: withDelay(delay, withSpring(1, { duration: 480, dampingRatio: 0.62 })) }] },
    };
  };
}

/**
 * The receipt's seal: a blue check inside a small halftone halo (the answer's one dithered accent besides the feature glint).
 * `draw`: the circle springs in and the check strokes itself in (discharge); otherwise the stamp lands.
 */
export function Seal({ stampDelay, draw = false }: { stampDelay?: number; draw?: boolean }) {
  const reduced = useReduceMotionPreference();
  const play = stampDelay !== undefined && !reduced;
  return <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 52, height: 52, alignItems: "center", justifyContent: "center" }}>
    {/* The halo of dots spreads in just after the stamp lands. */}
    <Animated.View entering={play ? FadeIn.delay(stampDelay + (draw ? 260 : 80)).duration(360) : undefined} style={{ position: "absolute", inset: 0 }}>
      <HalftoneGlint width={52} height={52} origin={[26, 26]} reach={[26, 26]} pitch={3} strength={0.6} style={{ top: 0, left: 0 }} />
    </Animated.View>
    <Animated.View entering={play ? (draw ? sealIn : stampIn)(stampDelay) : undefined} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: palette.blue, alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(36,91,204,0.28), inset 0 1px 0 rgba(255,255,255,0.35)" }}>
      {draw ? <DrawnCheck size={18} delay={(stampDelay ?? 0) + 140} draw={play} /> : <BrandIcon name="check" size={18} color={palette.white} strokeWidth={2.4} />}
    </Animated.View>
  </View>;
}

import * as Haptics from "expo-haptics";
import { useEffect, type ReactNode } from "react";
import { Pressable, View, type AccessibilityRole, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { type CSSStyle, useAnimatedProps, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useReduceMotionPreference } from "./accessibility";
import { BrandIcon } from "./brand-icon";
import { EASE_OUT, EASE_OUT_CSS as EASE, LAYOUT } from "./motion";
import { Text } from "./text";
import { palette, type, radius } from "./theme";
import { Expand, glass, Icon, useAccessibleEffects } from "./ui";

/**
 * Shared answer parts: press targets, check marks, quiet notes, disclosures and alert rows.
 */
/** Neutral ring for an unconfirmed mark or a dashed rule. */
export const RING = "rgba(89,97,107,0.42)";
const AMBER_WASH = "rgba(139,85,24,0.08)";

/** The layout spring, or none under Reduce Motion. */
export function useLayoutSpring() { return useReduceMotionPreference() ? undefined : LAYOUT; }

/** Whole-row press target; feedback scale on press-in (120 ms), none under Reduce Motion. */
export function Press({ children, onPress, disabled = false, style, scale = 0.98, accessibilityLabel, accessibilityHint, accessibilityRole = "button", expanded, hitSlop }: { children: ReactNode; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle>; scale?: number; accessibilityLabel?: string; accessibilityHint?: string; accessibilityRole?: AccessibilityRole; expanded?: boolean; hitSlop?: PressableProps["hitSlop"] }) {
  const reduced = useReduceMotionPreference();
  return <Pressable accessibilityRole={accessibilityRole} accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} accessibilityState={{ disabled, expanded }} disabled={disabled} onPress={onPress} hitSlop={hitSlop}>
    {({ pressed }) => <Animated.View style={[style, { transform: [{ scale: pressed && !reduced ? scale : 1 }], transitionProperty: "transform", transitionDuration: 120, transitionTimingFunction: EASE }]}>{children}</Animated.View>}
  </Pressable>;
}

/**
 * A Pressable's press feedback that actually runs: plain components can't transition, so the scale
 * lives on an inner Animated view (as in `Action` and `Chip`). 120 ms; still under Reduce Motion.
 * `style` may add its own `transitionProperty` (e.g. opacity) after the default.
 */
export function PressScale({ pressed, scale = 0.96, style, children }: { pressed: boolean; scale?: number; style?: StyleProp<CSSStyle<ViewStyle>>; children?: ReactNode }) {
  const reduced = useReduceMotionPreference();
  return <Animated.View style={[{ transform: [{ scale: pressed && !reduced ? scale : 1 }], transitionProperty: "transform", transitionDuration: 120 }, style]}>{children}</Animated.View>;
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

const AnimatedPath = Animated.createAnimatedComponent(Path);
/** Length of the brand check stroke (M5 12.5 L9.5 17 L19 7 in a 24 pt box). */
const CHECK_LENGTH = 20.2;
/**
 * The brand check drawn in as a stroke (after CRED's paid check): waits `delay` ms, then draws on the
 * strong ease-out in 380 ms. Draws once, on mount; static when `draw` is off or under Reduce Motion.
 */
export function DrawnCheck({ size = 18, color = palette.white, strokeWidth = 2.4, delay = 0, draw = true }: { size?: number; color?: string; strokeWidth?: number; delay?: number; draw?: boolean }) {
  const reduced = useReduceMotionPreference();
  const still = !draw || reduced;
  const p = useSharedValue(still ? 1 : 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- plays once when the check first appears
  useEffect(() => { if (!still) p.set(withDelay(delay, withTiming(1, { duration: 380, easing: EASE_OUT }))); }, []);
  const props = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LENGTH * (1 - p.value) }));
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
    <AnimatedPath d="M5 12.5L9.5 17L19 7" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={CHECK_LENGTH} animatedProps={props} />
  </Svg>;
}

/** Mark + text, for a short status inside a surface. */
export function StatusLine({ state, children }: { state: MarkState; children: ReactNode }) {
  return <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
    <View style={{ paddingTop: 1 }}><Mark state={state} size={20} /></View>
    <Text selectable style={{ flex: 1, ...type.callout, color: palette.ink }}>{children}</Text>
  </View>;
}

/**
 * An inline note: icon and muted text, no box. Boxed `Notice` stays for warnings. `icon={null}`
 * leaves bare text (a touch tighter, with no glyph to align to) for a line that sits beside a link.
 */
export function Caption({ icon = "info.circle", color = palette.muted, children }: { icon?: string | null; color?: string; children: ReactNode }) {
  if (icon === null) return <Text selectable style={{ flex: 1, ...type.footnote, color: palette.muted }}>{children}</Text>;
  return <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
    <View style={{ paddingTop: 2 }}><Icon name={icon} size={14} color={color} /></View>
    <Text selectable style={{ flex: 1, ...type.footnote, lineHeight: 19, color: palette.muted }}>{children}</Text>
  </View>;
}

/** Quiet provenance or limit line; the medication answers' name for `Caption`. */
export const Footnote = Caption;

/** Text disclosure with a turning chevron; the body opens below it. */
export function DisclosureButton({ label, open, onToggle, accessibilityLabel }: { label: string; open: boolean; onToggle: () => void; accessibilityLabel?: string }) {
  return <View style={{ alignSelf: "flex-start" }}>
    <Press onPress={onToggle} accessibilityLabel={accessibilityLabel ?? label} expanded={open} scale={0.96} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text style={{ ...type.callout, fontWeight: "500", color: palette.blue }}>{label}</Text>
      <Animated.View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }], transitionProperty: "transform", transitionDuration: 200, transitionTimingFunction: EASE }}><Icon name="chevron.down" size={12} color={palette.blue} /></Animated.View>
    </Press>
  </View>;
}

/** Quiet secondary action: blue text only, 44 pt target. Used where a capsule would compete with the one primary. */
export function TextLink({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <View style={{ alignSelf: "flex-start" }}>
    <Press onPress={onPress} disabled={disabled} scale={0.96} style={{ minHeight: 44, justifyContent: "center", opacity: disabled ? 0.45 : 1 }}>
      <Text style={{ ...type.callout, fontWeight: "500", color: palette.blue }}>{label}</Text>
    </Press>
  </View>;
}

/** A failed write or read, said plainly in red, with Retry beside it. Never paired with a success line. */
export function ErrorLine({ text, onRetry, retryLabel = "Retry" }: { text: string; onRetry?: () => void; retryLabel?: string }) {
  return <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
    <Text selectable style={{ flex: 1, ...type.footnote, color: palette.red }}>{text}</Text>
    {onRetry && <Press onPress={onRetry} accessibilityLabel={`${retryLabel}. ${text}`} scale={0.96} style={{ minHeight: 44, justifyContent: "center" }}>
      <Text style={{ ...type.callout, fontWeight: "600", color: palette.blue }}>{retryLabel}</Text>
    </Press>}
  </View>;
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
  return <View accessible={false} style={{ flexDirection: "row", gap: 12, padding: 14, borderRadius: radius.group, borderCurve: "continuous", backgroundColor: "rgba(139,85,24,0.05)" }}>
    <PairGlyph status="alert" />
    <View style={{ flex: 1, gap: 6 }}>
      <View style={{ gap: 2 }}>
        <Text selectable style={{ ...type.body, lineHeight: 22, fontWeight: "600", color: palette.ink }}>{title}</Text>
        <Text style={{ ...type.caption, fontWeight: "600", letterSpacing: 0.2, color: palette.amber }}>{kind}</Text>
      </View>
      <Text selectable style={{ ...type.callout, color: palette.ink }}>{detail}</Text>
      {children}
    </View>
  </View>;
}

/** Round icon well that anchors a row (same width as the evidence icons below it, so they line up). */
export function IconDisc({ icon }: { icon: string }) {
  return <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: palette.canvas, alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={17} /></View>;
}

/**
 * A row inside a surface that opens in place (after CRED's policy-card unstack): the header
 * presses to 0.98, its chevron turns on a 240 ms ease-out, the body unfolds with `Expand` on the
 * layout spring and every row below glides on the same spring.
 */
export function Disclosure({ icon, title, detail, open, onToggle, first = false, accessibilityLabel, accessibilityHint, children }: {
  icon: string; title: string; detail?: string; open: boolean; onToggle: () => void; first?: boolean;
  accessibilityLabel?: string; accessibilityHint?: string; children: ReactNode;
}) {
  const { reducedMotion } = useAccessibleEffects();
  return <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={first ? undefined : { borderTopWidth: 1, borderColor: glass.hairline }}>
    <Press accessibilityLabel={accessibilityLabel ?? (detail ? `${title}. ${detail}` : title)} accessibilityHint={accessibilityHint} expanded={open}
      onPress={() => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); onToggle(); }}
      style={{ flexDirection: "row", alignItems: detail ? "flex-start" : "center", gap: 12, paddingVertical: 14 }}>
      <IconDisc icon={icon} />
      <View style={{ flex: 1, gap: 2, paddingTop: detail ? 1 : 0 }}>
        <Text style={{ ...type.body, lineHeight: 22, fontWeight: "600", color: palette.ink }}>{title}</Text>
        {detail && <Text style={{ ...type.subhead, color: palette.muted }}>{detail}</Text>}
      </View>
      <View style={{ paddingTop: detail ? 4 : 0 }}>
        <Animated.View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }], transitionProperty: "transform", transitionDuration: reducedMotion ? 0 : 240, transitionTimingFunction: EASE }}>
          <Icon name="chevron.down" size={14} color={palette.muted} />
        </Animated.View>
      </View>
    </Press>
    {open && <Expand style={{ gap: 16, paddingBottom: 18 }}>{children}</Expand>}
  </Animated.View>;
}

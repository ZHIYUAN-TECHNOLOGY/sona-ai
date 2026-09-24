import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Pressable, View, type AccessibilityRole, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { useReduceMotionPreference } from "./accessibility";
import { BrandIcon } from "./brand-icon";
import { LAYOUT } from "./motion";
import { Text } from "./text";
import { palette } from "./theme";
import { Expand, glass, Icon, useAccessibleEffects } from "./ui";

/**
 * Shared answer parts: press targets, check marks, quiet notes, disclosures and alert rows.
 * `EASE_OUT` in motion.ts is a worklet easing; CSS transitions need this `cubicBezier` form of the same curve.
 */
const EASE = cubicBezier(0.23, 1, 0.32, 1);
/** Neutral ring for an unconfirmed mark or a dashed rule. */
export const RING = "rgba(89,97,107,0.42)";
const AMBER_WASH = "rgba(139,85,24,0.08)";

/** The layout spring, or none under Reduce Motion. */
export function useLayoutSpring() { return useReduceMotionPreference() ? undefined : LAYOUT; }

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

/**
 * An inline note: icon and muted text, no box. Boxed `Notice` stays for warnings. `icon={null}`
 * leaves bare text (a touch tighter, with no glyph to align to) for a line that sits beside a link.
 */
export function Caption({ icon = "info.circle", color = palette.muted, children }: { icon?: string | null; color?: string; children: ReactNode }) {
  if (icon === null) return <Text selectable style={{ flex: 1, fontSize: 13, lineHeight: 18, color: palette.muted }}>{children}</Text>;
  return <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
    <View style={{ paddingTop: 2 }}><Icon name={icon} size={14} color={color} /></View>
    <Text selectable style={{ flex: 1, fontSize: 13, lineHeight: 19, color: palette.muted }}>{children}</Text>
  </View>;
}

/** Quiet provenance or limit line; the medication answers' name for `Caption`. */
export const Footnote = Caption;

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
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? (detail ? `${title}. ${detail}` : title)} accessibilityHint={accessibilityHint} accessibilityState={{ expanded: open }}
      onPress={() => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); onToggle(); }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: detail ? "flex-start" : "center", gap: 12, paddingVertical: 14, transform: [{ scale: pressed ? 0.98 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
      <IconDisc icon={icon} />
      <View style={{ flex: 1, gap: 2, paddingTop: detail ? 1 : 0 }}>
        <Text style={{ fontSize: 16, lineHeight: 22, fontWeight: "600", color: palette.ink }}>{title}</Text>
        {detail && <Text style={{ fontSize: 14, lineHeight: 20, color: palette.muted }}>{detail}</Text>}
      </View>
      <View style={{ paddingTop: detail ? 4 : 0 }}>
        <Animated.View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }], transitionProperty: "transform", transitionDuration: reducedMotion ? 0 : 240, transitionTimingFunction: EASE }}>
          <Icon name="chevron.down" size={14} color={palette.muted} />
        </Animated.View>
      </View>
    </Pressable>
    {open && <Expand style={{ gap: 16, paddingBottom: 18 }}>{children}</Expand>}
  </Animated.View>;
}

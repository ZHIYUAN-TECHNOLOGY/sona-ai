import { useReduceMotionPreference, useReduceTransparencyPreference } from "@/components/sona/accessibility";
import { Text } from "@/components/sona/text";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Image } from "expo-image";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeInDown, FadeOut, type AnimatedStyle, type LayoutAnimationFunction } from "react-native-reanimated";
import { BrandIcon, type BrandIconName } from "./brand-icon";
import { PHOSPHOR } from "./icons";
import type { IconWeight } from "phosphor-react-native";
import { HalftoneGlint } from "./halftone-shimmer";
import { useCapturedSource } from "./sources";
import { fold, LAYOUT, unfold } from "./motion";
import { palette, type, radius } from "./theme";

export function useAccessibleEffects() {
  return { reducedMotion: useReduceMotionPreference(), reducedTransparency: useReduceTransparencyPreference() };
}
export function Glass({ children, style, opaque = false }: { children?: ReactNode; style?: StyleProp<ViewStyle>; opaque?: boolean }) {
  const { reducedTransparency } = useAccessibleEffects();
  const base: StyleProp<ViewStyle> = [{ borderRadius: radius.card, borderCurve: "continuous", overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.8)" }, style];
  if (opaque || reducedTransparency) return <View style={[base, { backgroundColor: palette.surface }]}>{children}</View>;
  // Frost under the glass keeps content behind floating panels from competing with their text.
  if (process.env.EXPO_OS === "ios" && isLiquidGlassAvailable()) return <View style={[base, { borderWidth: 0 }]}>
    <BlurView tint="systemThinMaterialLight" intensity={70} style={StyleSheet.absoluteFill} />
    <GlassView colorScheme="light" glassEffectStyle="regular" tintColor="rgba(250,251,255,0.45)" style={[StyleSheet.absoluteFill, { borderRadius: radius.card }]} />
    {children}
  </View>;
  return <BlurView tint="light" intensity={35} style={[base, { backgroundColor: "rgba(249,251,255,0.72)" }]}>{children}</BlurView>;
}
/**
 * One icon by its SF Symbol name, drawn from Phosphor (./icons). Phosphor draws inside a 1/16 margin, so it is scaled
 * up a little to sit like the SF glyph it replaces in the same box; small icons take the bold weight to keep their
 * line. `weight` overrides (a key's glyph is duotone: its soft fill keeps it off a disc of the same grey).
 */
export function Icon({ name, size = 21, color = palette.ink, weight, duotoneColor }: { name: string; size?: number; color?: string; weight?: IconWeight; duotoneColor?: string }) {
  const p = PHOSPHOR[name];
  if (!p) return <Image source={`sf:${name}`} style={{ width: size, height: size }} tintColor={color} accessibilityElementsHidden />;
  const Glyph = p.icon;
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
    <Glyph size={Math.round(size * 1.14)} color={color} weight={weight ?? p.weight ?? (size < 16 ? "bold" : "regular")} duotoneColor={duotoneColor} duotoneOpacity={duotoneColor ? 0.28 : undefined} />
  </View>;
}
export function Label({ children, muted = false }: { children: ReactNode; muted?: boolean }) { return <Text selectable style={{ color: muted ? palette.muted : palette.blue, ...type.overline }}>{children}</Text>; }
export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) { return <Text selectable style={{ color: muted ? palette.muted : palette.ink, ...type.body }}>{children}</Text>; }
export function Title({ children }: { children: ReactNode }) { return <Text selectable accessibilityRole="header" style={{ color: palette.ink, ...type.title, fontWeight: "600" }}>{children}</Text>; }
/**
 * Primary: ink capsule with a dotted glint (the brand's dithering, kept to the action that matters).
 * Secondary: a quiet glass capsule. Both press to 0.96.
 */
export function Action({ label, icon, onPress, secondary = false, disabled = false, accessibilityLabel }: { label: string; icon?: string; onPress: () => void; secondary?: boolean; disabled?: boolean; accessibilityLabel?: string }) {
  const reduced = useReduceMotionPreference();
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
   >{({ pressed }) => <Animated.View style={{ minHeight: 46, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 23, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, borderWidth: 1, borderColor: secondary ? glass.rim : palette.dark, backgroundColor: secondary ? "rgba(233,238,246,0.85)" : palette.dark, boxShadow: secondary ? `inset 0 1px 0 ${palette.white}` : "0 6px 16px rgba(24,32,48,0.16)", opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed && !reduced ? 0.96 : 1 }], transitionProperty: ["transform", "opacity"], transitionDuration: 120 } as never}>
    {!secondary && !disabled && <View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: radius.group, overflow: "hidden" }}><HalftoneGlint width={72} height={46} origin={[10, 2]} reach={[64, 40]} pitch={3} strength={0.7} tint={[0.62, 0.78, 1]} hueShift={0.6} style={{ top: 0, left: 0 }} /></View>}
    {icon && <Icon name={icon} size={17} color={secondary ? palette.ink : palette.white} />}<Text style={{ color: secondary ? palette.ink : palette.white, ...type.subhead, fontWeight: "600", flexShrink: 1 }}>{label}</Text>
  </Animated.View>}</Pressable>;
}
export function IconButton({ name, label, onPress, dark = false }: { name: string; label: string; onPress: () => void; dark?: boolean }) {
  const reduced = useReduceMotionPreference();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>{({ pressed }) => <Animated.View style={{ minWidth: 46, minHeight: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: dark ? palette.dark : "transparent", transform: [{ scale: pressed && !reduced ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never}><Icon name={name} color={dark ? palette.white : palette.ink} /></Animated.View>}</Pressable>;
}
/**
 * Every round icon button that floats in the shell (the top bar, the bar's + and keyboard, the composer's tools) is the
 * same liquid glass: native on iOS 26+ (it answers the touch itself), a frosted disc before that, solid with Reduce
 * Transparency. Wider content (the patient chip) keeps the round ends.
 */
export function GlassButton({ label, onPress, size = 50, onGlass = false, children }: { label: string; onPress: () => void; size?: number; /** On another glass surface (the composer): a whiter tint and a hairline, so the disc still reads. */ onGlass?: boolean; children: ReactNode }) {
  const { reducedMotion, reducedTransparency } = useAccessibleEffects();
  const liquid = process.env.EXPO_OS === "ios" && isLiquidGlassAvailable() && !reducedTransparency;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}>
    {({ pressed }) => <Animated.View style={{ minWidth: size, height: size, borderRadius: size / 2, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: liquid ? "transparent" : reducedTransparency ? "rgba(255,255,255,0.97)" : onGlass ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.72)", borderWidth: liquid && !onGlass ? 0 : 1, borderColor: onGlass ? "rgba(20,28,40,0.07)" : "rgba(255,255,255,0.9)", boxShadow: liquid && !onGlass ? undefined : "0 3px 10px rgba(40,70,140,0.10)", transform: [{ scale: pressed && !reducedMotion ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never}>
      {liquid && <GlassView colorScheme="light" glassEffectStyle="regular" isInteractive tintColor={onGlass ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.2)"} style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]} />}
      {children}
    </Animated.View>}
  </Pressable>;
}
/** A pushed page's back chevron, on the left (`label`: what going back does, e.g. the consultation's "Minimize to encounter"). */
export function BackButton({ label = "Return to previous screen" }: { label?: string }) {
  return <IconButton name="chevron.left" label={label} onPress={() => router.canGoBack() ? router.back() : router.replace("/")} />;
}
/** A modal's or sheet's one close control, on the right (pushed pages get the back chevron on the left). */
export function CloseButton({ label = "Close" }: { label?: string }) {
  return <IconButton name="xmark" label={label} onPress={() => router.canGoBack() ? router.back() : router.replace("/")} />;
}

/**
 * Surfaces. Content sits on frosted cards (milky white, bright rim, inner highlight, soft
 * layered shadow; no live blur so long lists stay cheap). Real glass is reserved for chrome
 * floating over content (top bar, dock, composer). A `feature` surface is the one card on a
 * screen that asks for action or carries Sona's proposal: a touch brighter, blue-tinted lift,
 * and a halftone glint in its top-right corner.
 */
export const glass = { fill: "rgba(255,255,255,0.5)", rim: "rgba(255,255,255,0.9)", hairline: "rgba(20,28,40,0.07)" };
// Glass reads as glass only with colour behind it: a translucent fill that is brighter at the top
// edge (light catching it) and lets the aurora canvas tint through lower down.
const glassFill = "linear-gradient(160deg, rgba(255,255,255,0.66) 0%, rgba(255,255,255,0.36) 50%, rgba(238,244,255,0.28) 100%)";
// Glass edge: hairline outline, a sheen along the top, a faint blue catch along the bottom, soft blue lift.
const glassEdge = "0 0 0 0.5px rgba(20,28,40,0.06), 0 12px 32px rgba(40,70,140,0.10), inset 0 1px 0 rgba(255,255,255,1), inset 0 10px 18px -12px rgba(255,255,255,0.95), inset 0 -12px 22px -14px rgba(90,130,220,0.18)";
export const surfaceStyle: ViewStyle = { borderRadius: radius.card, borderCurve: "continuous", borderWidth: 1, borderColor: glass.rim, backgroundColor: "transparent", experimental_backgroundImage: glassFill, boxShadow: glassEdge };
/** Small floating controls (pills, round buttons) on the same material. */
export const pillStyle: ViewStyle = { borderWidth: 1, borderColor: glass.rim, backgroundColor: "transparent", experimental_backgroundImage: glassFill, boxShadow: "0 0 0 0.5px rgba(20,28,40,0.06), 0 4px 14px rgba(40,70,140,0.1), inset 0 1px 0 #FFFFFF, inset 0 -8px 14px -10px rgba(90,130,220,0.16)" };
const featureSurface: ViewStyle = { experimental_backgroundImage: "linear-gradient(160deg, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.48) 50%, rgba(226,236,255,0.42) 100%)", boxShadow: "0 0 0 0.5px rgba(36,91,204,0.10), 0 16px 38px rgba(36,91,204,0.16), inset 0 1px 0 #FFFFFF, inset 0 12px 20px -14px rgba(255,255,255,1), inset 0 -14px 24px -14px rgba(90,130,220,0.24)" };
export function Surface({ children, feature = false, style, layout }: { children?: ReactNode; feature?: boolean; style?: StyleProp<AnimatedStyle<ViewStyle>>; layout?: typeof LAYOUT | LayoutAnimationFunction }) {
  return <Animated.View layout={layout} style={[surfaceStyle, feature && featureSurface, style]}>
    {feature && <View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: radius.group, overflow: "hidden" }}><HalftoneGlint width={170} height={90} origin={[170, 0]} reach={[160, 84]} strength={0.5} style={{ top: 0, right: 0 }} /></View>}
    {children}
  </Animated.View>;
}

/** Opens in place under its trigger: the clip grows on the same spring as `layout={LAYOUT}` siblings, so the card and everything below move as one. */
export function Expand({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReduceMotionPreference();
  return <Animated.View entering={reduced ? FadeIn.duration(150) : unfold} exiting={reduced ? FadeOut.duration(120) : fold} layout={reduced ? undefined : LAYOUT} style={[{ overflow: "hidden" }, style]}>{children}</Animated.View>;
}

/** Round commit button (send, add): a glass bubble until it can act, then ink with a dotted glint. */
export function RoundAction({ icon, label, ready, onPress, size = 36, hint }: { icon: BrandIconName; label: string; ready: boolean; onPress: () => void; size?: number; hint?: string }) {
  const reduced = useReduceMotionPreference();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ disabled: !ready }} disabled={!ready} onPress={onPress} hitSlop={6}
   >{({ pressed }) => <Animated.View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: ready ? palette.ink : glass.hairline, backgroundColor: ready ? palette.ink : "rgba(20,28,40,0.035)", transform: [{ scale: pressed && !reduced ? 0.96 : 1 }], transitionProperty: ["transform", "backgroundColor", "borderColor"], transitionDuration: 160 } as never}>
    <Animated.View pointerEvents="none" style={{ position: "absolute", inset: 0, opacity: ready ? 1 : 0, transitionProperty: "opacity", transitionDuration: 200 } as never}>
      <HalftoneGlint width={size} height={size} origin={[size * 0.2, size * 0.14]} reach={[size * 0.72, size * 0.6]} pitch={3} strength={0.8} tint={[0.62, 0.78, 1]} hueShift={0.6} />
    </Animated.View>
    <BrandIcon name={icon} size={size * 0.47} color={ready ? palette.white : palette.placeholder} strokeWidth={2} />
  </Animated.View>}</Pressable>;
}

/** Pill control. `filled` shows a chosen value (blue wash), `selected` a picked option (ink), `expanded` the pill whose options are open. */
export function Chip({ label, icon, filled = false, selected = false, expanded, onPress, accessibilityLabel }: { label: string; icon?: ReactNode; filled?: boolean; selected?: boolean; expanded?: boolean; onPress: () => void; accessibilityLabel?: string }) {
  const reduced = useReduceMotionPreference();
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected, expanded }} onPress={onPress} hitSlop={{ top: 2, bottom: 2 }}
   >{({ pressed }) => <Animated.View style={{ minHeight: 40, paddingHorizontal: icon ? 13 : 15, borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: expanded ? palette.blue : selected ? palette.ink : filled ? "rgba(36,91,204,0.14)" : glass.hairline, backgroundColor: selected ? palette.ink : filled ? "#E6EEFC" : "rgba(244,246,250,0.9)", boxShadow: selected || filled ? undefined : `inset 0 1px 0 ${palette.white}`, transform: [{ scale: pressed && !reduced ? 0.96 : 1 }], transitionProperty: ["transform", "backgroundColor", "borderColor"], transitionDuration: 150 } as never}>
    {icon}
    <Animated.Text key={label} entering={FadeIn.duration(160)} style={{ ...type.callout, fontWeight: "500", color: selected ? palette.white : filled ? palette.blue : palette.ink }}>{label}</Animated.Text>
  </Animated.View>}</Pressable>;
}

export function Card({ children, label, title, footer, feature = false }: { children: ReactNode; label?: string; title?: string; footer?: ReactNode; feature?: boolean }) {
  return <Surface feature={feature} style={{ padding: 20, gap: 14 }}>{label && <Label>{label}</Label>}{title && <Title>{title}</Title>}{children}{footer && <View style={{ paddingTop: 12, borderTopWidth: 1, borderColor: glass.hairline }}>{footer}</View>}</Surface>;
}
export function SourceLink({ label = "View source", onPress }: { label?: string; onPress: () => void }) {
  // Inside a section, sources gather into that section's one pill instead of drawing links.
  if (useCapturedSource({ label, onPress })) return null;
  return <Pressable accessibilityRole="button" onPress={onPress} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7 }}><Icon name="doc.text" color={palette.blue} size={15} /><Text style={{ ...type.footnote, color: palette.blue, fontWeight: "500", flexShrink: 1 }}>{label}</Text><Icon name="arrow.up.right" color={palette.blue} size={11} /></Pressable>;
}
export function Notice({ children, warning = false }: { children: ReactNode; warning?: boolean }) { return <View style={{ backgroundColor: warning ? "rgba(244,235,221,0.85)" : "rgba(226,235,250,0.75)", borderWidth: 1, borderColor: "rgba(255,255,255,0.8)", borderRadius: radius.group, borderCurve: "continuous", padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 9 }}><Icon name={warning ? "exclamationmark.circle" : "info.circle"} color={warning ? palette.amber : palette.blue} size={17} /><Text selectable style={{ color: warning ? palette.amber : palette.muted, ...type.footnote, lineHeight: 20, flex: 1 }}>{children}</Text></View>; }
/** The page canvas: soft blue, lilac and teal fields over pale grey, so glass has something to show. */
export const canvasImage = "radial-gradient(circle at 8% 4%, rgba(150,190,255,0.38) 0%, rgba(150,190,255,0) 42%), radial-gradient(circle at 96% 38%, rgba(196,176,255,0.26) 0%, rgba(196,176,255,0) 40%), radial-gradient(circle at 20% 92%, rgba(150,220,235,0.26) 0%, rgba(150,220,235,0) 45%), linear-gradient(to bottom, #F5F6F8 0%, #EFF2F7 45%, #E3EBF7 100%)";

/**
 * Every page's scroll container: the aurora canvas, 20 pt margins and 18 pt between blocks. `bottom` pins a
 * glass decision bar above the home indicator (review pages keep their one decision in view); the
 * content gets matching space at its end so nothing hides under it.
 */
export function Screen({ children, bottom }: { children: ReactNode; bottom?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [barHeight, setBarHeight] = useState(0);
  const scroll = <ScrollView style={{ flex: 1, backgroundColor: palette.canvas, experimental_backgroundImage: canvasImage }} contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 44, gap: 18 }}>{children}{bottom ? <View style={{ height: barHeight }} /> : null}</ScrollView>;
  if (!bottom) return scroll;
  return <View style={{ flex: 1 }}>
    {scroll}
    <View onLayout={e => setBarHeight(e.nativeEvent.layout.height)} style={{ position: "absolute", left: 16, right: 16, bottom: Math.max(insets.bottom, 12) }}>
      <Glass style={{ padding: 12, gap: 10 }}>{bottom}</Glass>
    </View>
  </View>;
}

/** Meaning colours for an insight: red must not wait, amber soon or blocked, green done or safe, blue the next step. */
export const tone = { urgent: palette.red, soon: palette.amber, good: palette.green, next: palette.blue } as const;
/** The part of an insight that matters, in its meaning colour. */
export function Tone({ of, children }: { of: keyof typeof tone; children: ReactNode }) { return <Text style={{ color: tone[of] }}>{children}</Text>; }

/**
 * Insight first: the line a page opens with, answering "does anything need me?" in one sentence
 * ("<Tone of="urgent">2 discharges blocked</Tone> · 14 bed-hours waiting"). The eyebrow gives context above it.
 * It is the page's heading, so the native title stays a short noun and nothing repeats it.
 */
export function Insight({ eyebrow, children }: { eyebrow?: string; children: ReactNode }) {
  return <View style={{ gap: 4 }}>
    {eyebrow ? <Text style={{ ...type.footnote, fontWeight: "500", color: palette.muted }}>{eyebrow}</Text> : null}
    <Text selectable accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{children}</Text>
  </View>;
}
export function Reveal({ children }: { children: ReactNode }) { const reduced = useReduceMotionPreference(); return <Animated.View entering={reduced ? undefined : FadeInDown.duration(220)} style={{ gap: 14 }}>{children}</Animated.View>; }
export function CanvasBackground() { return <LinearGradient pointerEvents="none" colors={[palette.canvas, palette.canvas, "#DDE5EF", "#CDDEF5"]} locations={[0, 0.35, 0.72, 1]} style={{ position: "absolute", inset: 0 }} />; }

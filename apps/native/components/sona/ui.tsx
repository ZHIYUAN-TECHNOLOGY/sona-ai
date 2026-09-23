import { useReduceMotionPreference } from "@/components/sona/accessibility";
import { Text } from "@/components/sona/text";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Pressable, ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { palette } from "./theme";

export function useAccessibleEffects() {
  const reducedMotion = useReduceMotionPreference();
  const [reducedTransparency, setReducedTransparency] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceTransparencyEnabled().then(setReducedTransparency);
    const sub = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReducedTransparency);
    return () => sub.remove();
  }, []);
  return { reducedMotion, reducedTransparency };
}
export function Glass({ children, style, opaque = false }: { children?: ReactNode; style?: StyleProp<ViewStyle>; opaque?: boolean }) {
  const { reducedTransparency } = useAccessibleEffects();
  const base: StyleProp<ViewStyle> = [{ borderRadius: 26, borderCurve: "continuous", overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.8)" }, style];
  if (opaque || reducedTransparency) return <View style={[base, { backgroundColor: palette.surface }]}>{children}</View>;
  if (process.env.EXPO_OS === "ios" && isLiquidGlassAvailable()) return <GlassView colorScheme="light" glassEffectStyle="regular" tintColor="rgba(248,250,255,0.3)" style={base}>{children}</GlassView>;
  return <BlurView tint="light" intensity={35} style={[base, { backgroundColor: "rgba(249,251,255,0.72)" }]}>{children}</BlurView>;
}
export function Icon({ name, size = 21, color = palette.ink }: { name: string; size?: number; color?: string }) {
  return <Image source={`sf:${name}`} style={{ width: size, height: size }} tintColor={color} accessibilityElementsHidden />;
}
export function Label({ children, muted = false }: { children: ReactNode; muted?: boolean }) { return <Text selectable style={{ color: muted ? palette.muted : palette.blue, fontSize: 11, fontWeight: "700", letterSpacing: 1.6, textTransform: "uppercase" }}>{children}</Text>; }
export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) { return <Text selectable style={{ color: muted ? palette.muted : palette.ink, fontSize: 16, lineHeight: 24 }}>{children}</Text>; }
export function Title({ children }: { children: ReactNode }) { return <Text selectable style={{ color: palette.ink, fontSize: 23, lineHeight: 29, fontWeight: "600", letterSpacing: -0.6 }}>{children}</Text>; }
export function Action({ label, icon, onPress, secondary = false, disabled = false, accessibilityLabel }: { label: string; icon?: string; onPress: () => void; secondary?: boolean; disabled?: boolean; accessibilityLabel?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ minHeight: 46, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 24, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: secondary ? "#E9EDF4" : palette.dark, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 })}>
    {icon && <Icon name={icon} size={17} color={secondary ? palette.ink : palette.white} />}<Text style={{ color: secondary ? palette.ink : palette.white, fontSize: 14, fontWeight: "600", flexShrink: 1 }}>{label}</Text>
  </Pressable>;
}
export function IconButton({ name, label, onPress, dark = false }: { name: string; label: string; onPress: () => void; dark?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ minWidth: 46, minHeight: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: dark ? palette.dark : "transparent", opacity: pressed ? 0.65 : 1 })}><Icon name={name} color={dark ? palette.white : palette.ink} /></Pressable>;
}
export function Card({ children, label, title, footer }: { children: ReactNode; label?: string; title?: string; footer?: ReactNode }) {
  return <View style={{ backgroundColor: palette.surface, borderRadius: 24, borderCurve: "continuous", padding: 20, gap: 14, boxShadow: "0 6px 24px rgba(24,32,48,0.06)" }}>{label && <Label>{label}</Label>}{title && <Title>{title}</Title>}{children}{footer && <View style={{ paddingTop: 12, borderTopWidth: 1, borderColor: palette.line }}>{footer}</View>}</View>;
}
export function SourceLink({ label = "View source", onPress }: { label?: string; onPress: () => void }) { return <Pressable accessibilityRole="button" onPress={onPress} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7 }}><Icon name="doc.text" color={palette.blue} size={15} /><Text style={{ fontSize: 13, color: palette.blue, fontWeight: "500", flexShrink: 1 }}>{label}</Text><Icon name="arrow.up.right" color={palette.blue} size={11} /></Pressable>; }
export function Notice({ children, warning = false }: { children: ReactNode; warning?: boolean }) { return <View style={{ backgroundColor: warning ? "#F4EBDD" : "#E8EFF9", borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 9 }}><Icon name={warning ? "exclamationmark.circle" : "info.circle"} color={warning ? palette.amber : palette.blue} size={17} /><Text selectable style={{ color: warning ? palette.amber : palette.muted, fontSize: 13, lineHeight: 20, flex: 1 }}>{children}</Text></View>; }
export function Screen({ children }: { children: ReactNode }) { return <ScrollView style={{ flex: 1, backgroundColor: palette.canvas }} contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 44, gap: 18 }}>{children}</ScrollView>; }
export function Reveal({ children }: { children: ReactNode }) { const reduced = useReduceMotionPreference(); return <Animated.View entering={reduced ? undefined : FadeInDown.duration(220)} style={{ gap: 14 }}>{children}</Animated.View>; }
export function CanvasBackground() { return <LinearGradient pointerEvents="none" colors={[palette.canvas, palette.canvas, "#DDE5EF", "#CDDEF5"]} locations={[0, 0.35, 0.72, 1]} style={{ position: "absolute", inset: 0 }} />; }

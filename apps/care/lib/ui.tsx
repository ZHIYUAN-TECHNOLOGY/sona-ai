import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from "react-native";
import { HalftoneGlint } from "./halftone";
import { palette, type } from "./theme";

/**
 * Sona's design system for Sona Care (mirrors apps/native/components/sona/ui.tsx):
 * frosted glass cards on the calm canvas; one `feature` card per screen for the thing that needs
 * the patient now (brighter, blue lift, a halftone glint in its corner); an ink primary action with
 * a dotted glint, and quiet glass for everything else. Press feedback is a 0.96 scale.
 * ponytail: mirrored, not shared; move both apps' copies to a shared UI package once they settle.
 */
const glassFill = "linear-gradient(160deg, rgba(255,255,255,0.66) 0%, rgba(255,255,255,0.36) 50%, rgba(238,244,255,0.28) 100%)";
const glassEdge = "0 0 0 0.5px rgba(20,28,40,0.06), 0 12px 32px rgba(40,70,140,0.10), inset 0 1px 0 rgba(255,255,255,1), inset 0 10px 18px -12px rgba(255,255,255,0.95), inset 0 -12px 22px -14px rgba(90,130,220,0.18)";
export const surfaceStyle: ViewStyle = { borderRadius: 24, borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(255,255,255,0.9)", backgroundColor: "transparent", experimental_backgroundImage: glassFill, boxShadow: glassEdge } as ViewStyle;
const featureStyle: ViewStyle = { experimental_backgroundImage: "linear-gradient(160deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.5) 50%, rgba(226,236,255,0.44) 100%)", boxShadow: "0 0 0 0.5px rgba(36,91,204,0.10), 0 16px 38px rgba(36,91,204,0.16), inset 0 1px 0 #FFFFFF, inset 0 12px 20px -14px rgba(255,255,255,1), inset 0 -14px 24px -14px rgba(90,130,220,0.24)" } as ViewStyle;

export function Card({ children, feature = false, style }: { children: ReactNode; feature?: boolean; style?: ViewStyle }) {
  return <View style={[surfaceStyle, feature && featureStyle, { padding: 18, gap: 12 }, style]}>
    {feature && <View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: 23, overflow: "hidden" }}><HalftoneGlint width={170} height={90} origin={[170, 0]} reach={[160, 84]} strength={0.5} style={{ top: 0, right: 0 }} /></View>}
    {children}
  </View>;
}

/** Primary: ink capsule with a dotted glint (only the action that matters). `quiet`: a glass capsule. */
export function Button({ label, onPress, busy, disabled, quiet }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; quiet?: boolean }) {
  const off = disabled || busy;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: off, busy }} disabled={off} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 48, borderRadius: 24, paddingHorizontal: 20, overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 1,
      borderColor: quiet ? "rgba(255,255,255,0.9)" : palette.dark, backgroundColor: quiet ? "rgba(233,238,246,0.85)" : palette.dark, opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
    {!quiet && !disabled && <HalftoneGlint width={72} height={48} origin={[10, 2]} reach={[64, 40]} pitch={3} strength={0.7} tint={[0.62, 0.78, 1]} hueShift={0.6} style={{ top: 0, left: 0 }} />}
    {busy ? <ActivityIndicator color={quiet ? palette.ink : palette.white} /> : <Text style={{ fontSize: 16, fontWeight: "600", color: quiet ? palette.ink : palette.white }}>{label}</Text>}
  </Pressable>;
}

/** A tappable row inside a card: what it is, one line of state, and where it goes. */
export function Row({ title, line, tone = "muted", onPress, first }: { title: string; line: string; tone?: "muted" | "amber" | "red" | "green"; onPress: () => void; first?: boolean }) {
  const color = tone === "muted" ? palette.muted : palette[tone];
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${line}`} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderColor: "rgba(20,28,40,0.06)", opacity: pressed ? 0.6 : 1 })}>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ ...type.headline, color: palette.ink }}>{title}</Text>
      <Text numberOfLines={1} style={{ ...type.footnote, fontWeight: tone === "muted" ? "400" : "600", color }}>{line}</Text>
    </View>
    <Text style={{ fontSize: 20, color: palette.muted }}>›</Text>
  </Pressable>;
}

export function Title({ overline, children, line }: { overline?: string; children: ReactNode; line?: string }) {
  return <View style={{ gap: 6 }}>
    {overline && <Text style={{ ...type.overline, color: palette.blue }}>{overline}</Text>}
    <Text accessibilityRole="header" style={{ ...type.display, fontWeight: "600", color: palette.ink }}>{children}</Text>
    {line && <Text style={{ ...type.body, color: palette.muted }}>{line}</Text>}
  </View>;
}

export const field = { minHeight: 48, borderRadius: 14, paddingHorizontal: 14, fontSize: 16, color: palette.ink, backgroundColor: "rgba(20,28,40,0.05)" } as const;

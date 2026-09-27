import { router, usePathname } from "expo-router";
import { Pressable, View, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMe } from "@/features/me";
import Svg, { Path, Rect } from "react-native-svg";
import { orbPad, SonaOrb } from "./orb";
import { palette } from "./theme";

/**
 * The floating dock (after the Sona Care reference kit): a glass pill with the three places a patient
 * goes (home, medicines, visits) and, apart from it, the Sona orb, which opens Ask Sona Care. Shown on
 * those three screens only, once the patient has linked their record; screens under it keep `DOCK_SPACE` of bottom padding.
 */
export const DOCK_SPACE = 104;
const TABS = [
  { path: "/", label: "Home", d: "m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10" },
  { path: "/discharge", label: "My medicines", d: "m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7ZM8.5 8.5l7 7" },
  { path: "/follow-ups", label: "My visits", d: "M16 2v4M8 2v4M3 10h18" },
] as const;
const ORB = 58;

export function Dock() {
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const { state } = useMe();
  if (state !== "joined" || !TABS.some(t => t.path === path)) return null;
  const glass: ViewStyle = { backgroundColor: "rgba(255,255,255,0.74)", borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", boxShadow: "0 14px 28px -14px rgba(80,60,140,0.5)" };
  return <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(120)} pointerEvents="box-none"
    style={{ position: "absolute", left: 18, right: 18, bottom: Math.max(insets.bottom, 12) + 6, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
    <View style={[glass, { flexDirection: "row", gap: 4, padding: 6, borderRadius: 999 }]}>
      {TABS.map(t => {
        const on = t.path === path;
        return <Pressable key={t.path} accessibilityRole="tab" accessibilityLabel={t.label} accessibilityState={{ selected: on }} onPress={() => { if (!on) router.navigate(t.path); }}
          style={({ pressed }) => ({ width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: on ? palette.dark : "transparent", transform: [{ scale: pressed ? 0.94 : 1 }] })}>
          <Svg width={21} height={21} viewBox="0 0 24 24" fill="none" stroke={on ? palette.white : palette.muted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            {t.path === "/follow-ups" && <Rect x={3} y={4} width={18} height={18} rx={3} />}
            <Path d={t.d} />
          </Svg>
        </Pressable>;
      })}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Ask Sona Care" accessibilityHint="Quick answers from your discharge plan" onPress={() => router.push("/assistant")}
      style={({ pressed }) => ({ width: ORB + 8, height: ORB + 8, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.94 : 1 }] })}>
      <View pointerEvents="none" style={{ margin: -orbPad(ORB) }}><SonaOrb size={ORB} /></View>
    </Pressable>
  </Animated.View>;
}

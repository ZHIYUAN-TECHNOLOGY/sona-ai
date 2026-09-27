import { router, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { useMe } from "@/features/me";
import { orbPad, SonaOrb } from "./orb";
import { Text } from "./text";
import { palette } from "./theme";

/**
 * The bottom bar (after the Life OS dashboard): a black home button; a blue pill whose search opens
 * Doctors, with ››› leading to the Sona orb, which opens Ask Sona Care; and a grid button that opens
 * the menu of every place in the app (Life OS menu: rows, the current one in blue with a check).
 * Shown on the main screens once the patient has linked their record; screens under it keep
 * `DOCK_SPACE` of bottom padding.
 */
export const DOCK_SPACE = 112;
const SHOWN = ["/", "/discharge", "/follow-ups", "/doctors"];
const MENU = [
  { path: "/", label: "Home", d: "m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10" },
  { path: "/assistant", label: "Ask Sona Care", d: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z" },
  { path: "/doctors", label: "Doctors", d: "M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3M8 15v1a6 6 0 0 0 6 6a6 6 0 0 0 6-6v-4M20 10a2 2 0 1 0 0 4a2 2 0 0 0 0-4" },
  { path: "/follow-ups", label: "Schedule", d: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2" },
  { path: "/dose", label: "Medicine", d: "m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7ZM8.5 8.5l7 7" },
  { path: "/discharge", label: "My plan", d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5" },
  { path: "/messages", label: "Care team", d: "M7.9 20A9 9 0 1 0 4 16.1L2 22Z" },
  { path: "/check-ins", label: "Check-ins", d: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" },
] as const;
const ORB = 50;

function Icon({ d, color, size = 22 }: { d: string; color: string; size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><Path d={d} /></Svg>;
}

/** ››› easing towards the orb: each chevron brightens in turn, a quiet hint that the orb is where to talk. */
function Chevrons() {
  const still = useReducedMotion();
  return <View style={{ flexDirection: "row", gap: 1 }}>
    {[0, 1, 2].map(i => <Chevron key={i} i={i} still={still} />)}
  </View>;
}
function Chevron({ i, still }: { i: number; still: boolean }) {
  const o = useSharedValue(0.35);
  useEffect(() => {
    if (still) { o.set(0.7); return; }
    o.set(withDelay(i * 180, withRepeat(withSequence(withTiming(1, { duration: 360, easing: Easing.out(Easing.quad) }), withTiming(0.35, { duration: 540 }), withTiming(0.35, { duration: 300 })), -1)));
  }, [i, still, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={style}><Svg width={10} height={16} viewBox="0 0 10 16"><Path d="M2 2l6 6-6 6" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg></Animated.View>;
}

export function Dock() {
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const still = useReducedMotion();
  const { state } = useMe();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  if (state !== "joined" || !SHOWN.includes(path)) return null;
  const round: ViewStyle = { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" };
  const go = (to: string) => { setMenu(false); if (to !== path) router.navigate(to as never); };

  return <>
    {menu && <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={{ position: "absolute", inset: 0, backgroundColor: "rgba(14,18,27,0.28)" }}>
      <Pressable accessibilityLabel="Close menu" style={{ flex: 1 }} onPress={() => setMenu(false)} />
    </Animated.View>}
    {menu && <Animated.View accessibilityViewIsModal entering={still ? FadeIn.duration(120) : FadeInDown.duration(220).easing(Easing.bezier(0.23, 1, 0.32, 1))} exiting={FadeOut.duration(120)}
      style={{ position: "absolute", right: 18, bottom: Math.max(insets.bottom, 12) + 76, width: 238, padding: 6, gap: 4, borderRadius: 24, borderCurve: "continuous", backgroundColor: palette.white, boxShadow: "0 24px 48px -18px rgba(14,18,27,0.45)", transformOrigin: "bottom right" }}>
      {MENU.map((m, i) => {
        const on = m.path === path;
        return <Animated.View key={m.path} entering={still ? undefined : FadeInDown.duration(220).delay(30 + i * 22).easing(Easing.bezier(0.23, 1, 0.32, 1))}>
          <Pressable accessibilityRole="menuitem" accessibilityLabel={m.label} accessibilityState={{ selected: on }} onPress={() => go(m.path)}
            style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8, borderRadius: 16, backgroundColor: on ? palette.blue : pressed ? "#F2F5F8" : "#F7F8FA" })}>
            <View style={{ width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: on ? "rgba(255,255,255,0.18)" : palette.white }}><Icon d={m.d} color={on ? palette.white : palette.ink} size={18} /></View>
            <Text style={{ flex: 1, fontSize: 15, fontWeight: "500", color: on ? palette.white : palette.ink }}>{m.label}</Text>
            {on && <Text style={{ fontSize: 15, color: palette.white, paddingRight: 6 }}>✓</Text>}
          </Pressable>
        </Animated.View>;
      })}
    </Animated.View>}

    <View pointerEvents="box-none" style={{ position: "absolute", left: 16, right: 16, bottom: Math.max(insets.bottom, 12) + 4, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <>
        <Pressable accessibilityRole="button" accessibilityLabel="Home" accessibilityState={{ selected: path === "/" }} onPress={() => go("/")}
          style={({ pressed }) => [round, { backgroundColor: palette.dark, boxShadow: "0 12px 24px -12px rgba(14,18,27,0.7)", transform: [{ scale: pressed ? 0.94 : 1 }] }]}>
          <Icon d={MENU[0].d} color={palette.white} />
        </Pressable>
        <View style={{ flex: 1, height: 60, borderRadius: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 5, backgroundColor: palette.blue, boxShadow: "0 16px 30px -14px rgba(51,92,255,0.8), inset 0 1px 0 rgba(255,255,255,0.25)" }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Find a doctor" onPress={() => go("/doctors")}
            style={({ pressed }) => ({ width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.22)", transform: [{ scale: pressed ? 0.94 : 1 }] })}>
            <Icon d="M11 19a8 8 0 1 0 0-16a8 8 0 0 0 0 16M21 21l-4.3-4.3" color={palette.white} />
          </Pressable>
          <Chevrons />
          <Pressable accessibilityRole="button" accessibilityLabel="Ask Sona Care" accessibilityHint="Talk or type to Sona Care" onPress={() => router.push("/assistant")}
            style={({ pressed }) => ({ width: ORB, height: ORB, borderRadius: ORB / 2, alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 2px rgba(255,255,255,0.75)", transform: [{ scale: pressed ? 0.94 : 1 }] })}>
            <View pointerEvents="none" style={{ margin: -orbPad(ORB) }}><SonaOrb size={ORB} lift={false} /></View>
          </Pressable>
        </View>
      </>
      <Pressable accessibilityRole="button" accessibilityLabel={menu ? "Close menu" : "Menu"} accessibilityState={{ expanded: menu }} onPress={() => setMenu(m => !m)}
        style={({ pressed }) => [round, { backgroundColor: palette.white, boxShadow: "0 12px 24px -12px rgba(14,18,27,0.35)", transform: [{ scale: pressed ? 0.94 : 1 }] }]}>
        <Icon d={menu ? "M18 6L6 18M6 6l12 12" : "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"} color={palette.ink} />
      </Pressable>
    </View>
  </>;
}

import { BrandIcon, type BrandIconName } from "@/components/sona/brand-icon";
import { Text } from "@/components/sona/text";
import { palette } from "@/components/sona/theme";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { interpolate, type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEncounter } from "./store";
import { openSession } from "./navigation";

export const SIDEBAR_WIDTH = 300;

type Item = { label: string; icon: BrandIconName; onPress: () => void; active?: boolean; detail?: string };

function Row({ item }: { item: Item }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={item.detail ? `${item.label}, ${item.detail}` : item.label} accessibilityState={{ selected: item.active }} onPress={item.onPress}
    style={({ pressed }) => ({ minHeight: 50, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 14, borderRadius: 16, borderCurve: "continuous", backgroundColor: item.active ? "rgba(20,28,40,0.07)" : pressed ? "rgba(20,28,40,0.04)" : "transparent", transform: [{ scale: pressed ? 0.98 : 1 }], transitionProperty: ["transform", "backgroundColor"], transitionDuration: 120 } as never)}>
    <BrandIcon name={item.icon} size={23} color={palette.ink} strokeWidth={item.active ? 1.9 : 1.5} />
    <View style={{ flex: 1 }}>
      <Text numberOfLines={1} style={{ fontSize: 17, color: palette.ink, fontWeight: item.active ? "600" : "400" }}>{item.label}</Text>
      {item.detail && <Text numberOfLines={1} style={{ fontSize: 13, color: palette.muted, marginTop: 1 }}>{item.detail}</Text>}
    </View>
  </Pressable>;
}

const Divider = () => <View style={{ height: 1, marginHorizontal: 14, marginVertical: 10, backgroundColor: "rgba(20,28,40,0.08)" }} />;

/**
 * Workspace sidebar, revealed underneath as the page slides right (after the ChatGPT-style
 * drawer): clinician, primary destinations, feedback, then recent encounters as history.
 */
export function Sidebar({ open, progress, onClose, onNew }: { open: boolean; progress: SharedValue<number>; onClose: () => void; onNew: () => void }) {
  const insets = useSafeAreaInsets();
  const { patient, patients, encounters } = useEncounter();
  // Close first, then navigate, so the page is back in place when the next screen presents.
  const go = (to: () => void) => () => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); onClose(); setTimeout(to, 120); };
  const recent = patients.filter(p => encounters[p.id]?.requests.length);

  const primary: Item[] = [
    { label: "Home", icon: "home", active: true, onPress: onClose },
    { label: "Patients", icon: "patients", detail: `${patients.length} visits today`, onPress: go(() => router.push("/patients")) },
    { label: "Consultation", icon: "stethoscope", detail: patient ? `Record with ${patient.name.split(" ")[0]}` : "Pick a visit first", onPress: go(() => router.push(patient ? "/recording" : { pathname: "/patients", params: { view: "recording" } })) },
    { label: "Notes", icon: "note", onPress: go(() => router.push(patient ? "/note" : { pathname: "/patients", params: { view: "note" } })) },
    { label: "Follow-up tasks", icon: "tasks", onPress: go(() => router.push("/tasks")) },
    { label: "Shift handover", icon: "user", detail: `${patients.length + 3} patients`, onPress: go(() => router.push("/handover")) },
  ];

  // Content drifts in from slightly left and fades up, following the page as it slides away.
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.2, 1], [0, 1], "clamp"),
    transform: [{ translateX: interpolate(progress.value, [0, 1], [-24, 0]) }],
  }));

  return <View accessibilityViewIsModal={open} accessibilityElementsHidden={!open} importantForAccessibility={open ? "auto" : "no-hide-descendants"} onAccessibilityEscape={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: "#F1F2F4" }]}>
    <Animated.View style={[{ width: SIDEBAR_WIDTH, flex: 1 }, contentStyle]}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 12, paddingBottom: insets.bottom + 110 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 14, minHeight: 56 }}>
          <BrandIcon name="user" size={28} color={palette.ink} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: "600", color: palette.ink }}>Clinician</Text>
            <Text numberOfLines={1} style={{ fontSize: 13, color: palette.muted }}>Synthetic demo</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={go(() => router.push("/history"))} hitSlop={10} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <BrandIcon name="settings" size={24} color={palette.muted} />
          </Pressable>
        </View>
        <Divider />
        {primary.map(item => <Row key={item.label} item={item} />)}
        <Divider />
        <Row item={{ label: "Share feedback", icon: "feedback", onPress: go(() => router.push("/history")) }} />
        <Divider />
        <Text accessibilityRole="header" style={{ fontSize: 13, color: palette.muted, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 6 }}>History</Text>
        {recent.length ? recent.map(p => <Row key={p.id} item={{ label: p.name, icon: "clock", detail: `${p.subtitle} · ${encounters[p.id]!.requests.length} ${encounters[p.id]!.requests.length === 1 ? "request" : "requests"}`, onPress: go(() => openSession(p.id)) }} />)
          : <Text style={{ fontSize: 15, color: palette.muted, paddingHorizontal: 14, paddingVertical: 8 }}>Encounters appear here after your first request.</Text>}
      </ScrollView>
    </Animated.View>

    <Animated.View pointerEvents="box-none" style={[{ position: "absolute", left: 0, width: SIDEBAR_WIDTH, bottom: Math.max(insets.bottom, 12) + 10, alignItems: "center" }, contentStyle]}>
      <Pressable accessibilityRole="button" accessibilityLabel="New visit" onPress={go(onNew)}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingVertical: 8, paddingHorizontal: 26, borderRadius: 28, backgroundColor: "#15171B", borderWidth: 3, borderColor: "rgba(255,255,255,0.92)", boxShadow: "0 8px 22px rgba(20,24,32,0.22)", transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
        <BrandIcon name="add" size={22} color={palette.white} strokeWidth={1.8} />
        <Text style={{ fontSize: 17, fontWeight: "600", color: palette.white }}>New visit</Text>
      </Pressable>
    </Animated.View>
  </View>;
}

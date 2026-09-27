import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { AccessibilityInfo, Modal, Pressable, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, SlideInDown, SlideOutDown, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { EASE_OUT, useNow } from "@/features/doses";
import { GLASSES } from "@/features/home";
import { setGlasses, useWater } from "@/features/water";
import { Text } from "@/lib/text";
import { palette } from "@/lib/theme";
import { AccentText, ICON } from "@/lib/ui";

const SPARKLES = "M9.9 15.5a2 2 0 0 0-1.4-1.4l-6.1-1.6a.5.5 0 0 1 0-1l6.1-1.6a2 2 0 0 0 1.4-1.4l1.6-6.1a.5.5 0 0 1 1 0l1.6 6.1a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0Z";
const CALENDAR = "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2";
const DROP = "M12 2.7c3.7 4.3 6.5 7.8 6.5 11.3a6.5 6.5 0 0 1-13 0c0-3.5 2.8-7 6.5-11.3Z";
const CHEVRON = "m9 18 6-6-6-6";
// Held long enough for the sheet's exit to finish before the modal goes.
const OUT_MS = 220;

/**
 * The home "+" (the kit's "What are you / planning to add"): a white sheet (40 pt corners, a grabber,
 * the centred light-then-gradient title) with plain rows and a grey Close. Ask, message and book open
 * their screens; water logs a glass right here and says the new count. It springs up with a slight
 * overshoot over a dim, the rows rising 40 ms apart (after 60fps "Canopi create collection sheet");
 * Reduce Motion fades only. The backdrop, Close and the back gesture close it.
 */
export function AddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const glasses = useWater(useNow());
  const [leaving, setLeaving] = useState(false);
  const close = (then?: () => void) => {
    setLeaving(true);
    setTimeout(() => { setLeaving(false); onClose(); then?.(); }, reduced ? 0 : OUT_MS);
  };
  const water = () => {
    const n = Math.min(GLASSES, glasses + 1);
    setGlasses(n);
    if (process.env.EXPO_OS === "ios") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    AccessibilityInfo.announceForAccessibility(`Glass logged. ${n} of ${GLASSES} today`);
    close();
  };
  const rows: { label: string; d: string; note?: string; go: () => void }[] = [
    { label: "Ask Sona Care", d: SPARKLES, go: () => close(() => router.push("/assistant")) },
    { label: "Message my care team", d: ICON.chat, go: () => close(() => router.push("/messages")) },
    { label: "Book a visit", d: CALENDAR, go: () => close(() => router.push("/doctors")) },
    { label: "Log a glass of water", d: DROP, note: `${glasses} of ${GLASSES}`, go: water },
  ];
  const shown = open && !leaving;
  return <Modal visible={open} transparent animationType="none" statusBarTranslucent onRequestClose={() => close()}>
    {shown && <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(OUT_MS)} style={{ position: "absolute", inset: 0, backgroundColor: "rgba(31,31,31,0.28)" }}>
      <Pressable accessible={false} onPress={() => close()} style={{ flex: 1 }} />
    </Animated.View>}
    {shown && <Animated.View accessibilityViewIsModal
      entering={reduced ? FadeIn.duration(200) : SlideInDown.springify().duration(460).dampingRatio(0.82)}
      exiting={reduced ? FadeOut.duration(150) : SlideOutDown.duration(OUT_MS).easing(EASE_OUT)}
      style={{ position: "absolute", left: 8, right: 8, bottom: Math.max(insets.bottom, 8), borderRadius: 40, borderCurve: "continuous", backgroundColor: palette.white, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16, gap: 6 }}>
      <View style={{ alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: "#E5E5E5" }} />
      <View accessible accessibilityRole="header" accessibilityLabel="What are you planning to add" style={{ alignItems: "center", paddingTop: 18, paddingBottom: 10 }}>
        <Text style={{ fontSize: 24, lineHeight: 30, letterSpacing: -1, color: palette.muted }}>What are you</Text>
        <AccentText style={{ fontSize: 28, lineHeight: 34, fontWeight: "600", letterSpacing: -1.9, color: palette.ink, textAlign: "center" }}>planning to add</AccentText>
      </View>
      {rows.map((r, i) => <Animated.View key={r.label} entering={reduced ? undefined : FadeInDown.duration(260).delay(140 + i * 40).easing(EASE_OUT)}>
        <Pressable accessibilityRole="button" accessibilityLabel={r.note ? `${r.label}. ${r.note} today` : r.label} onPress={r.go}
          style={({ pressed }) => ({ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 14, opacity: pressed ? 0.6 : 1 })}>
          <Svg width={20} height={20} viewBox="0 0 24 24"><Path d={r.d} fill="none" stroke={palette.ink} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /></Svg>
          <Text style={{ flex: 1, fontSize: 17, lineHeight: 23, fontWeight: "500", color: palette.ink }}>{r.label}</Text>
          {r.note && <Text style={{ fontSize: 14, color: palette.faint, fontVariant: ["tabular-nums"] }}>{r.note}</Text>}
          <Svg width={18} height={18} viewBox="0 0 24 24"><Path d={CHEVRON} fill="none" stroke={palette.faint} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></Svg>
        </Pressable>
      </Animated.View>)}
      <Pressable accessibilityRole="button" onPress={() => close()}
        style={({ pressed }) => ({ marginTop: 10, minHeight: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: palette.mutedWash, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: palette.ink }}>Close</Text>
      </Pressable>
    </Animated.View>}
  </Modal>;
}

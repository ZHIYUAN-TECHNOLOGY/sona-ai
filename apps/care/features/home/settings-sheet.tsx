import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, SlideInDown, SlideOutDown, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EASE_OUT } from "@/features/doses";
import { RemindersRow } from "@/features/doses/remind";
import { LanguageRow } from "@/features/language/picker";
import { forgetPhone } from "@/features/notifications";
import { TrainingRow } from "@/features/training/consent";
import { authClient } from "@/lib/auth-client";
import { Text } from "@/lib/text";
import { useT } from "@/lib/i18n";
import "./strings";
import { motion, palette, type } from "@/lib/theme";
import { AccentText } from "@/lib/ui";

const OUT_MS = 220;
/** Head, rows and Close rise in 40 ms apart once the sheet is most of the way up (60fps must-leaderboard-sheet, toned down: 8 pt, no bounce). */
const reveal = (i: number) => FadeInDown.withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] }).springify().duration(motion.spring.duration).dampingRatio(1).delay(140 + i * motion.stagger);

/** Sign out: forgets this phone for pushes, then ends the session. */
export function SignOutRow() {
  const t = useT();
  return <Pressable accessibilityRole="button" onPress={() => { void forgetPhone().finally(() => authClient.signOut()); }} style={{ minHeight: 48, minWidth: 48, justifyContent: "center" }}>
    <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>{t("home.signOut")}</Text>
  </Pressable>;
}

/**
 * Settings a patient needs rarely (language, dose reminders, the training consent, sign out), off home in
 * the + sheet's shape: opened from the initials, a white sheet with the light-then-gradient head, one row
 * each on hairlines, and a grey Close. Each row opens its own sheet or toggles in place, as before.
 */
export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [leaving, setLeaving] = useState(false);
  const close = () => {
    setLeaving(true);
    setTimeout(() => { setLeaving(false); onClose(); }, reduced ? 0 : OUT_MS);
  };
  const shown = open && !leaving;
  const row = (i: number) => reduced ? undefined : reveal(i);
  const rows = [<LanguageRow key="lang" />, <RemindersRow key="remind" />, <TrainingRow key="train" />, <SignOutRow key="out" />];
  return <Modal visible={open} transparent animationType="none" statusBarTranslucent onRequestClose={close}>
    {shown && <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(OUT_MS)} style={{ position: "absolute", inset: 0, backgroundColor: "rgba(31,31,31,0.28)" }}>
      <Pressable accessible={false} onPress={close} style={{ flex: 1 }} />
    </Animated.View>}
    {shown && <Animated.View accessibilityViewIsModal
      entering={reduced ? FadeIn.duration(200) : SlideInDown.springify().duration(460).dampingRatio(0.82)}
      exiting={reduced ? FadeOut.duration(150) : SlideOutDown.duration(OUT_MS).easing(EASE_OUT)}
      style={{ position: "absolute", left: 8, right: 8, bottom: Math.max(insets.bottom, 8), borderRadius: 40, borderCurve: "continuous", backgroundColor: palette.white, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16, gap: 6 }}>
      <View style={{ alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: "#E5E5E5" }} />
      <Animated.View entering={row(0)} accessible accessibilityRole="header" accessibilityLabel={`${t("home.settingsLight")} ${t("home.settingsBold")}`} style={{ alignItems: "center", paddingTop: 18, paddingBottom: 10 }}>
        <Text style={{ fontSize: 24, lineHeight: 30, letterSpacing: -1, color: palette.muted }}>{t("home.settingsLight")}</Text>
        <AccentText style={{ fontSize: 28, lineHeight: 34, fontWeight: "600", letterSpacing: -1.9, color: palette.ink, textAlign: "center" }}>{t("home.settingsBold")}</AccentText>
      </Animated.View>
      {rows.map((r, i) => <Animated.View key={i} entering={row(1 + i)} style={{ borderTopWidth: i ? 1 : 0, borderColor: palette.line }}>{r}</Animated.View>)}
      <Animated.View entering={row(1 + rows.length)}><Pressable accessibilityRole="button" onPress={close}
        style={({ pressed }) => ({ marginTop: 10, minHeight: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: palette.mutedWash, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: palette.ink }}>{t("common.close")}</Text>
      </Pressable></Animated.View>
    </Animated.View>}
  </Modal>;
}

import { useMutation, useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { AccessibilityInfo, Modal, Pressable, ScrollView, Switch, useWindowDimensions, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, SlideInDown, SlideOutDown, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorText } from "@/features/errors";
import { formatDate, tFor, useLang } from "@/lib/i18n";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { AccentText, Button } from "@/lib/ui";
import { client, orpc, queryClient } from "@/utils/orpc";
import "./strings";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const OUT_MS = 220;

/** The patient's training consent (off until they switch it on): read once, refreshed after a change. */
const useConsent = () => useQuery(orpc.care.trainingConsent.queryOptions());

/** Home's quiet row beside Language: "Help improve Sona Care · Off", opening what is shared and the switch. */
export function TrainingRow() {
  const lang = useLang(), t = tFor(lang);
  const [open, setOpen] = useState(false);
  const { data } = useConsent();
  const state = data?.consented ? t("train.on") : t("train.off");
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${t("train.row")}: ${state}`} accessibilityHint={t("train.hint")} onPress={() => setOpen(true)}
      style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>{t("train.row")} · <Text style={{ color: data?.consented ? palette.green : palette.blue }}>{state}</Text></Text>
    </Pressable>
    <TrainingSheet open={open} onClose={() => setOpen(false)} />
  </>;
}

/**
 * The language sheet's pattern (white sheet, 40 pt corners, grabber, the light-then-gradient head, rows
 * rising 40 ms apart, Done): what is used, what never is, who sees it, and that it can be withdrawn, then
 * one clear switch. Switching off while on asks inline first ("Stop sharing?") rather than in an alert,
 * since withdrawing takes out anything not yet used. Reduce Motion: fades only.
 */
function TrainingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const still = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const lang = useLang(), t = tFor(lang);
  const consent = useConsent();
  const [leaving, setLeaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const set = useMutation({
    mutationFn: (consented: boolean) => client.care.setTrainingConsent({ consented }),
    onSuccess: next => {
      setConfirming(false);
      queryClient.setQueryData(orpc.care.trainingConsent.queryKey(), next);
      if (process.env.EXPO_OS === "ios") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility(t(next.consented ? "train.nowOn" : "train.nowOff"));
    },
  });
  const close = () => {
    setLeaving(true);
    setTimeout(() => { setLeaving(false); setConfirming(false); set.reset(); onClose(); }, still ? 0 : OUT_MS);
  };
  const on = set.isPending ? set.variables : Boolean(consent.data?.consented);
  const toggle = (to: boolean) => {
    if (process.env.EXPO_OS === "ios") void Haptics.selectionAsync();
    if (to) { setConfirming(false); set.mutate(true); } else setConfirming(true);
  };
  const shown = open && !leaving;
  const layout = still ? undefined : LinearTransition.springify().duration(380).dampingRatio(1);
  const rise = (i: number) => still ? undefined : FadeInDown.duration(260).delay(140 + i * 40).easing(EASE_OUT);
  const points = [["train.usedTitle", "train.used"], ["train.neverTitle", "train.never"], ["train.whoTitle", "train.who"], ["train.withdrawTitle", "train.withdraw"]] as const;
  const status = consent.data?.consented && consent.data.at ? t("train.onSince", { date: formatDate(lang, consent.data.at, "day") }) : t("train.offNow");

  return <Modal visible={open} transparent animationType="none" statusBarTranslucent onRequestClose={close}>
    {shown && <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(OUT_MS)} style={{ position: "absolute", inset: 0, backgroundColor: "rgba(31,31,31,0.28)" }}>
      <Pressable accessible={false} onPress={close} style={{ flex: 1 }} />
    </Animated.View>}
    {shown && <Animated.View accessibilityViewIsModal
      entering={still ? FadeIn.duration(200) : SlideInDown.springify().duration(460).dampingRatio(0.82)}
      exiting={still ? FadeOut.duration(150) : SlideOutDown.duration(OUT_MS).easing(EASE_OUT)}
      style={{ position: "absolute", left: 8, right: 8, bottom: Math.max(insets.bottom, 8), maxHeight: height - insets.top - 16, borderRadius: 40, borderCurve: "continuous", backgroundColor: palette.white, paddingTop: 10, paddingBottom: 16 }}>
      <View style={{ alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: "#E5E5E5" }} />
      <ScrollView bounces={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 6 }}>
        <View accessible accessibilityRole="header" accessibilityLabel={`${t("train.light")} ${t("train.bold")}`} style={{ alignItems: "center", paddingTop: 18, paddingBottom: 4, gap: 2 }}>
          <Text style={{ fontSize: 20, lineHeight: 26, letterSpacing: -0.6, color: palette.muted, textAlign: "center" }}>{t("train.light")}</Text>
          <AccentText style={{ fontSize: 28, lineHeight: 34, fontWeight: "600", letterSpacing: -1.9, color: palette.ink, textAlign: "center" }}>{t("train.bold")}</AccentText>
        </View>
        <Text style={{ ...type.footnote, color: palette.faint, textAlign: "center", paddingBottom: 8 }}>{t("train.line")}</Text>
        {points.map(([title, line], i) => <Animated.View key={title} entering={rise(i)} accessible style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 2 }}>
          <Text style={{ ...type.headline, color: palette.ink }}>{t(title)}</Text>
          <Text style={{ ...type.body, color: palette.muted }}>{t(line)}</Text>
        </Animated.View>)}
        {/* The switch: the one decision on the sheet, in the kit's selected-row card. */}
        <Animated.View entering={rise(points.length)} layout={layout} style={{ marginTop: 8, padding: 16, borderRadius: 22, borderCurve: "continuous", backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line, gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ fontSize: 18, lineHeight: 24, fontWeight: "600", color: palette.ink }}>{t("train.switch")}</Text>
              <Text style={{ ...type.footnote, color: on ? palette.green : palette.faint }}>{status}</Text>
            </View>
            <Switch accessibilityLabel={t("train.switch")} value={on} disabled={set.isPending || !consent.data} onValueChange={toggle}
              trackColor={{ true: palette.blue, false: "#E5E5E5" }} ios_backgroundColor="#E5E5E5" />
          </View>
          {confirming && <Animated.View entering={still ? undefined : FadeInDown.duration(220).easing(EASE_OUT)} exiting={still ? undefined : FadeOut.duration(150)} style={{ gap: 10 }}>
            <Text accessibilityLiveRegion="polite" style={{ ...type.body, color: palette.ink }}>{t("train.confirm")}</Text>
            <Button label={t("train.stop")} busy={set.isPending} onPress={() => set.mutate(false)} />
            <Button quiet label={t("train.keep")} disabled={set.isPending} onPress={() => setConfirming(false)} />
          </Animated.View>}
          {set.isError && <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.amber }}>{errorText(set.error, lang)}</Text>}
        </Animated.View>
        <View style={{ marginTop: 10 }}><Button label={t("common.done")} onPress={close} /></View>
      </ScrollView>
    </Animated.View>}
  </Modal>;
}

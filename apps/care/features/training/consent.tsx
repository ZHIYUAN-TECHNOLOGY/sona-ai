import { useMutation, useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, Switch, View } from "react-native";
import Animated, { Easing, FadeInDown, FadeOut, LinearTransition, useReducedMotion } from "react-native-reanimated";
import { errorText } from "@/features/errors";
import { formatDate, tFor, useLang } from "@/lib/i18n";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { BackButton, Button, Title, useBelowStatusBar } from "@/lib/ui";
import { client, orpc, queryClient } from "@/utils/orpc";
import "./strings";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** The patient's training consent (off until they switch it on): read once, refreshed after a change. */
const useConsent = () => useQuery(orpc.care.trainingConsent.queryOptions());

/** Settings' quiet row: "Help improve Sona Care · Off", pushing the page with what is shared and the switch. */
export function TrainingRow() {
  const lang = useLang(), t = tFor(lang);
  const { data } = useConsent();
  const state = data?.consented ? t("train.on") : t("train.off");
  return <Pressable accessibilityRole="button" accessibilityLabel={`${t("train.row")}: ${state}`} accessibilityHint={t("train.hint")} onPress={() => router.push("/help-improve")}
    style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
    <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>{t("train.row")} · <Text style={{ color: data?.consented ? palette.green : palette.blue }}>{state}</Text></Text>
  </Pressable>;
}

/**
 * A page pushed from Settings (a consent to read before deciding, so not a sheet): what is used, what never is,
 * who sees it, and that it can be withdrawn, then one clear switch. Switching off while on asks inline first
 * ("Stop sharing?") rather than in an alert, since withdrawing takes out anything not yet used. Back, or the
 * swipe, leaves it. Reduce Motion: no motion.
 */
export function TrainingPage() {
  const still = useReducedMotion();
  const below = useBelowStatusBar();
  const lang = useLang(), t = tFor(lang);
  const consent = useConsent();
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
  const on = set.isPending ? set.variables : Boolean(consent.data?.consented);
  const toggle = (to: boolean) => {
    if (process.env.EXPO_OS === "ios") void Haptics.selectionAsync();
    if (to) { setConfirming(false); set.mutate(true); } else setConfirming(true);
  };
  const layout = still ? undefined : LinearTransition.springify().duration(380).dampingRatio(1);
  const points = [["train.usedTitle", "train.used"], ["train.neverTitle", "train.never"], ["train.whoTitle", "train.who"], ["train.withdrawTitle", "train.withdraw"]] as const;
  const status = consent.data?.consented && consent.data.at ? t("train.onSince", { date: formatDate(lang, consent.data.at, "day") }) : t("train.offNow");

  return <ScrollView style={below} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 48, gap: 16 }}>
    <BackButton />
    <Title greeting={t("train.light")} accent={t("train.bold")} line={t("train.line")} />
    {points.map(([title, line]) => <View key={title} accessible style={{ gap: 2 }}>
      <Text style={{ ...type.headline, color: palette.ink }}>{t(title)}</Text>
      <Text style={{ ...type.body, color: palette.muted }}>{t(line)}</Text>
    </View>)}
    {/* The switch: the one decision on the page, in the kit's selected-row card. */}
    <Animated.View layout={layout} style={{ padding: 16, borderRadius: 22, borderCurve: "continuous", backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line, gap: 12 }}>
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
  </ScrollView>;
}

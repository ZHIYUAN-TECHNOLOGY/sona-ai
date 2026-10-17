import { router } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { RemindersRow } from "@/features/doses/remind";
import { HealthSummaryRow } from "@/features/home/health-summary";
import { SignOutRow } from "@/features/home/sign-out";
import { useMe } from "@/features/me";
import "@/features/home/strings";
import { LanguageChoices } from "@/features/language/picker";
import { TrainingRow } from "@/features/training/consent";
import { tFor, useLang } from "@/lib/i18n";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { BackButton, Section, surfaceStyle, Title, useBelowStatusBar } from "@/lib/ui";

/**
 * Settings a patient needs rarely, a page pushed from home's initials: the three languages in place (a tap
 * changes the whole page at once), then dose reminders (a switch), "Help improve Sona Care" (its own page)
 * and sign out (asks in place), one row each on hairlines. Back, or the swipe, returns home.
 */
export default function Settings() {
  const lang = useLang(), t = tFor(lang);
  const below = useBelowStatusBar();
  // Her health summary only once a record is linked: there is nothing to summarise before.
  const joined = useMe().state === "joined";
  // A new discharge paper (a later admission) has a new code; once linked, Home no longer offers the scanner, so it lives here.
  const linkAgain = <Pressable key="link" accessibilityRole="button" accessibilityHint={t("home.linkAgainHint")} onPress={() => router.push("/join")}
    style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
    <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>{t("home.linkAgain")}</Text>
  </Pressable>;
  const rows = [<RemindersRow key="remind" />, ...joined ? [<HealthSummaryRow key="summary" />, linkAgain] : [], <TrainingRow key="train" />, <SignOutRow key="out" />];
  return <ScrollView style={below} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 48, gap: 16 }}>
    <BackButton />
    <Title greeting={t("home.settingsLight")} accent={t("home.settingsBold")} />
    <View style={{ gap: 12 }}>
      <Section light={t("lang.light")} bold={t("lang.bold")} />
      <Text style={{ ...type.footnote, color: palette.faint }}>{t("lang.line")}</Text>
      <View accessibilityRole="radiogroup" style={[surfaceStyle, { padding: 6, gap: 2 }]}><LanguageChoices /></View>
    </View>
    <View style={[surfaceStyle, { paddingHorizontal: 16, paddingVertical: 4 }]}>
      {rows.map((r, i) => <View key={i} style={{ borderTopWidth: i ? 1 : 0, borderColor: palette.line }}>{r}</View>)}
    </View>
  </ScrollView>;
}

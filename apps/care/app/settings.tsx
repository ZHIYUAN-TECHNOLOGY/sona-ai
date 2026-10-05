import { ScrollView, View } from "react-native";
import { RemindersRow } from "@/features/doses/remind";
import { SignOutRow } from "@/features/home/sign-out";
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
  const rows = [<RemindersRow key="remind" />, <TrainingRow key="train" />, <SignOutRow key="out" />];
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

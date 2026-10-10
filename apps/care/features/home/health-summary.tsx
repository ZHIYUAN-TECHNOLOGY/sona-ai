import { router } from "expo-router";
import { Pressable } from "react-native";
import { tFor, useLang } from "@/lib/i18n";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import "./strings";

/**
 * Settings: opens My health summary (the dock tab, app/(tabs)/health-summary), her record as the hospital's PDF holds it, read there before
 * she shares it with another hospital. In Settings, with the other things about her record she does rarely, so Home
 * keeps its one lead.
 */
export function HealthSummaryRow() {
  const lang = useLang(), t = tFor(lang);
  return <Pressable accessibilityRole="button" accessibilityHint={t("home.summaryHint")} onPress={() => router.navigate("/health-summary")}
    style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
    <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>{t("home.summary")} <Text style={{ color: palette.blue }}>›</Text></Text>
  </Pressable>;
}

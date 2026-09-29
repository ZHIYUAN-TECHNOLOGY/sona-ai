import { router } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "@/lib/i18n";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { AccentText, Button } from "@/lib/ui";

/** What the "Synthetic data" pill and every "Sample" label open: what is fictional, and what "sample" means. */
export default function AboutData() {
  const t = useT();
  const insets = useSafeAreaInsets();
  return <View style={{ padding: 24, paddingTop: 28, paddingBottom: Math.max(insets.bottom, 16) + 8, gap: 14 }}>
    <AccentText style={{ ...type.display, color: palette.ink, textAlign: "center" }}>{t("synthetic.pill")}</AccentText>
    <Text style={{ ...type.body, color: palette.ink }}>{t("synthetic.fictional")}</Text>
    <Text style={{ ...type.body, color: palette.muted }}>{t("synthetic.sample")}</Text>
    <Button label={t("common.close")} onPress={() => router.back()} />
  </View>;
}

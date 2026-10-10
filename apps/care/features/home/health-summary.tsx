import { File, Paths } from "expo-file-system";
import { useState } from "react";
import { Pressable, Share, View } from "react-native";
import { errorText } from "@/features/errors";
import { tFor, useLang } from "@/lib/i18n";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { client } from "@/utils/orpc";
import "./strings";

/**
 * Settings: her health summary, the hospital's PDF of her record (care.healthSummary), written to the phone's cache and
 * opened in the share sheet, to take or send to another hospital. In Settings, with the other things about her record
 * she does rarely, so Home keeps its one lead. Says while it is being made and why it failed, in place.
 */
export function HealthSummaryRow() {
  const lang = useLang(), t = tFor(lang);
  const [state, setState] = useState<"idle" | "busy" | { error: string }>("idle");
  const share = async () => {
    setState("busy");
    try {
      const { filename, pdf } = await client.care.healthSummary();
      const file = new File(Paths.cache, filename);
      file.write(pdf, { encoding: "base64" });
      await Share.share({ url: file.uri, title: filename });
      setState("idle");
    } catch (e) {
      setState({ error: errorText(e, lang) });
    }
  };
  const busy = state === "busy";
  return <View>
    <Pressable accessibilityRole="button" accessibilityHint={t("home.summaryHint")} accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => { void share(); }}
      style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ ...type.footnote, fontWeight: "600", color: busy ? palette.faint : palette.muted }}>{busy ? t("home.summaryMaking") : t("home.summary")}</Text>
    </Pressable>
    {typeof state === "object" && <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.amber, paddingBottom: 10 }}>{t("home.summaryFailed", { why: state.error })}</Text>}
  </View>;
}

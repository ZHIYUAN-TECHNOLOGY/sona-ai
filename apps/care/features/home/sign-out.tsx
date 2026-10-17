import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import { EASE_OUT } from "@/features/doses";
import { useMe } from "@/features/me";
import { forgetPhone } from "@/features/notifications";
import { authClient } from "@/lib/auth-client";
import { Text } from "@/lib/text";
import { useT } from "@/lib/i18n";
import "./strings";
import { palette, type } from "@/lib/theme";
import { Button } from "@/lib/ui";

/**
 * Sign out: forgets this phone for pushes, then ends the session. Linked to a record, it asks first, in place (coming
 * back needs the discharge code), as the training page does: no alert. From Settings, it then goes back to the start.
 */
export function SignOutRow() {
  const t = useT();
  const reduced = useReducedMotion();
  const linked = useMe().state === "joined";
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const out = () => {
    setBusy(true);
    void forgetPhone().finally(() => authClient.signOut()).finally(() => { setBusy(false); if (router.canDismiss()) router.dismissAll(); });
  };
  return <View>
    <Pressable accessibilityRole="button" onPress={() => linked ? setAsking(true) : out()} style={{ minHeight: 48, minWidth: 48, justifyContent: "center" }}>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>{t("home.signOut")}</Text>
    </Pressable>
    {asking && <Animated.View entering={reduced ? undefined : FadeInDown.duration(220).easing(EASE_OUT)} style={{ gap: 10, paddingBottom: 8 }}>
      <Text accessibilityLiveRegion="polite" style={{ ...type.body, color: palette.ink }}>{t("home.signOutConfirm")}</Text>
      <Button label={t("home.signOut")} busy={busy} onPress={out} />
      <Button quiet label={t("common.cancel")} disabled={busy} onPress={() => setAsking(false)} />
    </Animated.View>}
  </View>;
}

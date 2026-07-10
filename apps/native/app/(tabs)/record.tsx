import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { colors } from "@/lib/theme";

// The separated "Record" capsule (NativeTabs search-role) is an ACTION, not a
// destination. Focusing it immediately launches the consult flow (consent → recording
// → …) as a full-screen stack over the tabs — no resting launcher screen. Consent
// disables swipe-back; Complete returns to Today, so this launcher never loops.
export default function RecordLauncher() {
  useFocusEffect(
    useCallback(() => {
      router.push("/consent");
    }, []),
  );
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}

import { router } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RecordFab } from "@/components/consult/RecordFab";
import { colors } from "@/lib/theme";

// Real iOS liquid-glass tab bar via NativeTabs (system UITabBar). Five destinations;
// Record is NOT a tab — a 5th standard tab pushed the search-capsule into the system
// "More" overflow, hiding it. Instead Record is a prominent floating action button
// (bottom-right, over the glass bar) — always visible, one tap to start a consult.
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <NativeTabs tintColor={colors.green}>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} />
          <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="history">
          <NativeTabs.Trigger.Icon sf="clock" />
          <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="notes">
          <NativeTabs.Trigger.Icon sf={{ default: "doc.text", selected: "doc.text.fill" }} />
          <NativeTabs.Trigger.Label>Notes</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="knowledge">
          <NativeTabs.Trigger.Icon sf="sparkles" />
          <NativeTabs.Trigger.Label>Knowledge</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="settings">
          <NativeTabs.Trigger.Icon sf="gearshape" />
          <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>

      {/* Floating Record action, above the tab bar. Overlay because NativeTabs has no
          custom center/right button slot. Starts the consult flow (→ consent). */}
      <View style={[styles.fab, { bottom: insets.bottom + 58 }]}>
        <RecordFab onPress={() => router.push("/consent")} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fab: { position: "absolute", right: 18 },
});

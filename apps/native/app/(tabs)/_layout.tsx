import { NativeTabs } from "expo-router/unstable-native-tabs";

import { colors } from "@/lib/theme";

// Real iOS liquid-glass tab bar via NativeTabs (system UITabBar). Content scrolls
// under the genuine system glass — the authentic effect a JS approximation can't
// match. Four tabs; "Start consult" lives as a CTA on the Today screen (NativeTabs
// forbids a custom center button, and Heidi keeps the start action on the list too).
export default function TabsLayout() {
  return (
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
      {/* iOS 26 separates a `search`-role tab into its own floating capsule on the
          right — we repurpose it as the Record action (opens the consult launcher). */}
      <NativeTabs.Trigger name="record" role="search">
        <NativeTabs.Trigger.Icon sf="mic.fill" />
        <NativeTabs.Trigger.Label>Record</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

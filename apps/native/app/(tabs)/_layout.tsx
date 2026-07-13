import { NativeTabs } from "expo-router/unstable-native-tabs";

import { colors } from "@/lib/theme";

// Real iOS liquid-glass tab bar via NativeTabs (system UITabBar). FOUR destinations in
// the main glass pill, plus Record as the iOS 26 separated `search`-role capsule —
// its own floating pill isolated on the right (like Apple News' search capsule), so
// the app's primary action is always obvious and never buried in a "More" overflow.
// (Five main tabs overflowed the capsule into More — hence four.)
export default function TabsLayout() {
  return (
    // disableTransparentOnScrollEdge: by default the tab bar's SCROLL-EDGE appearance (used when
    // a screen sits at the top / doesn't scroll under the bar) is built with blurEffect 'none' +
    // null background — which iOS renders as an opaque grey. That's why switching to a short tab
    // turned the bar grey while a scrollable tab stayed glass. Setting this makes the scroll-edge
    // reuse the STANDARD appearance; since we pass no blurEffect, that's the iOS 26 liquid-glass
    // default → glass on every tab, no grey.
    <NativeTabs tintColor={colors.green} disableTransparentOnScrollEdge>

      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} />
        <NativeTabs.Trigger.Label>Consults</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notes">
        <NativeTabs.Trigger.Icon sf={{ default: "doc.text", selected: "doc.text.fill" }} />
        <NativeTabs.Trigger.Label>Notes</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {/* Smart Scan replaced Knowledge in the 4-slot capsule (Jul 2026) — scanning paper
          docs is a headline feature; Knowledge lives on via Settings → Knowledge search. */}
      <NativeTabs.Trigger name="scan">
        <NativeTabs.Trigger.Icon sf={{ default: "doc.viewfinder", selected: "doc.viewfinder.fill" }} />
        <NativeTabs.Trigger.Label>Smart Scan</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf="gearshape" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {/* iOS 26 separates a `search`-role tab into its own floating capsule on the
          right — repurposed as the Record action (opens the consult launcher). */}
      <NativeTabs.Trigger name="record" role="search">
        <NativeTabs.Trigger.Icon sf="mic.fill" />
        <NativeTabs.Trigger.Label>Record</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

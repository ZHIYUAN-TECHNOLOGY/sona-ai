import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { GlassSurface } from "@/components/consult/GlassSurface";
import { colors, radius } from "@/lib/theme";

type IconName = keyof typeof Ionicons.glyphMap;

const TABS: { key: string; label: string; icon: IconName }[] = [
  { key: "home", label: "Today", icon: "home" },
  { key: "history", label: "History", icon: "time-outline" },
  { key: "notes", label: "Notes", icon: "document-text-outline" },
  { key: "settings", label: "Settings", icon: "settings-outline" },
];

/**
 * Floating glass tab bar with a raised center Record button. The pill backdrop is
 * REAL glass (GlassSurface: liquid glass on iOS 26, gaussian blur on iOS 18-25).
 * The center button lives OUTSIDE the clipped glass pill so it can poke above it.
 * The center Record starts a consult.
 */
export function GlassTabBar({
  activeKey = "home",
  onRecord,
  onTabPress,
}: {
  activeKey?: string;
  onRecord?: () => void;
  onTabPress?: (key: string) => void;
}) {
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <GlassSurface style={styles.pill}>
        {left.map((t) => (
          <TabItem key={t.key} tab={t} active={activeKey === t.key} onPress={() => onTabPress?.(t.key)} />
        ))}
        <View style={styles.centerGap} />
        {right.map((t) => (
          <TabItem key={t.key} tab={t} active={activeKey === t.key} onPress={() => onTabPress?.(t.key)} />
        ))}
      </GlassSurface>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start consult"
        onPress={onRecord}
        style={({ pressed }) => [styles.center, pressed && styles.centerPressed]}
      >
        <Ionicons name="mic" size={23} color={colors.white} />
      </Pressable>
    </View>
  );
}

function TabItem({
  tab,
  active,
  onPress,
}: {
  tab: { key: string; label: string; icon: IconName };
  active: boolean;
  onPress: () => void;
}) {
  const color = active ? colors.green : colors.ink3;
  return (
    <Pressable
      style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Ionicons name={tab.icon} size={21} color={color} />
      <Text style={[styles.tabLabel, { color }]}>{tab.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // Non-clipping container so the center button can overflow above the pill,
    // and the pill's drop shadow renders outside the clipped glass.
    boxShadow: "0px 10px 24px rgba(11,30,22,0.16)",
    borderRadius: 26,
    borderCurve: "continuous",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    gap: 2,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 26,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(205,219,211,0.9)",
    overflow: "hidden",
  },
  centerGap: { width: 58 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, minHeight: 46 },
  tabPressed: { transform: [{ scale: 0.94 }], opacity: 0.7 },
  tabLabel: { fontSize: 9, fontWeight: "600" },
  center: {
    position: "absolute",
    top: -22,
    left: "50%",
    marginLeft: -25,
    width: 50,
    height: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.92)",
    boxShadow: "0px 8px 16px rgba(14,124,82,0.4)",
  },
  centerPressed: { opacity: 0.9, transform: [{ scale: 0.96 }] },
});

import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius } from "@/lib/theme";

type IconName = keyof typeof Ionicons.glyphMap;

const TABS: { key: string; label: string; icon: IconName }[] = [
  { key: "home", label: "Today", icon: "home" },
  { key: "history", label: "History", icon: "time-outline" },
  { key: "notes", label: "Notes", icon: "document-text-outline" },
  { key: "settings", label: "Settings", icon: "settings-outline" },
];

/**
 * iOS glass tab bar approximation with the raised center Record button.
 * expo-blur / linear-gradient are not in the deps, so the "liquid glass" is
 * approximated with a translucent surface + border + soft shadow (the prototype
 * calls this a web/native approximation too). The center Record starts a consult.
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
    <View style={styles.bar} pointerEvents="box-none">
      {left.map((t) => (
        <TabItem key={t.key} tab={t} active={activeKey === t.key} onPress={() => onTabPress?.(t.key)} />
      ))}

      <Pressable accessibilityRole="button" accessibilityLabel="Record" onPress={onRecord} style={styles.center}>
        <Ionicons name="mic" size={23} color={colors.white} />
      </Pressable>

      {right.map((t) => (
        <TabItem key={t.key} tab={t} active={activeKey === t.key} onPress={() => onTabPress?.(t.key)} />
      ))}
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
    <Pressable style={styles.tab} onPress={onPress} accessibilityRole="button">
      <Ionicons name={tab.icon} size={21} color={color} />
      <Text style={[styles.tabLabel, { color }]}>{tab.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    gap: 2,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 26,
    backgroundColor: "rgba(245,249,247,0.94)",
    borderWidth: 1,
    borderColor: "rgba(205,219,211,0.9)",
    shadowColor: colors.ink,
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    minHeight: 46,
  },
  tabLabel: { fontSize: 9, fontWeight: "600" },
  center: {
    width: 50,
    height: 50,
    borderRadius: radius.pill,
    marginTop: -24,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.92)",
    shadowColor: colors.green,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
});

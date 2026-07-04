import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "@/lib/theme";

/** Screen header: optional back button, title + subtitle, and a right slot (pill). */
export function TopBar({
  title,
  sub,
  onBack,
  right,
  titleColor,
}: {
  title: string;
  sub?: string;
  onBack?: () => void;
  right?: ReactNode;
  titleColor?: string;
}) {
  return (
    <View style={styles.top}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} style={styles.back}>
          <Ionicons name="chevron-back" size={18} color={colors.ink2} />
        </Pressable>
      ) : null}
      <View style={styles.tt}>
        <Text numberOfLines={1} style={[styles.title, titleColor ? { color: titleColor } : null]}>
          {title}
        </Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 17,
    marginBottom: 12,
  },
  back: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  tt: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: "600", letterSpacing: -0.16, color: colors.ink },
  sub: { fontSize: 11, color: colors.ink3, marginTop: 1 },
});

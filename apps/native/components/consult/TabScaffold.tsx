import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { SerifTitle } from "@/components/consult/SerifTitle";
import { colors, space } from "@/lib/theme";

/**
 * Shared scaffold for the home tabs. A single ScrollView with
 * `contentInsetAdjustmentBehavior="automatic"` so the system insets content
 * below the status bar AND above the NativeTabs liquid-glass tab bar — letting the
 * list scroll UNDER the real glass. The Record action lives as the separated
 * capsule tab (see (tabs)/_layout).
 */
export function TabScaffold({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollView
      style={styles.body}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.titleRow}>
        <SerifTitle>{title}</SerifTitle>
        {right}
      </View>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xl, gap: space.md },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.xs,
  },
});

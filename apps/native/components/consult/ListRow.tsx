import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, font, radius, space } from "@/lib/theme";

/**
 * A consult/note list row: initials avatar, title + subtitle, optional right
 * accessory (a Pill), and a chevron. Used across Today / History / Notes.
 */
export interface ListRowChip {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}

export function ListRow({
  initials,
  title,
  sub,
  chips,
  snippet,
  right,
  onPress,
  onLongPress,
}: {
  initials: string;
  title: string;
  sub?: string;
  /** Scannable icon-chips row (room, visit type, phone, …) under the subtitle. */
  chips?: ListRowChip[];
  /** Optional last line: a muted one-line content preview (note first line, …). */
  snippet?: string;
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const body = (
    <>
      <View style={styles.avatar}>
        <Text style={styles.initials}>{initials}</Text>
      </View>
      <View style={styles.tt}>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {sub ? (
          <Text numberOfLines={1} style={styles.sub}>
            {sub}
          </Text>
        ) : null}
        {chips && chips.length > 0 ? (
          <View style={styles.chips}>
            {chips.map((c, i) => (
              <View key={i} style={styles.chip}>
                <Ionicons name={c.icon} size={11} color={colors.greenDeep} />
                <Text numberOfLines={1} style={styles.chipText}>
                  {c.label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {snippet ? (
          <Text numberOfLines={1} style={styles.snippet}>
            {snippet}
          </Text>
        ) : null}
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.ink3} /> : null}
    </>
  );

  if (!onPress && !onLongPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    boxShadow: "0px 1px 3px rgba(11,30,22,0.05)",
  },
  pressed: { opacity: 0.7 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: { ...font.bodySm, fontWeight: "700", color: colors.greenDeep },
  tt: { flex: 1, minWidth: 0 },
  title: { ...font.body, fontWeight: "600", color: colors.ink },
  sub: { ...font.bodySm, color: colors.ink3, marginTop: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 5 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: radius.pill,
    backgroundColor: colors.greenSoft,
    maxWidth: 160,
  },
  chipText: { fontSize: 10.5, fontWeight: "600", color: colors.greenDeep },
  snippet: { ...font.bodySm, color: colors.ink2, marginTop: 2, fontStyle: "italic" },
});

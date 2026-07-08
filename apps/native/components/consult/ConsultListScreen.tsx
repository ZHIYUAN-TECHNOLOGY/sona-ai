import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { ListRow } from "@/components/consult/ListRow";
import { Pill } from "@/components/consult/Pill";
import { TabScaffold } from "@/components/consult/TabScaffold";
import { consultInitials, consultTime, isToday, statusMeta } from "@/lib/consultFormat";
import { setConsultTitle } from "@/lib/db";
import type { Consult } from "@/lib/db/types";
import { colors, font, space } from "@/lib/theme";

/**
 * Shared list body for the Today / History / Notes tabs. Loads on focus, groups
 * Today vs Earlier, and shows a calm empty-state when there's nothing yet.
 */
export function ConsultListScreen({
  title,
  load,
  emptyIcon = "documents-outline",
  emptyTitle,
  emptyBody,
  topSlot,
}: {
  title: string;
  load: () => Promise<Consult[]>;
  emptyIcon?: keyof typeof Ionicons.glyphMap;
  emptyTitle: string;
  emptyBody: string;
  topSlot?: ReactNode;
}) {
  const [items, setItems] = useState<Consult[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    void load().then((r) => {
      setItems(r);
      setLoaded(true);
    });
  }, [load]);

  useFocusEffect(reload);

  // Long-press a row to rename the consult (edits the AI-generated title). iOS
  // Alert.prompt; the title stays local + PII-free.
  const rename = useCallback(
    (c: Consult) => {
      if (process.env.EXPO_OS !== "ios") return;
      Alert.prompt(
        "Rename consult",
        "A short, PII-free title.",
        (text) => {
          const t = text?.trim();
          if (t) void setConsultTitle(c.id, t).then(reload);
        },
        "plain-text",
        c.title,
      );
    },
    [reload],
  );

  const today = items.filter((c) => isToday(c.createdAt));
  const earlier = items.filter((c) => !isToday(c.createdAt));

  return (
    <TabScaffold title={title}>
      {topSlot}
      {!loaded ? null : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name={emptyIcon} size={30} color={colors.ink3} />
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          <Text style={styles.emptyBody}>{emptyBody}</Text>
        </View>
      ) : (
        <>
          {today.length > 0 ? <Group label="Today" items={today} onRename={rename} /> : null}
          {earlier.length > 0 ? <Group label="Earlier" items={earlier} onRename={rename} /> : null}
        </>
      )}
    </TabScaffold>
  );
}

function Group({
  label,
  items,
  onRename,
}: {
  label: string;
  items: Consult[];
  onRename: (c: Consult) => void;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      {items.map((c) => {
        const s = statusMeta(c.status);
        return (
          <ListRow
            key={c.id}
            initials={consultInitials(c.title)}
            title={c.title}
            sub={consultTime(c.createdAt)}
            right={<Pill label={s.label} variant={s.variant} />}
            onLongPress={() => onRename(c)}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  groupLabel: { ...font.label, color: colors.ink3, marginTop: space.sm, marginBottom: space.xs },
  empty: { alignItems: "center", gap: space.sm, paddingVertical: 64 },
  emptyTitle: { ...font.h3, color: colors.ink, marginTop: space.xs },
  emptyBody: { ...font.body, color: colors.ink3, textAlign: "center", paddingHorizontal: space.xl },
});

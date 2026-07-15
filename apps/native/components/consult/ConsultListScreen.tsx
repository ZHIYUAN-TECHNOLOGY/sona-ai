import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, useReducedMotion } from "react-native-reanimated";

import { ListRow } from "@/components/consult/ListRow";
import { Pill } from "@/components/consult/Pill";
import { SwipeableRow } from "@/components/consult/SwipeableRow";
import { TabScaffold } from "@/components/consult/TabScaffold";
import {
  consultChips,
  consultHeadline,
  consultInitials,
  consultSubtitle,
  isToday,
  statusMeta,
} from "@/lib/consultFormat";
import { deleteConsult, pruneEmptyDrafts, setConsultTitle, type ConsultListItem } from "@/lib/db";
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
  load: () => Promise<(Consult | ConsultListItem)[]>;
  emptyIcon?: keyof typeof Ionicons.glyphMap;
  emptyTitle: string;
  emptyBody: string;
  topSlot?: ReactNode;
}) {
  const [items, setItems] = useState<(Consult | ConsultListItem)[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    // Clear abandoned empty drafts before showing the list, so the junk from
    // started-then-abandoned consults never accumulates.
    await pruneEmptyDrafts();
    const r = await load();
    setItems(r);
    setLoaded(true);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

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

  // Swipe-to-delete: confirm first, then wipe the consult + all child rows on-device.
  const remove = useCallback(
    (c: Consult) => {
      Alert.alert("Delete consult?", `"${c.title}" and its note will be permanently removed.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void deleteConsult(c.id).then(reload),
        },
      ]);
    },
    [reload],
  );

  const today = items.filter((c) => isToday(c.createdAt));
  const earlier = items.filter((c) => !isToday(c.createdAt));

  return (
    <TabScaffold title={title} onRefresh={reload}>
      {topSlot}
      {!loaded ? null : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name={emptyIcon} size={30} color={colors.ink3} />
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          <Text style={styles.emptyBody}>{emptyBody}</Text>
        </View>
      ) : (
        <>
          {today.length > 0 ? (
            <Group label="Today" items={today} onRename={rename} onRemove={remove} />
          ) : null}
          {earlier.length > 0 ? (
            <Group label="Earlier" items={earlier} onRename={rename} onRemove={remove} />
          ) : null}
        </>
      )}
    </TabScaffold>
  );
}

function Group({
  label,
  items,
  onRename,
  onRemove,
}: {
  label: string;
  items: (Consult | ConsultListItem)[];
  onRename: (c: Consult) => void;
  onRemove: (c: Consult) => void;
}) {
  const reduce = useReducedMotion();
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      {items.map((c, i) => {
        const s = statusMeta(c.status);
        return (
          <Animated.View
            key={c.id}
            entering={reduce ? FadeIn.duration(200) : FadeInDown.delay(i * 45).duration(280)}
          >
            <SwipeableRow
              actions={[
                { label: "Rename", icon: "pencil", color: colors.ink3, onPress: () => onRename(c) },
                { label: "Delete", icon: "trash", color: colors.red, onPress: () => onRemove(c) },
              ]}
            >
              <ListRow
                initials={consultInitials(consultHeadline(c))}
                title={consultHeadline(c)}
                sub={consultSubtitle(c)}
                chips={consultChips(c)}
                snippet={("snippet" in c && c.snippet?.trim()) || undefined}
                right={<Pill label={s.label} variant={s.variant} />}
                onPress={() => router.push(`/consult/${c.id}`)}
                onLongPress={() => onRename(c)}
              />
            </SwipeableRow>
          </Animated.View>
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

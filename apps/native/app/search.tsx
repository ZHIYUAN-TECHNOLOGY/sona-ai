import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { ListRow } from "@/components/consult/ListRow";
import { Pill } from "@/components/consult/Pill";
import { consultInitials, statusMeta } from "@/lib/consultFormat";
import { getSearchDocs } from "@/lib/db";
import type { ConsultStatus } from "@/lib/db/types";
import { rankNotes, type SearchDoc } from "@/lib/search/noteSearch";
import { colors, font, radius, space } from "@/lib/theme";

// On-device note search — pushed over the tabs. Loads every noted consult as a
// searchable doc and ranks locally (lib/search/noteSearch). Nothing leaves the phone:
// the notes are on-device and the matching runs in-process. Tap a hit → consult detail.
export default function SearchScreen() {
  const [docs, setDocs] = useState<SearchDoc[]>([]);
  const [query, setQuery] = useState("");

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void getSearchDocs().then((d) => {
        if (alive) setDocs(d);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  const hits = useMemo(() => rankNotes(query, docs), [query, docs]);
  const q = query.trim();

  return (
    <ConsultScreen
      time=""
      title="Search notes"
      sub={`${docs.length} note${docs.length === 1 ? "" : "s"} on-device`}
      onBack={() => router.back()}
    >
      <View style={styles.field}>
        <Ionicons name="search" size={18} color={colors.ink3} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search across your notes"
          placeholderTextColor={colors.ink3}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={styles.input}
        />
        {q ? (
          <Pressable accessibilityRole="button" onPress={() => setQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.ink3} />
          </Pressable>
        ) : null}
      </View>

      {!q ? (
        <Text style={styles.hint}>
          Search titles, findings, and orders. All matching happens on this device.
        </Text>
      ) : hits.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="search-outline" size={28} color={colors.ink3} />
          <Text style={styles.emptyTitle}>No matches</Text>
          <Text style={styles.emptyBody}>Nothing found for “{q}”.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          <Text style={styles.count}>
            {hits.length} result{hits.length === 1 ? "" : "s"}
          </Text>
          {hits.map((h, i) => {
            const s = statusMeta(h.doc.status as ConsultStatus);
            return (
              <Animated.View
                key={h.doc.consultId}
                entering={FadeIn.delay(Math.min(i, 8) * 30).duration(220)}
              >
                <ListRow
                  initials={consultInitials(h.doc.title)}
                  title={h.doc.title}
                  sub={h.snippet}
                  right={<Pill label={s.label} variant={s.variant} />}
                  onPress={() => router.push(`/consult/${h.doc.consultId}`)}
                />
              </Animated.View>
            );
          })}
        </View>
      )}
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderCurve: "continuous",
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  input: { ...font.body, color: colors.ink, flex: 1, padding: 0 },
  hint: { ...font.bodySm, color: colors.ink3, marginTop: space.md, paddingHorizontal: space.xs },
  count: { ...font.label, color: colors.ink3, textTransform: "uppercase", marginBottom: space.xs },
  list: { gap: space.sm, marginTop: space.md },
  empty: { alignItems: "center", gap: space.sm, paddingVertical: 56 },
  emptyTitle: { ...font.h3, color: colors.ink },
  emptyBody: { ...font.body, color: colors.ink3, textAlign: "center" },
});

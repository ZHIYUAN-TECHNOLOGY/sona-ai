import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { ListRow } from "@/components/consult/ListRow";
import { Pill } from "@/components/consult/Pill";
import { consultInitials, statusMeta } from "@/lib/consultFormat";
import type { ConsultStatus } from "@/lib/db/types";
import { useSemanticNoteSearch, type NoteSearchResult } from "@/lib/search/useSemanticNoteSearch";
import { colors, font, radius, space } from "@/lib/theme";

// On-device note search — pushed over the tabs. Semantic (executorch MiniLM over a
// persisted vector store) with a lexical fallback until the model loads. Nothing
// leaves the phone: notes, vectors, and the query are all on-device. Tap a hit →
// consult detail.
export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const { search, reload, semanticReady, downloadProgress, count } = useSemanticNoteSearch();
  const [result, setResult] = useState<NoteSearchResult>({ hits: [], mode: "keyword" });

  // Debounce the query so we don't fire a native embed + cosine scan on every keystroke;
  // clearing is instant.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    if (!query.trim()) {
      setDebounced(query);
      return;
    }
    const id = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  // Re-load notes (+ embed any new ones) whenever the screen regains focus, so notes
  // added/edited while it stayed mounted under a pushed detail are reflected.
  useFocusEffect(useCallback(() => void reload(), [reload]));

  useEffect(() => {
    let alive = true;
    void search(debounced).then((r) => {
      if (alive) setResult(r);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, semanticReady]);

  const hits = result.hits;
  const q = debounced.trim();
  const loadingModel = !semanticReady && downloadProgress > 0 && downloadProgress < 1;

  return (
    <ConsultScreen
      time=""
      title="Search notes"
      sub={`${count} note${count === 1 ? "" : "s"} on-device`}
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
          <Pressable
            accessibilityRole="button"
            onPress={() => setQuery("")}
            hitSlop={8}
            style={({ pressed }) => pressed && { opacity: 0.5, transform: [{ scale: 0.9 }] }}
          >
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
          <View style={styles.countRow}>
            <Text style={styles.count}>
              {hits.length} result{hits.length === 1 ? "" : "s"}
            </Text>
            <View style={styles.modeChip}>
              <Ionicons
                name={loadingModel ? "cloud-download-outline" : result.mode === "semantic" ? "sparkles" : "search"}
                size={11}
                color={colors.green}
              />
              <Text style={styles.modeText}>
                {loadingModel
                  ? `Semantic ${Math.round(downloadProgress * 100)}%`
                  : result.mode === "semantic"
                    ? "Semantic"
                    : "Keyword"}
              </Text>
            </View>
          </View>
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
  count: { ...font.label, color: colors.ink3, textTransform: "uppercase" },
  countRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.xs },
  modeChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  modeText: { ...font.label, color: colors.green, fontWeight: "700", fontVariant: ["tabular-nums"] },
  list: { gap: space.sm, marginTop: space.md },
  empty: { alignItems: "center", gap: space.sm, paddingVertical: 56 },
  emptyTitle: { ...font.h3, color: colors.ink },
  emptyBody: { ...font.body, color: colors.ink3, textAlign: "center" },
});

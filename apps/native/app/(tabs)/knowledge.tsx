import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { Card } from "@/components/consult/Card";
import { Pill } from "@/components/consult/Pill";
import { TabScaffold } from "@/components/consult/TabScaffold";
import { CATEGORIES, CORPUS, type KnowledgeDoc } from "@/lib/knowledge/corpus";
import { retrieve } from "@/lib/knowledge/retrieve";
import { colors, font, radius, space } from "@/lib/theme";

const LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

// Tab 5 — Knowledge. "Ask the clinic": type a question and get the most relevant
// guideline snippets, retrieved on-device from a bundled reference corpus (no query
// or note ever leaves the phone). Idle → browse by category. Retrieval is lexical
// today; the KnowledgeDoc/retrieve seam upgrades to on-device embeddings later.
export default function KnowledgeScreen() {
  const [query, setQuery] = useState("");
  const q = query.trim();
  const hits = useMemo(() => (q ? retrieve(q, CORPUS, 6) : []), [q]);

  return (
    <TabScaffold title="Knowledge">
      <View style={styles.field}>
        <Ionicons name="sparkles" size={17} color={colors.green} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Ask the clinic — e.g. when to refer chest pain"
          placeholderTextColor={colors.ink3}
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
        />
        {q ? (
          <Pressable accessibilityRole="button" onPress={() => setQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.ink3} />
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.disclaimer}>
        On-device reference · {CORPUS.length} entries · not a substitute for clinical judgement.
      </Text>

      {q ? (
        hits.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="sparkles-outline" size={26} color={colors.ink3} />
            <Text style={styles.emptyTitle}>No match</Text>
            <Text style={styles.emptyBody}>Nothing found for “{q}”. Try a symptom or “refer”.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {hits.map((h, i) => (
              <Animated.View key={h.doc.id} entering={FadeIn.delay(Math.min(i, 6) * 30).duration(220)}>
                <KnowledgeCard doc={h.doc} />
              </Animated.View>
            ))}
          </View>
        )
      ) : (
        CATEGORIES.map((cat) => {
          const items = CORPUS.filter((d) => d.category === cat.key);
          if (items.length === 0) return null;
          return (
            <View key={cat.key} style={styles.section}>
              <Text style={styles.sectionLabel}>{cat.label}</Text>
              <View style={styles.list}>
                {items.map((d) => (
                  <KnowledgeCard key={d.id} doc={d} />
                ))}
              </View>
            </View>
          );
        })
      )}
    </TabScaffold>
  );
}

function KnowledgeCard({ doc }: { doc: KnowledgeDoc }) {
  return (
    <Card>
      <Text style={styles.cardTitle}>{doc.title}</Text>
      <Text style={styles.cardText}>{doc.text}</Text>
      <View style={styles.cardMeta}>
        <Pill label={LABEL[doc.category] ?? doc.category} variant="green" />
        <Pill label={doc.source} variant="line" />
      </View>
    </Card>
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
  disclaimer: { ...font.bodySm, color: colors.ink3, paddingHorizontal: space.xs },
  section: { gap: space.sm },
  sectionLabel: { ...font.label, color: colors.ink3, textTransform: "uppercase", marginTop: space.xs },
  list: { gap: space.sm },
  cardTitle: { ...font.body, fontWeight: "700", color: colors.ink, marginBottom: 4 },
  cardText: { ...font.body, color: colors.ink2, lineHeight: 21 },
  cardMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: space.sm },
  empty: { alignItems: "center", gap: space.sm, paddingVertical: 56 },
  emptyTitle: { ...font.h3, color: colors.ink },
  emptyBody: { ...font.body, color: colors.ink3, textAlign: "center", paddingHorizontal: space.lg },
});

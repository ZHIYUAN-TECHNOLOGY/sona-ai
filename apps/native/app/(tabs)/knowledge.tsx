import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { Card } from "@/components/consult/Card";
import { Pill } from "@/components/consult/Pill";
import { TabScaffold } from "@/components/consult/TabScaffold";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { CATEGORIES, getCorpus, type KnowledgeDoc } from "@/lib/knowledge/corpus";
import {
  useGroundedAnswer,
  type AnswerStatus,
  type GroundedAnswer,
} from "@/lib/knowledge/useGroundedAnswer";
import { useSemanticRetrieve, type RetrieveResult } from "@/lib/knowledge/useSemanticRetrieve";
import { colors, font, radius, space } from "@/lib/theme";

const LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

// Tab 5 — Knowledge. "Ask the clinic": type a question and get the most relevant
// guideline snippets, retrieved on-device from a bundled reference corpus (no query
// or note ever leaves the phone). Idle → browse by category. Retrieval is lexical
// today; the KnowledgeDoc/retrieve seam upgrades to on-device embeddings later.
export default function KnowledgeScreen() {
  const corpus = getCorpus();
  const [query, setQuery] = useState("");
  const q = query.trim();
  const { search, semanticReady, downloadProgress } = useSemanticRetrieve();
  const [result, setResult] = useState<RetrieveResult>({ hits: [], mode: "keyword" });

  // Retrieve on query change (and once semantic search comes online). Async because
  // the semantic path embeds the query on-device; the lexical fallback resolves
  // immediately. Latest-wins guard avoids an out-of-order stale result.
  useEffect(() => {
    let alive = true;
    void search(query, 6).then((r) => {
      if (alive) setResult(r);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, semanticReady]);

  const hits = result.hits;
  const loadingModel = !semanticReady && downloadProgress > 0 && downloadProgress < 1;

  // Opt-in grounded answer (lazy on-device LLM). Cleared whenever the query changes so
  // a stale answer never shows against a new question.
  const grounded = useGroundedAnswer();
  useEffect(() => {
    grounded.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const answer = grounded.answer && grounded.answer.question === q ? grounded.answer : null;

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
        On-device reference · {corpus.length} entries · not a substitute for clinical judgement.
      </Text>

      {loadingModel ? (
        <Text style={styles.modeText}>Loading semantic model… {Math.round(downloadProgress * 100)}%</Text>
      ) : q ? (
        <View style={styles.modeChip}>
          <Ionicons
            name={result.mode === "semantic" ? "sparkles" : "search"}
            size={11}
            color={colors.green}
          />
          <Text style={styles.modeText}>
            {result.mode === "semantic" ? "Semantic" : "Keyword"} search
          </Text>
        </View>
      ) : null}

      {q ? (
        hits.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="sparkles-outline" size={26} color={colors.ink3} />
            <Text style={styles.emptyTitle}>No match</Text>
            <Text style={styles.emptyBody}>Nothing found for “{q}”. Try a symptom or “refer”.</Text>
          </View>
        ) : (
          <>
            <AnswerBlock
              answer={answer}
              status={grounded.status}
              downloadProgress={grounded.downloadProgress}
              onAsk={() => grounded.ask(q, hits)}
            />
            <Text style={styles.sourcesLabel}>{answer ? "Sources" : `${hits.length} references`}</Text>
            <View style={styles.list}>
              {hits.map((h, i) => (
                <Animated.View key={h.doc.id} entering={FadeIn.delay(Math.min(i, 6) * 30).duration(220)}>
                  <KnowledgeCard doc={h.doc} />
                </Animated.View>
              ))}
            </View>
          </>
        )
      ) : (
        CATEGORIES.map((cat) => {
          const items = corpus.filter((d) => d.category === cat.key);
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

function AnswerBlock({
  answer,
  status,
  downloadProgress,
  onAsk,
}: {
  answer: GroundedAnswer | null;
  status: AnswerStatus;
  downloadProgress: number;
  onAsk: () => void;
}) {
  if (answer) {
    return (
      <Animated.View entering={FadeIn.duration(240)}>
        <Card variant="green">
          <View style={styles.answerHead}>
            <Ionicons name="sparkles" size={15} color={colors.green} />
            <Text style={styles.answerLabel}>AI answer</Text>
          </View>
          <Text style={styles.answerText}>{answer.text}</Text>
          {answer.cited.length > 0 ? (
            <View style={styles.cardMeta}>
              {answer.cited.map((n) => (
                <Pill key={n} label={`[${n}] ${answer.sources[n - 1]?.title ?? ""}`} variant="line" />
              ))}
            </View>
          ) : null}
          <Text style={styles.answerNote}>
            Generated on-device from the sources below — verify before acting.
          </Text>
        </Card>
      </Animated.View>
    );
  }
  if (status === "loading-model" || status === "thinking") {
    return (
      <View style={styles.answerPending}>
        <ActivityIndicator color={colors.green} />
        <Text style={styles.pendingText}>
          {status === "loading-model"
            ? `Loading on-device model… ${Math.round(downloadProgress * 100)}%`
            : "Generating answer…"}
        </Text>
      </View>
    );
  }
  if (status === "error") {
    return <Text style={styles.pendingText}>Couldn’t generate an answer — see the references below.</Text>;
  }
  return (
    <PrimaryButton
      label="Generate answer"
      variant="ghost"
      icon={<Ionicons name="sparkles" size={16} color={colors.green} />}
      onPress={onAsk}
    />
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
  modeChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: space.xs },
  modeText: { ...font.bodySm, color: colors.green, fontWeight: "600", paddingHorizontal: space.xs },
  section: { gap: space.sm },
  sectionLabel: { ...font.label, color: colors.ink3, textTransform: "uppercase", marginTop: space.xs },
  list: { gap: space.sm },
  answerHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  answerLabel: { ...font.label, color: colors.green, textTransform: "uppercase" },
  answerText: { ...font.body, color: colors.ink, lineHeight: 22 },
  answerNote: { ...font.bodySm, color: colors.ink3, fontStyle: "italic", marginTop: space.sm },
  answerPending: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm },
  pendingText: { ...font.body, color: colors.ink3 },
  sourcesLabel: { ...font.label, color: colors.ink3, textTransform: "uppercase", marginTop: space.xs },
  cardTitle: { ...font.body, fontWeight: "700", color: colors.ink, marginBottom: 4 },
  cardText: { ...font.body, color: colors.ink2, lineHeight: 21 },
  cardMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: space.sm },
  empty: { alignItems: "center", gap: space.sm, paddingVertical: 56 },
  emptyTitle: { ...font.h3, color: colors.ink },
  emptyBody: { ...font.body, color: colors.ink3, textAlign: "center", paddingHorizontal: space.lg },
});

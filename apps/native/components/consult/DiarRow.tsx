import { StyleSheet, Text, View } from "react-native";

import type { SpeakerKey, TextSpan } from "@/components/consult/mockData";
import { colors } from "@/lib/theme";

const WHO: Record<SpeakerKey, { label: string; color: string; bg: string; border: string }> = {
  dr: { label: "DR", color: colors.greenInk, bg: colors.green50, border: colors.green100 },
  pt: { label: "PT", color: colors.blue, bg: colors.blue50, border: colors.blueLine },
  you: { label: "YOU", color: colors.ink3, bg: colors.surface, border: colors.line },
};

/**
 * One diarized transcript line: a colour-tagged speaker chip + the utterance.
 * BM spans are highlighted green inline (code-switch made visible).
 */
export function DiarRow({
  speaker,
  spans,
  faint = false,
}: {
  speaker: SpeakerKey;
  spans: TextSpan[];
  faint?: boolean;
}) {
  const who = WHO[speaker];
  return (
    <View style={styles.row}>
      <View style={[styles.who, { backgroundColor: who.bg, borderColor: who.border }]}>
        <Text style={[styles.whoText, { color: who.color }]}>{who.label}</Text>
      </View>
      <Text style={[styles.p, faint && styles.faint]}>
        {spans.map((s, i) =>
          s.bm ? (
            <Text key={i} style={styles.bm}>
              {s.text}
            </Text>
          ) : (
            <Text key={i}>{s.text}</Text>
          )
        )}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 9, marginTop: 10, alignItems: "flex-start" },
  who: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 1,
  },
  whoText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  p: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.ink },
  faint: { color: colors.ink2 },
  bm: {
    backgroundColor: colors.green50,
    color: colors.greenInk,
  },
});

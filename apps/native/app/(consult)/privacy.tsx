import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import {
  redactedPreview,
  redactionCount,
  reidMap,
  uncertainRedaction,
  type RedactedLine,
} from "@/components/consult/mockData";
import { Pill } from "@/components/consult/Pill";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { RedactChip } from "@/components/consult/RedactChip";
import { CardHeading } from "@/components/consult/SectionLabel";
import { colors } from "@/lib/theme";

// Screen 3 of 6 — Privacy gate: the exact de-identified text the model will see,
// the low-confidence "tap to confirm" name, and the device-only re-ID map.
export default function PrivacyScreen() {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <ConsultScreen
      time="9:43"
      title="Privacy gate"
      sub="Before any model reads text"
      onBack={() => router.back()}
      right={<Pill label={`${redactionCount} removed`} variant="red" dot />}
      footer={
        <PrimaryButton label="Continue to note" onPress={() => router.push("/note")} />
      }
    >
      <Card>
        <CardHeading>What the model will see</CardHeading>
        {redactedPreview.map((line, i) => (
          <RedactedRow key={i} line={line} />
        ))}
      </Card>

      <Card variant="amber">
        <CardHeading color={colors.amber}>1 uncertain, tap to confirm</CardHeading>
        <View style={styles.uncertainRow}>
          <WhoTag speaker="pt" />
          <Text style={styles.uncertainText}>
            {uncertainRedaction.before}
            <Text> </Text>
          </Text>
          {confirmed ? (
            <RedactChip token="NAME_2" />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Confirm ${uncertainRedaction.name} is an identifier`}
              onPress={() => setConfirmed(true)}
              style={styles.dashed}
            >
              <Text style={styles.dashedText}>{uncertainRedaction.name}</Text>
            </Pressable>
          )}
          <Text style={styles.uncertainText}>{uncertainRedaction.after}</Text>
        </View>
        <Text style={styles.amberNote}>
          {confirmed
            ? "Confirmed. Redacted locally as NAME_2. Still 0 bytes sent."
            : uncertainRedaction.note}
        </Text>
      </Card>

      <Card variant="green">
        <CardHeading>Re-identify map</CardHeading>
        <Text style={styles.body}>
          Tokens map back to the real details only on this device, at render time.
        </Text>
        <View style={styles.mapList}>
          {reidMap.map((m) => (
            <View key={m.token} style={styles.mapRow}>
              <RedactChip token={m.token} />
              <Text style={styles.mapArrow}>→</Text>
              <Text style={styles.mapReal} numberOfLines={1}>
                {m.real}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.chiprow}>
          <Pill label="Sealed in Secure Enclave" variant="green" />
        </View>
      </Card>

      <Card variant="tint">
        <View style={styles.row}>
          <CardHeading>Leaving this phone</CardHeading>
          <Pill label="0 bytes" variant="green" />
        </View>
      </Card>
    </ConsultScreen>
  );
}

// A redacted transcript line: speaker tag + wrapping run of text fragments and chips.
function RedactedRow({ line }: { line: RedactedLine }) {
  return (
    <View style={styles.redactRow}>
      <WhoTag speaker={line.speaker} />
      <View style={styles.redactBody}>
        {line.parts.map((part, i) =>
          typeof part === "string" ? (
            <Text key={i} style={[styles.redactText, line.faint && styles.faint]}>
              {part}
            </Text>
          ) : (
            <RedactChip key={i} token={part.token} />
          )
        )}
      </View>
    </View>
  );
}

function WhoTag({ speaker }: { speaker: "dr" | "pt" | "you" }) {
  const map = {
    dr: { label: "DR", color: colors.greenInk, bg: colors.green50, border: colors.green100 },
    pt: { label: "PT", color: colors.blue, bg: colors.blue50, border: colors.blueLine },
    you: { label: "YOU", color: colors.ink3, bg: colors.surface, border: colors.line },
  }[speaker];
  return (
    <View style={[styles.who, { backgroundColor: map.bg, borderColor: map.border }]}>
      <Text style={[styles.whoText, { color: map.color }]}>{map.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  redactRow: { flexDirection: "row", gap: 9, marginTop: 10, alignItems: "flex-start" },
  redactBody: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    rowGap: 3,
  },
  redactText: { fontSize: 12, lineHeight: 18, color: colors.ink },
  faint: { color: colors.ink2 },
  who: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 1,
  },
  whoText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },

  uncertainRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
    rowGap: 4,
  },
  uncertainText: { fontSize: 12, lineHeight: 18, color: colors.ink2 },
  dashed: {
    borderBottomWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.amber,
  },
  dashedText: { fontSize: 12, fontWeight: "600", color: colors.amber },
  amberNote: { marginTop: 8, fontSize: 10.5, color: colors.amber, lineHeight: 15 },

  body: { marginTop: 5, fontSize: 11.5, color: colors.ink2, lineHeight: 17 },
  mapList: { marginTop: 9, gap: 6 },
  mapRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  mapArrow: { fontSize: 12, color: colors.ink3 },
  mapReal: { flex: 1, fontSize: 11.5, color: colors.ink, fontWeight: "500" },
  chiprow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
});

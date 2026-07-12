import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import type { Speaker } from "@/lib/db/types";
import { haptic } from "@/lib/haptics";
import { useConsultPipeline } from "@/lib/pipeline/PipelineProvider";
import { colors, font, space } from "@/lib/theme";

const ROLES: { key: Speaker; label: string; color: string; bg: string; border: string }[] = [
  { key: "doctor", label: "Doctor", color: colors.greenInk, bg: colors.green50, border: colors.green100 },
  { key: "patient", label: "Patient", color: colors.blue, bg: colors.blue50, border: colors.blueLine },
  { key: "unknown", label: "Other", color: colors.amber, bg: colors.amber50, border: colors.amberLine },
];

// After a REAL consult, on-device diarization found N anonymous speakers ("Speaker 1/2/…").
// The clinician assigns each one a role (Doctor / Patient / Other) — more reliable than
// guessing. On confirm the labels are applied to the transcript, then the privacy gate runs.
export default function LabelScreen() {
  const { candidates, applySpeakerLabels, captureDiag } = useConsultPipeline();
  const [labels, setLabels] = useState<Record<number, Speaker>>({});
  const [saving, setSaving] = useState(false);

  // Unique clusters (skip the −1 "no-overlap" bucket) with a couple of sample utterances.
  const clusters = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const c of candidates) {
      if (c.cluster < 0) continue;
      const arr = map.get(c.cluster) ?? [];
      if (arr.length < 2) arr.push(c.text);
      map.set(c.cluster, arr);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([cluster, samples]) => ({ cluster, samples }));
  }, [candidates]);

  const allLabeled = clusters.length > 0 && clusters.every((c) => labels[c.cluster]);

  const confirm = async () => {
    setSaving(true);
    haptic("tap");
    try {
      await applySpeakerLabels(labels);
      router.push("/privacy");
    } catch (e) {
      // Surface the exact failure (e.g. "Consult row missing: <id>") instead of a red screen.
      Alert.alert("Couldn't save the transcript", String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConsultScreen
      time="9:42"
      title="Who spoke?"
      sub="Label the speakers we heard"
      onBack={() => router.back()}
      footer={
        clusters.length === 0 ? (
          <PrimaryButton label="Continue" onPress={confirm} disabled={saving} />
        ) : (
          <PrimaryButton
            label={saving ? "Saving…" : "Continue"}
            onPress={confirm}
            disabled={saving || !allLabeled}
          />
        )
      }
    >
      {clusters.length === 0 ? (
        <Card>
          <View style={styles.empty}>
            <Ionicons name="mic-off-outline" size={26} color={colors.ink3} />
            <Text style={styles.emptyTitle}>No speech detected</Text>
            <Text style={styles.emptyBody}>
              We didn&apos;t catch enough audio to separate speakers. Continue to review, or go
              back and record again.
            </Text>
            {captureDiag ? (
              <Text style={styles.diag} selectable>
                {`audio ${captureDiag.seconds}s · peak ${captureDiag.peak} · transcript ${captureDiag.transcriptChars} chars · ${captureDiag.vadSegments} speech segs`}
                {captureDiag.sttError ? `\nSTT: ${captureDiag.sttError}` : ""}
                {captureDiag.vadError ? `\nVAD: ${captureDiag.vadError}` : ""}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : (
        clusters.map(({ cluster, samples }, i) => (
          <Card key={cluster}>
            <Text style={styles.spk}>{`Speaker ${i + 1}`}</Text>
            {samples.map((s, j) => (
              <Text key={j} style={styles.sample} numberOfLines={2}>
                “{s}”
              </Text>
            ))}
            <View style={styles.roles}>
              {ROLES.map((r) => {
                const on = labels[cluster] === r.key;
                return (
                  <Pressable
                    key={r.key}
                    onPress={() => {
                      haptic("select");
                      setLabels((prev) => ({ ...prev, [cluster]: r.key }));
                    }}
                    style={[
                      styles.role,
                      { borderColor: on ? r.border : colors.line, backgroundColor: on ? r.bg : colors.surface },
                    ]}
                  >
                    <Text style={[styles.roleLabel, { color: on ? r.color : colors.ink2 }]}>{r.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        ))
      )}
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  spk: { ...font.label, color: colors.ink3, textTransform: "uppercase" },
  sample: { ...font.body, color: colors.ink, marginTop: 6, lineHeight: 20 },
  roles: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  role: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    borderCurve: "continuous",
    paddingVertical: 10,
    alignItems: "center",
  },
  roleLabel: { ...font.body, fontWeight: "600" },
  empty: { alignItems: "center", gap: space.sm, paddingVertical: space.lg },
  emptyTitle: { ...font.h3, color: colors.ink },
  emptyBody: { ...font.bodySm, color: colors.ink3, textAlign: "center" },
  diag: {
    ...font.bodySm,
    color: colors.ink2,
    textAlign: "center",
    marginTop: space.sm,
    fontVariant: ["tabular-nums"],
  },
});

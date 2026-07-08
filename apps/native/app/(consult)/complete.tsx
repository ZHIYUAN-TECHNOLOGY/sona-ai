import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { proof } from "@/components/consult/mockData";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { CardHeading } from "@/components/consult/SectionLabel";
import { Stat } from "@/components/consult/Stat";
import { getAudit } from "@/lib/db";
import type { AuditEntry } from "@/lib/db/types";
import { markComplete } from "@/lib/pipeline/consultPipeline";
import { useConsultPipeline } from "@/lib/pipeline/PipelineProvider";
import { colors } from "@/lib/theme";

function hhmm(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Screen 6 of 6 — Consult complete: the REAL on-device audit log (append-only,
// from SQLite) and the "0 bytes transmitted" proof. Every row is evidence the
// consult ran entirely on-device.
export default function CompleteScreen() {
  const { consultId, reset } = useConsultPipeline();
  const [rows, setRows] = useState<AuditEntry[]>([]);

  useEffect(() => {
    if (!consultId) return;
    void markComplete(consultId);
    void getAudit(consultId).then(setRows);
  }, [consultId]);

  // Done: reset pipeline state, dismiss the consult stack, and return to the Today
  // tab — the just-signed consult now appears in the list. Start next: restart a
  // fresh consult in place.
  const done = () => {
    reset();
    if (router.canDismiss?.()) router.dismissAll();
    router.navigate("/");
  };
  const startNext = () => {
    reset();
    router.replace("/consent");
  };

  return (
    <ConsultScreen
      time="9:47"
      title="Consult complete"
      sub={proof.duration}
      footer={
        <View style={styles.footer}>
          <PrimaryButton label="Done" onPress={done} />
          <PrimaryButton label="Start next consult" variant="ghost" onPress={startNext} />
        </View>
      }
    >
      <Stat value={proof.bytesLabel} label={proof.bytesSub} />

      <Card>
        <CardHeading>Audit log</CardHeading>
        <View style={styles.log}>
          {rows.map((row, i) => (
            <View key={row.id} style={[styles.ar, i > 0 && styles.arDivider]}>
              <Text style={styles.t}>{hhmm(row.ts)}</Text>
              <Ionicons name="checkmark" size={13} color={colors.green} />
              <Text style={styles.detail}>{row.detail}</Text>
            </View>
          ))}
        </View>
      </Card>
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: 8 },
  log: { marginTop: 4 },
  ar: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  arDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  t: { width: 34, fontSize: 10.5, color: colors.ink3, fontVariant: ["tabular-nums"] },
  detail: { flex: 1, fontSize: 11, color: colors.ink2 },
});

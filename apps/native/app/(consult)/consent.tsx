import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { consult } from "@/components/consult/mockData";
import { Pill } from "@/components/consult/Pill";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { CardHeading } from "@/components/consult/SectionLabel";
import { Steps } from "@/components/consult/Steps";
import { Toggle } from "@/components/consult/Toggle";
import type { VisitType } from "@/lib/db/types";
import { useConsultPipeline } from "@/lib/pipeline/PipelineProvider";
import { clearPendingScanDoc } from "@/lib/pipeline/scanAttach";
import { templateById } from "@/lib/pipeline/templates";
import { colors, font, radius, space } from "@/lib/theme";

// Screen 1 of 6 — Consent + audit start.
export default function ConsentScreen() {
  const [sealConsent, setSealConsent] = useState(true);
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [room, setRoom] = useState("");
  const [visitType, setVisitType] = useState<VisitType | null>(null);
  const { startConsult, templateId } = useConsultPipeline();
  const starting = useRef(false);
  const template = templateById(templateId);

  // Create the consult (SQLite row + consent audit entry) on-device, then advance.
  // Guarded so a double-tap can't spawn two consults.
  const start = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;
    await startConsult(consult.consentText, { patientName, patientPhone, room, visitType });
    router.push("/recording");
  }, [startConsult, patientName, patientPhone, room, visitType]);

  // Escape hatch: consent is the flow entry (launched from the Record capsule) and
  // swipe-back is disabled, so an accidental start must be cancellable back to Today.
  const cancel = useCallback(() => {
    clearPendingScanDoc(); // abandoned scan handoff must never attach to a later consult
    if (router.canDismiss?.()) router.dismissAll();
    router.navigate("/");
  }, []);

  // Backstop for ANY exit that isn't startConsult (cancel, swipe, crash-nav): a scan
  // doc parked by "New consult with this document" is one-shot — if this screen goes
  // away without starting, the handoff dies with it. startConsult consumes the id
  // before unmount, so the successful path is unaffected.
  useEffect(
    () => () => {
      clearPendingScanDoc();
    },
    [],
  );

  return (
    <ConsultScreen
      time="9:41"
      title="New consult"
      sub={consult.room}
      onBack={cancel}
      right={<Pill label="On-device" variant="green" dot />}
      footer={<PrimaryButton label="Start consult" onPress={start} />}
    >
      <Card variant="green">
        <CardHeading>Patient consent</CardHeading>
        <Text style={styles.consentQuote}>“{consult.consentText}”</Text>
        <Text style={styles.body}>Consent is captured spoken, in the first ten seconds.</Text>
        <View style={styles.row}>
          <Text style={styles.micro}>Seal consent line in the audit log</Text>
          <Toggle value={sealConsent} onValueChange={setSealConsent} />
        </View>
      </Card>

      <Card>
        <CardHeading>Patient details</CardHeading>
        <Text style={styles.body}>
          Optional. Stays on this phone only — never sent to the AI or exported.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Patient name"
          placeholderTextColor={colors.ink3}
          value={patientName}
          onChangeText={setPatientName}
          autoCorrect={false}
        />
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, styles.inputHalf]}
            placeholder="Phone"
            placeholderTextColor={colors.ink3}
            value={patientPhone}
            onChangeText={setPatientPhone}
            keyboardType="phone-pad"
          />
          <TextInput
            style={[styles.input, styles.inputHalf]}
            placeholder="Room / bed"
            placeholderTextColor={colors.ink3}
            value={room}
            onChangeText={setRoom}
            autoCorrect={false}
          />
        </View>
        <View style={styles.chiprow}>
          {(["walk-in", "appointment"] as const).map((v) => (
            <Pressable
              key={v}
              accessibilityRole="button"
              accessibilityState={{ selected: visitType === v }}
              onPress={() => setVisitType(visitType === v ? null : v)}
              style={[styles.visitChip, visitType === v && styles.visitChipOn]}
            >
              <Text style={[styles.visitChipText, visitType === v && styles.visitChipTextOn]}>
                {v === "walk-in" ? "Walk-in" : "Appointment"}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card variant="tint">
        <CardHeading>Where this consult lives</CardHeading>
        <Text style={styles.body}>
          Audio, transcript and identifiers stay on this phone. Audio is deleted the moment you sign.
        </Text>
        <View style={styles.chiprow}>
          <Pill label="Works offline" variant="green" />
          <Pill label="0 bytes to cloud" variant="line" />
        </View>
      </Card>

      <Card>
        <CardHeading>Note template</CardHeading>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Note template: ${template.name}. Tap to change.`}
          onPress={() => router.push("/template")}
          style={({ pressed }) => [styles.tmpl, pressed && styles.tmplPressed]}
        >
          <View style={styles.tmplIcon}>
            <Ionicons name={template.icon} size={18} color={colors.green} />
          </View>
          <View style={styles.tmplText}>
            <Text style={styles.tmplName}>{template.name}</Text>
            <Text style={styles.tmplDesc}>{template.description}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.ink3} />
        </Pressable>
      </Card>

      <Card>
        <Steps
          items={["Record the consult", "Names removed on-device", "Review, sign, export"]}
        />
      </Card>
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  consentQuote: {
    marginTop: 6,
    fontSize: 13,
    fontStyle: "italic",
    color: colors.greenInk,
    lineHeight: 19,
  },
  body: { marginTop: 5, fontSize: 11.5, color: colors.ink2, lineHeight: 17 },
  row: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  micro: { flex: 1, fontSize: 10.5, color: colors.ink3 },
  chiprow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 },
  input: {
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: colors.ink,
    backgroundColor: colors.bg,
  },
  inputRow: { flexDirection: "row", gap: 8 },
  inputHalf: { flex: 1 },
  visitChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  visitChipOn: { backgroundColor: colors.greenSoft, borderColor: colors.green },
  visitChipText: { fontSize: 11.5, color: colors.ink2 },
  visitChipTextOn: { color: colors.greenInk, fontWeight: "600" },
  tmpl: { flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.md },
  tmplPressed: { opacity: 0.6 },
  tmplIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  tmplText: { flex: 1, minWidth: 0 },
  tmplName: { ...font.body, fontWeight: "600", color: colors.ink },
  tmplDesc: { ...font.bodySm, color: colors.ink3, marginTop: 1 },
});

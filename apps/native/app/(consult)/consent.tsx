import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { ChooseTemplateSheet } from "@/components/consult/ChooseTemplateSheet";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { consult } from "@/components/consult/mockData";
import { Pill } from "@/components/consult/Pill";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { CardHeading } from "@/components/consult/SectionLabel";
import { Steps } from "@/components/consult/Steps";
import { Toggle } from "@/components/consult/Toggle";
import { useConsultPipeline } from "@/lib/pipeline/PipelineProvider";
import { templateById } from "@/lib/pipeline/templates";
import { colors, font, radius, space } from "@/lib/theme";

// Screen 1 of 6 — Consent + audit start.
export default function ConsentScreen() {
  const [sealConsent, setSealConsent] = useState(true);
  const { startConsult, templateId, setTemplate } = useConsultPipeline();
  const starting = useRef(false);
  const [templateSheet, setTemplateSheet] = useState(false);
  const template = templateById(templateId);

  // Create the consult (SQLite row + consent audit entry) on-device, then advance.
  // Guarded so a double-tap can't spawn two consults.
  const start = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;
    await startConsult(consult.consentText);
    router.push("/recording");
  }, [startConsult]);

  // Escape hatch: consent is the flow entry (launched from the Record capsule) and
  // swipe-back is disabled, so an accidental start must be cancellable back to Today.
  const cancel = useCallback(() => {
    if (router.canDismiss?.()) router.dismissAll();
    router.navigate("/");
  }, []);

  return (
    <>
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
          accessibilityLabel={`Note template: ${template.name}`}
          onPress={() => setTemplateSheet(true)}
          style={({ pressed }) => [styles.tmpl, pressed && styles.tmplPressed]}
        >
          <View style={styles.tmplIcon}>
            <Ionicons name={template.icon} size={18} color={colors.green} />
          </View>
          <View style={styles.tmplText}>
            <Text style={styles.tmplName}>{template.name}</Text>
            <Text style={styles.tmplDesc}>{template.description}</Text>
          </View>
          <Ionicons name="chevron-down" size={16} color={colors.ink3} />
        </Pressable>
      </Card>

      <Card>
        <Steps
          items={["Record the consult", "Names removed on-device", "Review, sign, export"]}
        />
      </Card>
    </ConsultScreen>

    <ChooseTemplateSheet
      visible={templateSheet}
      onClose={() => setTemplateSheet(false)}
      selectedId={templateId}
      onSelect={setTemplate}
    />
    </>
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

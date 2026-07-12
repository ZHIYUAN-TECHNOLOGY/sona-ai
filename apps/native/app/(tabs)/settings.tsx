import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, Switch, Text } from "react-native";

import { Card } from "@/components/consult/Card";
import { CardHeading } from "@/components/consult/SectionLabel";
import { SettingsRow } from "@/components/consult/SettingsRow";
import { TabScaffold } from "@/components/consult/TabScaffold";
import { initSpeakerModel, isDoctorEnrolled } from "@/lib/diarize";
import { NOTE_MODEL_NAME } from "@/lib/pipeline/model";
import { getSttMode, setSttMode } from "@/lib/pipeline/sttMode";
import { colors, font, space } from "@/lib/theme";

// Tab 4 — Settings, rebuilt in the green design system (replaces the deleted
// blue Better-T-Stack scaffold). On-device status, privacy posture, and about.
export default function SettingsScreen() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [diarModel, setDiarModel] = useState("Mock (band-energy)");
  const [demo, setDemo] = useState(getSttMode() === "demo");
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      isDoctorEnrolled().then((e) => alive && setEnrolled(e));
      initSpeakerModel().then((s) => alive && setDiarModel(s.real ? s.id : "Mock (band-energy)"));
      return () => {
        alive = false;
      };
    }, []),
  );

  return (
    <TabScaffold title="Settings">
      <Card>
        <CardHeading>On-device AI</CardHeading>
        <SettingsRow first icon="hardware-chip-outline" label="Note model" value={NOTE_MODEL_NAME} />
        <SettingsRow icon="mic-outline" label="Speech-to-text" value="Whisper (on-device)" />
        <SettingsRow icon="shield-checkmark-outline" label="Redaction" value="On-device" />
        <SettingsRow icon="people-outline" label="Diarization" value={diarModel} />
        <SettingsRow
          icon="albums-outline"
          label="Demo transcript"
          right={
            <Switch
              value={demo}
              onValueChange={(v) => {
                setDemo(v);
                setSttMode(v ? "demo" : "real");
              }}
            />
          }
        />
      </Card>

      <Card>
        <CardHeading>Speaker ID</CardHeading>
        <SettingsRow
          first
          icon="person-outline"
          label="My voice"
          value={enrolled === null ? "…" : enrolled ? "Enrolled" : "Not set up"}
          onPress={() => router.push("/enroll")}
        />
      </Card>

      <Card>
        <CardHeading>Privacy</CardHeading>
        <SettingsRow
          first
          icon="shield-checkmark-outline"
          label="On-device proof"
          onPress={() => router.push("/on-device" as Href)}
        />
        <SettingsRow icon="lock-closed-outline" label="Data" value="Stays on this device" />
        <SettingsRow icon="sunny-outline" label="Appearance" value="Light only" />
      </Card>

      <Card>
        <CardHeading>About</CardHeading>
        <SettingsRow first icon="information-circle-outline" label="Version" value="Sona 0.1" />
        <SettingsRow
          icon="speedometer-outline"
          label="On-device bench"
          onPress={() => router.push("/bench")}
        />
        <SettingsRow
          icon="pulse-outline"
          label="Diarization lab"
          onPress={() => router.push("/diarize-lab" as Href)}
        />
        <SettingsRow
          icon="scan-outline"
          label="Document OCR"
          onPress={() => router.push("/ocr-lab" as Href)}
        />
      </Card>

      <Text style={styles.footer}>Sona — privacy-first ambient scribe. Nothing leaves the phone.</Text>
    </TabScaffold>
  );
}

const styles = StyleSheet.create({
  footer: {
    ...font.bodySm,
    color: colors.ink3,
    textAlign: "center",
    marginTop: space.md,
    paddingHorizontal: space.lg,
  },
});

import { router } from "expo-router";
import { StyleSheet, Text } from "react-native";

import { Card } from "@/components/consult/Card";
import { CardHeading } from "@/components/consult/SectionLabel";
import { SettingsRow } from "@/components/consult/SettingsRow";
import { TabScaffold } from "@/components/consult/TabScaffold";
import { NOTE_MODEL_NAME } from "@/lib/pipeline/model";
import { colors, font, space } from "@/lib/theme";

// Tab 4 — Settings, rebuilt in the green design system (replaces the deleted
// blue Better-T-Stack scaffold). On-device status, privacy posture, and about.
export default function SettingsScreen() {
  return (
    <TabScaffold title="Settings">
      <Card>
        <CardHeading>On-device AI</CardHeading>
        <SettingsRow first icon="hardware-chip-outline" label="Note model" value={NOTE_MODEL_NAME} />
        <SettingsRow icon="mic-outline" label="Speech-to-text" value="Whisper (on-device)" />
        <SettingsRow icon="shield-checkmark-outline" label="Redaction" value="On-device" />
      </Card>

      <Card>
        <CardHeading>Privacy</CardHeading>
        <SettingsRow first icon="airplane-outline" label="Network" value="Airplane · 0 bytes" />
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

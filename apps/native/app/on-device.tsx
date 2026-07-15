import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import * as Network from "expo-network";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { Card } from "@/components/consult/Card";
import { CardHeading } from "@/components/consult/SectionLabel";
import { activeSpeakerEmbedderId } from "@/lib/diarize";
import { EMBED_MODEL_NAME, NOTE_MODEL_NAME } from "@/lib/pipeline/model";
import { getSttAccuracy } from "@/lib/pipeline/sttMode";
import { whisperModelInfo } from "@/lib/pipeline/whisperStt";
import { colors, font, space } from "@/lib/theme";

// "On-device & privacy" — the moat made visible. A live network badge (run a whole consult
// in airplane mode to prove it), the models that run locally, and exactly what never leaves
// the phone. Always reachable from Settings so it can be shown at any point in a demo.
export default function OnDeviceScreen() {
  const [net, setNet] = useState<{ connected: boolean; type: string } | null>(null);

  useEffect(() => {
    let sub: { remove: () => void } | undefined;
    const update = (s: { isConnected?: boolean; type?: unknown }) =>
      setNet({ connected: !!s.isConnected, type: String(s.type ?? "UNKNOWN") });
    Network.getNetworkStateAsync().then(update).catch(() => setNet({ connected: false, type: "UNKNOWN" }));
    try {
      sub = Network.addNetworkStateListener(update);
    } catch {
      // listener unsupported — the one-shot read above is enough
    }
    return () => sub?.remove?.();
  }, []);

  const offline = net != null && (!net.connected || net.type === "NONE");

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "On-device & privacy" }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <Card variant={offline ? "green" : "default"}>
          {/* Keyed so the resolved status fades over "Checking network…" rather than snapping. */}
          <Animated.View
            key={net == null ? "checking" : offline ? "offline" : "online"}
            entering={FadeIn.duration(240)}
            style={styles.netRow}
          >
            <Ionicons
              name={offline ? "airplane" : "shield-checkmark"}
              size={22}
              color={colors.green}
            />
            <View style={styles.netBody}>
              <Text style={styles.netTitle}>
                {net == null ? "Checking network…" : offline ? "Fully offline" : "Online"}
              </Text>
              <Text style={styles.netSub}>
                {offline
                  ? "Zero bytes can leave — the whole consult runs on this phone."
                  : "Even online, your patient's data never leaves this phone."}
              </Text>
            </View>
          </Animated.View>
        </Card>

        <Card>
          <CardHeading>Runs on this phone</CardHeading>
          <Row icon="hardware-chip-outline" label="Clinical note" value={NOTE_MODEL_NAME} />
          {/* Reflect the tier actually selected in Settings, not a hardcoded one. */}
          <Row icon="mic-outline" label="Speech-to-text" value={whisperModelInfo(getSttAccuracy()).name} />
          <Row icon="search-outline" label="Search / grounding" value={EMBED_MODEL_NAME} />
          <Row icon="people-outline" label="Diarization" value={embedderDisplayName(activeSpeakerEmbedderId())} />
          <Row icon="scan-outline" label="Document OCR" value="PP-OCRv6 · Vision fallback" />
          <Row icon="volume-high-outline" label="Read aloud" value="System voices" />
        </Card>

        <Card>
          <CardHeading>Never leaves this device</CardHeading>
          <Row icon="lock-closed-outline" label="Raw audio" value="Discarded on sign" />
          <Row icon="lock-closed-outline" label="Transcript" value="On-device only" />
          <Row icon="lock-closed-outline" label="Re-identify map" value="Secure storage" />
          <Row icon="lock-closed-outline" label="Voiceprint" value="Biometric · local" />
        </Card>

        <Card variant="tint">
          <Text style={styles.moat}>
            Only de-identified text may ever cross the boundary — and only on the optional
            cloud path. The cloud control-plane carries license and non-PHI telemetry only.
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}

// Display names for embedder ids — the raw id ("mock-goertzel-bands") is a cache key,
// not a user-facing label. The value stays LIVE from activeSpeakerEmbedderId() so this
// page can never claim a model that isn't actually registered.
function embedderDisplayName(id: string): string {
  switch (id) {
    case "mock-goertzel-bands":
      return "Band-energy clustering";
    case "mfcc-stats":
      return "MFCC speaker features";
    default:
      return id; // real .pte ids (e.g. ecapa-tdnn-192) read fine as-is
  }
}

function Row({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={colors.green} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  netRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  netBody: { flex: 1 },
  netTitle: { ...font.h3, color: colors.ink },
  netSub: { ...font.bodySm, color: colors.ink2, marginTop: 2, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  rowLabel: { ...font.body, color: colors.ink, flex: 1 },
  rowValue: { ...font.bodySm, color: colors.ink3, flexShrink: 1, textAlign: "right" },
  moat: { ...font.body, color: colors.ink2, lineHeight: 21 },
});

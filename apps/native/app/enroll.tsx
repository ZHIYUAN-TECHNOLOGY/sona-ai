import { Ionicons } from "@expo/vector-icons";
import { Stack, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { CardHeading } from "@/components/consult/SectionLabel";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import {
  captureEnrollmentWindows,
  captureEnrollmentWindowsMic,
  enrollDoctorVoiceprint,
  isDoctorEnrolled,
  unenrollDoctor,
} from "@/lib/diarize";
import { haptic } from "@/lib/haptics";
import { colors, font, space } from "@/lib/theme";

// Speaker ID — clinician voiceprint enrollment (pushed from Settings). Enrolling teaches
// the on-device diarizer which voice is the clinician, so it labels the doctor positively
// in every consult (not just by language cues). BIOMETRIC PHI: the voiceprint is computed
// and stored ONLY on this device (doctor_voiceprint table) — never logged, exported, or
// transmitted. The capture is currently a mock synth window; real mic audio is a drop-in.
export default function EnrollScreen() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  // Guards setState after the async capture / DB writes resolve past an unmount.
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      isDoctorEnrolled().then((e) => alive && setEnrolled(e));
      return () => {
        alive = false;
      };
    }, []),
  );

  const enrol = async () => {
    if (busy) return;
    setBusy(true);
    haptic("recordStart");
    try {
      // Record the clinician's voice through the mic (real VAD-gated windows). Falls back to
      // synth windows if the mic / native modules aren't available (Expo Go, denied perms).
      let windows: Float32Array[];
      try {
        windows = await captureEnrollmentWindowsMic();
      } catch {
        windows = captureEnrollmentWindows();
      }
      await enrollDoctorVoiceprint(windows);
      if (mounted.current) setEnrolled(true);
      haptic("signSuccess");
    } catch {
      haptic("error");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await unenrollDoctor();
      if (mounted.current) setEnrolled(false);
      haptic("tap");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Speaker ID" }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <Card>
          <CardHeading>Why enrol</CardHeading>
          <Text style={styles.body}>
            Aurio learns your voice so it can tell which speaker is the clinician in every
            consult — even in a noisy, code-switched room with family or a nurse present.
            One time, a couple of seconds.
          </Text>
        </Card>

        <Card variant="green">
          <View style={styles.privacyRow}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.green} />
            <Text style={styles.privacyText}>
              Your voiceprint is biometric. It is computed and stored only on this device —
              never logged, exported, or sent to any server.
            </Text>
          </View>
        </Card>

        <Card>
          <CardHeading>Status</CardHeading>
          <View style={styles.statusRow}>
            {busy ? (
              <>
                <ActivityIndicator color={colors.green} />
                <Text style={styles.statusText}>Listening… hold steady</Text>
              </>
            ) : (
              <>
                <Ionicons
                  name={enrolled ? "checkmark-circle" : "person-outline"}
                  size={20}
                  color={enrolled ? colors.green : colors.ink3}
                />
                <Text style={styles.statusText}>
                  {enrolled === null
                    ? "Checking…"
                    : enrolled
                      ? "Enrolled on this device"
                      : "Not enrolled yet"}
                </Text>
              </>
            )}
          </View>

          <View style={styles.actions}>
            {enrolled ? (
              <>
                <PrimaryButton
                  label="Re-enrol"
                  variant="ghost"
                  onPress={enrol}
                  disabled={busy}
                  style={styles.grow}
                />
                <PrimaryButton
                  label="Remove"
                  variant="danger"
                  onPress={remove}
                  disabled={busy}
                  style={styles.grow}
                />
              </>
            ) : (
              <PrimaryButton
                label={busy ? "Enrolling…" : "Enrol my voice"}
                onPress={enrol}
                disabled={busy || enrolled === null}
                icon={<Ionicons name="mic-outline" size={18} color={colors.white} />}
                style={styles.grow}
              />
            )}
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  body: { ...font.body, color: colors.ink2, marginTop: space.xs },
  privacyRow: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  privacyText: { ...font.bodySm, color: colors.greenInk, flex: 1, lineHeight: 19 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs },
  statusText: { ...font.body, color: colors.ink },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.lg },
  grow: { flex: 1 },
});

import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { OptionSheet, type SheetOption } from "@/components/consult/OptionSheet";
import { CardHeading } from "@/components/consult/SectionLabel";
import { SettingsRow } from "@/components/consult/SettingsRow";
import { TabScaffold } from "@/components/consult/TabScaffold";
import { initSpeakerModel, isDoctorEnrolled } from "@/lib/diarize";
import { NOTE_MODEL_NAME, sttModelName } from "@/lib/pipeline/model";
import {
  getSttAccuracy,
  getSttLanguage,
  getSttMode,
  setSttAccuracy,
  setSttLanguage,
  setSttMode,
  type SttAccuracy,
  type SttLanguage,
} from "@/lib/pipeline/sttMode";
import { prewarmStt } from "@/lib/pipeline/realStt";
import { haptic } from "@/lib/haptics";
import { colors, font, space } from "@/lib/theme";

const ACCURACY_OPTIONS: SheetOption<SttAccuracy>[] = [
  { key: "fast", name: "Fast", desc: "Whisper-base · 398MB · quick", icon: "flash-outline" },
  { key: "high", name: "High accuracy", desc: "Whisper-small · 1.1GB · best for Malay", icon: "speedometer-outline" },
];

const LANGUAGE_OPTIONS: SheetOption<SttLanguage>[] = [
  { key: "en", name: "English", desc: "Forced English decode", icon: "language-outline" },
  { key: "ms", name: "Bahasa Melayu", desc: "Forced Malay decode", icon: "language-outline" },
];

// Tab 4 — Settings, rebuilt in the green design system (replaces the deleted
// blue Better-T-Stack scaffold). On-device status, privacy posture, and about.
export default function SettingsScreen() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [diarModel, setDiarModel] = useState("Mock (band-energy)");
  const [demo, setDemo] = useState(getSttMode() === "demo");
  const [accuracy, setAccuracyState] = useState<SttAccuracy>(getSttAccuracy());
  const [language, setLanguageState] = useState<SttLanguage>(getSttLanguage());
  // Pre-download state for the selected tier's model, so High mode can pre-warm on wifi instead
  // of stalling silently mid-consult. Resets when the tier changes (a different model to fetch).
  const [prep, setPrep] = useState<{ status: "idle" | "downloading" | "ready" | "error"; pct: number }>({
    status: "idle",
    pct: 0,
  });

  const [accuracySheet, setAccuracySheet] = useState(false);
  const [languageSheet, setLanguageSheet] = useState(false);

  const selectAccuracy = (next: SttAccuracy) => {
    if (next === accuracy) return;
    haptic("select");
    setAccuracyState(next);
    setSttAccuracy(next);
    setPrep({ status: "idle", pct: 0 }); // different model → download state no longer applies
  };

  const downloadModel = async () => {
    if (prep.status === "downloading") return;
    haptic("tap");
    setPrep({ status: "downloading", pct: 0 });
    try {
      await prewarmStt((p) => setPrep({ status: "downloading", pct: p }));
      setPrep({ status: "ready", pct: 1 });
    } catch {
      setPrep({ status: "error", pct: 0 });
    }
  };
  const selectLanguage = (next: SttLanguage) => {
    if (next === language) return;
    haptic("select");
    setLanguageState(next);
    setSttLanguage(next);
  };
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
        <SettingsRow icon="mic-outline" label="Speech-to-text" value={`${sttModelName(accuracy)} (on-device)`} />
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
        <CardHeading>Transcription</CardHeading>
        <SettingsRow
          first
          icon="speedometer-outline"
          label="Accuracy"
          value={accuracy === "high" ? "High · Whisper-small (1.1GB)" : "Fast · Whisper-base (398MB)"}
          onPress={() => setAccuracySheet(true)}
        />
        <SettingsRow
          icon="language-outline"
          label="Language"
          value={language === "ms" ? "Bahasa Melayu" : "English"}
          onPress={() => setLanguageSheet(true)}
        />
        <Text style={styles.hint}>
          High accuracy transcribes Malay + code-switch far better, but downloads 1.1GB and runs
          slower. Language sets the forced decode — pick the consult&apos;s dominant one.
        </Text>

        <Pressable
          onPress={downloadModel}
          disabled={prep.status === "downloading" || prep.status === "ready"}
          style={[styles.prepareBtn, prep.status === "ready" && styles.prepareBtnReady]}
        >
          {prep.status === "downloading" ? (
            <>
              <View style={styles.prepareRow}>
                <ActivityIndicator size="small" color={colors.greenInk} />
                <Text style={styles.prepareText}>
                  {`Downloading ${sttModelName(accuracy)}… ${Math.round(prep.pct * 100)}%`}
                </Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.max(3, Math.round(prep.pct * 100))}%` }]} />
              </View>
            </>
          ) : prep.status === "ready" ? (
            <View style={styles.prepareRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.greenInk} />
              <Text style={[styles.prepareText, { color: colors.greenInk }]}>
                {`${sttModelName(accuracy)} ready on-device`}
              </Text>
            </View>
          ) : (
            <View style={styles.prepareRow}>
              <Ionicons
                name={prep.status === "error" ? "refresh-outline" : "cloud-download-outline"}
                size={18}
                color={colors.ink2}
              />
              <Text style={styles.prepareText}>
                {prep.status === "error"
                  ? "Download failed — tap to retry"
                  : `Download & prepare ${sttModelName(accuracy)} · ${accuracy === "high" ? "1.1GB" : "398MB"}`}
              </Text>
            </View>
          )}
        </Pressable>
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

      <OptionSheet
        visible={accuracySheet}
        onClose={() => setAccuracySheet(false)}
        title="Transcription accuracy"
        options={ACCURACY_OPTIONS}
        selectedKey={accuracy}
        onSelect={selectAccuracy}
      />
      <OptionSheet
        visible={languageSheet}
        onClose={() => setLanguageSheet(false)}
        title="Transcription language"
        options={LANGUAGE_OPTIONS}
        selectedKey={language}
        onSelect={selectLanguage}
      />
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
  hint: {
    ...font.bodySm,
    color: colors.ink3,
    marginTop: space.sm,
    paddingHorizontal: space.xs,
    lineHeight: 18,
  },
  prepareBtn: {
    marginTop: space.sm,
    padding: space.sm,
    borderRadius: 12,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    gap: space.sm,
  },
  prepareBtnReady: { borderColor: colors.green100, backgroundColor: colors.green50 },
  prepareRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  prepareText: { ...font.bodySm, color: colors.ink2, flexShrink: 1 },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.line,
    overflow: "hidden",
  },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.greenInk },
});

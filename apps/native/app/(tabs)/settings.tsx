import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { OptionSheet, type SheetOption } from "@/components/consult/OptionSheet";
import { CardHeading } from "@/components/consult/SectionLabel";
import { SettingsRow } from "@/components/consult/SettingsRow";
import { TabScaffold } from "@/components/consult/TabScaffold";
import { initSpeakerModel, isDoctorEnrolled } from "@/lib/diarize";
import { NOTE_MODEL_NAME } from "@/lib/pipeline/model";
import {
  getSttAccuracy,
  getSttLanguage,
  getSttMode,
  getSemanticSearch,
  setSttAccuracy,
  setSttLanguage,
  setSttMode,
  setSemanticSearch,
  type SttAccuracy,
  type SttLanguage,
} from "@/lib/pipeline/sttMode";
import {
  prewarmWhisper,
  whisperIsBundled,
  whisperIsReady,
  whisperModelFor,
  whisperModelInfo,
} from "@/lib/pipeline/whisperStt";
import { haptic } from "@/lib/haptics";
import { isDemoSeeded, resetDemoData, seedDemoData } from "@/lib/demo/seed";
import { useProfile, type ClinicianProfile } from "@/lib/profile";
import { colors, font, space } from "@/lib/theme";

const ACCURACY_OPTIONS: SheetOption<SttAccuracy>[] = [
  { key: "fast", name: "Offline", desc: "Malaysian Whisper-small · bundled, no download · quicker, less accurate", icon: "flash-outline" },
  { key: "high", name: "Best accuracy (recommended)", desc: "Whisper large-v3-turbo · Malay+English+中文 · 547MB one-time download", icon: "sparkles-outline" },
];

const LANGUAGE_OPTIONS: SheetOption<SttLanguage>[] = [
  { key: "auto", name: "Auto-detect", desc: "Best for Malaysian mixed speech (Malay+English+Chinese)", icon: "sparkles-outline" },
  { key: "en", name: "English", desc: "Force English decode", icon: "language-outline" },
  { key: "ms", name: "Bahasa Melayu", desc: "Force Malay decode", icon: "language-outline" },
];

const LANGUAGE_LABEL: Record<SttLanguage, string> = {
  auto: "Auto-detect",
  en: "English",
  ms: "Bahasa Melayu",
};

// Tab 4 — Settings, rebuilt in the green design system (replaces the deleted
// blue Better-T-Stack scaffold). On-device status, privacy posture, and about.
export default function SettingsScreen() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [diarModel, setDiarModel] = useState("Mock (band-energy)");
  const [demo, setDemo] = useState(getSttMode() === "demo");
  const [semantic, setSemantic] = useState(getSemanticSearch());
  const [accuracy, setAccuracyState] = useState<SttAccuracy>(getSttAccuracy());
  const [language, setLanguageState] = useState<SttLanguage>(getSttLanguage());
  // Pre-download state for the selected tier's model, so High mode can pre-warm on wifi instead
  // of stalling silently mid-consult. Initialized (and reset on tier change) from the REAL
  // on-disk state — an already-downloaded model must show ready, not a download button.
  const [prep, setPrep] = useState<{ status: "idle" | "downloading" | "ready" | "error"; pct: number }>(() => ({
    status: whisperIsReady(getSttAccuracy()) ? "ready" : "idle",
    pct: 0,
  }));

  const [accuracySheet, setAccuracySheet] = useState(false);
  const [languageSheet, setLanguageSheet] = useState(false);

  const selectAccuracy = (next: SttAccuracy) => {
    if (next === accuracy) return;
    haptic("select");
    setAccuracyState(next);
    setSttAccuracy(next);
    // Different model → reflect ITS on-disk state (ready if bundled/already downloaded).
    setPrep({ status: whisperIsReady(next) ? "ready" : "idle", pct: 0 });
  };

  const downloadModel = async () => {
    if (prep.status === "downloading") return;
    haptic("tap");
    setPrep({ status: "downloading", pct: 0 });
    try {
      await prewarmWhisper(whisperModelFor(accuracy), (p) => setPrep({ status: "downloading", pct: p }));
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

  const [profile, updateProfile] = useProfile();
  const [seeded, setSeeded] = useState<boolean | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void isDemoSeeded().then((s) => alive && setSeeded(s));
      return () => {
        alive = false;
      };
    }, []),
  );
  const seedDemo = () => {
    haptic("tap");
    void seedDemoData().then(() => {
      setSeeded(true);
      haptic("select");
      Alert.alert("Demo data seeded", "Consults and Smart Scan now show sample rows.");
    });
  };
  // Master demo switch: transcript + prefill ride on sttMode "demo"; lists get seeded
  // on first arm. Disarm returns to the real pipeline but keeps seeded rows (Reset
  // clears them) so takes can be re-shot without re-seeding.
  const demoMode = demo;
  const setDemoMode = async (v: boolean) => {
    haptic(v ? "select" : "tap");
    setDemo(v);
    setSttMode(v ? "demo" : "real");
    if (v && seeded === false) {
      await seedDemoData();
      setSeeded(true);
    }
  };
  const resetDemo = () => {
    haptic("tap");
    void resetDemoData().then(() => {
      setSeeded(false);
      Alert.alert("Demo data removed", "Only seeded rows were deleted.");
    });
  };
  // iOS Alert.prompt edit — same lightweight pattern as consult rename.
  const editProfileField = (field: keyof ClinicianProfile, label: string) => {
    if (process.env.EXPO_OS !== "ios") return;
    haptic("tap");
    Alert.prompt(label, "Shown on consult headers, signatures and exports.", (text) => {
      const t = text?.trim();
      if (t) updateProfile({ [field]: t });
    }, "plain-text", profile[field]);
  };

  return (
    <TabScaffold title="Settings">
      <Card>
        <CardHeading>Clinician</CardHeading>
        <SettingsRow
          first
          icon="person-circle-outline"
          label="Name"
          value={profile.clinicianName}
          onPress={() => editProfileField("clinicianName", "Clinician name")}
        />
        <SettingsRow
          icon="ribbon-outline"
          label="MMC no."
          value={profile.mmcNo}
          onPress={() => editProfileField("mmcNo", "MMC registration no.")}
        />
        <SettingsRow
          icon="business-outline"
          label="Clinic"
          value={profile.clinicName}
          onPress={() => editProfileField("clinicName", "Clinic name")}
        />
      </Card>

      <Card>
        <CardHeading>On-device AI</CardHeading>
        <SettingsRow first icon="hardware-chip-outline" label="Note model" value={NOTE_MODEL_NAME} />
        <SettingsRow icon="mic-outline" label="Speech-to-text" value={`${whisperModelInfo(accuracy).name}`} />
        <SettingsRow icon="shield-checkmark-outline" label="Redaction" value="On-device" />
        <SettingsRow icon="people-outline" label="Diarization" value={diarModel} />
        <SettingsRow
          icon="cloud-download-outline"
          label="AI models & downloads"
          onPress={() => router.push("/ai-models" as Href)}
        />
        {/* Knowledge search moved here when Smart Scan took its tab slot. */}
        <SettingsRow
          icon="sparkles"
          label="Knowledge search"
          value="On-device reference"
          onPress={() => router.push("/knowledge" as Href)}
        />
        <SettingsRow
          icon="search-outline"
          label="Semantic search"
          value={semantic ? undefined : "Off · lexical"}
          right={
            <Switch
              value={semantic}
              onValueChange={(v) => {
                setSemantic(v);
                setSemanticSearch(v);
              }}
            />
          }
        />
      </Card>

      <Card>
        <CardHeading>Demo</CardHeading>
        {/* Master switch — arms every filming aid in one tap: scripted transcript
            (drives the redaction sweep + note-gen with identical input each take),
            demo patient prefill on consent, and seeded list data. OFF returns to the
            real pipeline; seeded rows stay until Reset so retakes are cheap. */}
        <SettingsRow
          first
          icon="videocam-outline"
          label="Demo mode"
          value={demoMode ? "Filming aids armed" : undefined}
          right={<Switch value={demoMode} onValueChange={(v) => void setDemoMode(v)} />}
        />
        <SettingsRow
          icon="sparkles-outline"
          label="Seed demo data"
          value={seeded === null ? "…" : seeded ? "Seeded" : undefined}
          onPress={seedDemo}
        />
        <SettingsRow icon="trash-outline" label="Reset demo data" onPress={resetDemo} />
        <Text style={styles.hint}>
          Demo mode arms everything for filming: scripted consult transcript, prefilled
          demo patient, seeded lists, sample scan. Real consults are never touched;
          Reset removes exactly what was seeded.
        </Text>
      </Card>

      <Card>
        <CardHeading>Transcription</CardHeading>
        <SettingsRow
          first
          icon="speedometer-outline"
          label="Accuracy"
          value={`${accuracy === "high" ? "High" : "Fast"} · ${whisperModelInfo(accuracy).size}`}
          onPress={() => setAccuracySheet(true)}
        />
        <SettingsRow
          icon="language-outline"
          label="Language"
          value={LANGUAGE_LABEL[language]}
          onPress={() => setLanguageSheet(true)}
        />
        <Text style={styles.hint}>
          On-device whisper.cpp with language auto-detect — handles Malaysian mixed speech
          (Malay + English + Chinese) and won&apos;t hallucinate. High accuracy is a bigger,
          slower model. Force a language only if a consult is strongly one language.
        </Text>

        {whisperIsBundled(accuracy) ? (
          <View style={[styles.prepareBtn, styles.prepareBtnReady]}>
            <View style={styles.prepareRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.greenInk} />
              <Text style={[styles.prepareText, { color: colors.greenInk }]}>
                {`${whisperModelInfo(accuracy).name} — bundled in app, ready offline`}
              </Text>
            </View>
          </View>
        ) : (
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
                  {`Downloading ${whisperModelInfo(accuracy).name}… ${Math.round(prep.pct * 100)}%`}
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
                {`${whisperModelInfo(accuracy).name} ready on-device`}
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
                  : `Download & prepare ${whisperModelInfo(accuracy).name} · ${whisperModelInfo(accuracy).size}`}
              </Text>
            </View>
          )}
        </Pressable>
        )}
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
          icon="mic-outline"
          label="STT test (Malaysian Whisper)"
          onPress={() => router.push("/stt-lab" as Href)}
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

import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { CardHeading } from "@/components/consult/SectionLabel";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { extractAndRedact } from "@/lib/vision/ocr";
import { captureFromCamera, pickFromLibrary } from "@/lib/vision/pickImage";
import { haptic } from "@/lib/haptics";
import { colors, font, space } from "@/lib/theme";

type Phase = "idle" | "reading" | "done" | "error";

// Dev screen: on-device document OCR. Snap or pick a photo of a lab result / referral /
// medication label → ML Kit reads the text locally (no download) → it's de-identified with
// the same redactor as the consult transcript. The image and raw text never leave the phone;
// only the de-identified form may ever cross the boundary (the moat). The PRODUCTION flow is
// the Smart Scan tab; this lab stays for quick engine checks. Reached from Settings → About.
export default function OcrLab() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [raw, setRaw] = useState("");
  const [redacted, setRedacted] = useState("");
  const [identifiers, setIdentifiers] = useState(0);
  const [err, setErr] = useState("");
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  const scan = async (source: "camera" | "library") => {
    setErr("");
    const uri = source === "camera" ? await captureFromCamera() : await pickFromLibrary();
    if (!uri) {
      if (mounted.current) setErr("No image selected (or permission denied).");
      return;
    }
    haptic("tap");
    setPhase("reading");
    setRaw("");
    setRedacted("");
    try {
      const r = await extractAndRedact(uri);
      if (!mounted.current) return;
      setRaw(r.raw);
      setRedacted(r.redacted);
      setIdentifiers(r.identifiers);
      setPhase(r.raw ? "done" : "error");
      if (!r.raw) setErr("No text detected in the image.");
    } catch {
      if (mounted.current) {
        setErr("OCR unavailable on this build (rebuild to link ML Kit).");
        setPhase("error");
      }
    }
  };

  const busy = phase === "reading";

  return (
    <View style={styles.screen}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <Card>
          <CardHeading>What this does</CardHeading>
          <Text style={styles.body}>
            Reads text from a photo of a document — lab result, referral, medication label —
            fully on-device, then de-identifies it with the same redactor as the consult. The
            image and raw text never leave the phone.
          </Text>
        </Card>

        <Card>
          <CardHeading>Scan a document</CardHeading>
          {busy ? (
            <View style={styles.row}>
              <ActivityIndicator color={colors.green} />
              <Text style={styles.recText}>Reading on-device…</Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            <PrimaryButton
              label="Camera"
              onPress={() => scan("camera")}
              disabled={busy}
              icon={<Ionicons name="camera-outline" size={18} color={colors.white} />}
              style={styles.grow}
            />
            <PrimaryButton
              label="Pick image"
              variant="ghost"
              onPress={() => scan("library")}
              disabled={busy}
              icon={<Ionicons name="image-outline" size={18} color={colors.ink} />}
              style={styles.grow}
            />
          </View>
          {err ? (
            <Text style={styles.err} selectable>
              {err}
            </Text>
          ) : null}
        </Card>

        {phase === "done" ? (
          <>
            <Card>
              <CardHeading>Recognized text · on-device</CardHeading>
              <Text style={styles.txt} selectable>
                {raw}
              </Text>
            </Card>
            <Card variant="green">
              <CardHeading>{`De-identified (${identifiers} redacted)`}</CardHeading>
              <Text style={styles.txt} selectable>
                {redacted}
              </Text>
              <Text style={styles.note}>
                Only this de-identified form may ever cross the boundary. Raw text stays on-device.
              </Text>
            </Card>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  body: { ...font.body, color: colors.ink2, marginTop: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.sm },
  recText: { ...font.body, color: colors.ink },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  grow: { flex: 1 },
  err: { ...font.bodySm, color: colors.red, marginTop: space.sm },
  txt: { ...font.body, color: colors.ink, marginTop: space.xs, lineHeight: 21 },
  note: { ...font.bodySm, color: colors.greenInk, marginTop: space.sm },
});

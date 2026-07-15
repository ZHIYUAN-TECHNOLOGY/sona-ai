import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, useReducedMotion } from "react-native-reanimated";

import { Card } from "@/components/consult/Card";
import { ConsultScreen } from "@/components/consult/ConsultScreen";
import type { SpeakerKey } from "@/components/consult/mockData";
import { uncertainRedaction } from "@/components/consult/mockData";
import { Pill } from "@/components/consult/Pill";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { RedactChip } from "@/components/consult/RedactChip";
import { RedactSweepChip } from "@/components/consult/RedactSweepChip";
import { CardHeading } from "@/components/consult/SectionLabel";
import { useConsultPipeline } from "@/lib/pipeline/PipelineProvider";
import { colors } from "@/lib/theme";

// A parsed transcript fragment: either plain text, or a redacted token that
// carries its real value (from the on-device reidMap) + a global sweep index
// so the reveal-then-redact animation staggers top-to-bottom across the card.
type Frag =
  | { type: "text"; text: string }
  | { type: "token"; token: string; real: string; idx: number };

// Tokens the redactor emits inline in the de-identified text. Split-with-capture
// keeps the tokens as their own fragments so we can render them as RedactChips.
const TOKEN_RE = /(NAME_UNCERTAIN_\d+|NAME_\d+|IC_\d+|PHONE_\d+|ADDR_\d+|EMAIL_\d+)/;

function isToken(part: string): boolean {
  return /^(?:NAME_UNCERTAIN_\d+|NAME_\d+|IC_\d+|PHONE_\d+|ADDR_\d+|EMAIL_\d+)$/.test(part);
}

// Screen 3 of 6 — Privacy gate: the exact de-identified text the model will see,
// the low-confidence "tap to confirm" name, and the device-only re-ID map.
export default function PrivacyScreen() {
  const [confirmed, setConfirmed] = useState(false);
  const { redaction, redact } = useConsultPipeline();
  const started = useRef(false);
  const reduce = useReducedMotion();

  // Parse each de-identified line into fragments, assigning every token a global
  // sweep index (top-to-bottom) and its reidMap real value for the reveal.
  const rows = useMemo(() => {
    if (!redaction) return [];
    let n = 0;
    return redaction.segments.map((seg) => ({
      speaker: (seg.speaker === "doctor" ? "dr" : "pt") as SpeakerKey,
      faint: seg.speaker === "doctor",
      frags: seg.text
        .split(TOKEN_RE)
        .filter((p) => p.length > 0)
        .map<Frag>((part) =>
          isToken(part)
            ? { type: "token", token: part, real: redaction.reidMap[part] ?? part, idx: n++ }
            : { type: "text", text: part },
        ),
    }));
  }, [redaction]);

  // De-identify the stored transcript on-device once, when the gate first focuses.
  useFocusEffect(
    useCallback(() => {
      if (started.current) return;
      started.current = true;
      void redact();
    }, [redact]),
  );

  const uncertain = redaction?.uncertain[0];

  // The redaction reveal is a hero moment: cards settle in sequence on the same
  // ease-out curve as the note reveal (note.tsx). Reduced motion → plain fades.
  const reveal = (delay: number) =>
    reduce
      ? FadeIn.delay(delay).duration(220)
      : FadeInDown.delay(delay)
          .duration(460)
          .easing(Easing.bezier(0.23, 1, 0.32, 1))
          .withInitialValues({ transform: [{ translateY: 14 }] });

  return (
    <ConsultScreen
      time="9:43"
      title="Privacy gate"
      sub="Before any model reads text"
      onBack={() => router.back()}
      right={
        redaction ? (
          // Confirming the uncertain token(s) adds them to the headline count live —
          // the pill always equals the number of identifiers locked away from the model.
          <Pill
            label={`${redaction.highConfidenceCount + (confirmed ? redaction.uncertain.length : 0)} removed`}
            variant="red"
            dot
          />
        ) : (
          <Pill label="Redacting…" variant="line" />
        )
      }
      footer={
        <PrimaryButton label="Continue to note" onPress={() => router.push("/note")} />
      }
    >
      {!redaction ? (
        <Card>
          <CardHeading>Redacting on-device…</CardHeading>
          <Text style={styles.body}>
            De-identifying the transcript before any model reads a single word.
          </Text>
        </Card>
      ) : (
        <>
          <Animated.View entering={reveal(0)}>
            <Card>
              <CardHeading>What the model will see</CardHeading>
              {rows.map((row, i) => (
                <RedactedRow key={i} speaker={row.speaker} frags={row.frags} faint={row.faint} reduce={reduce} />
              ))}
            </Card>
          </Animated.View>

          {uncertain && (
            <Animated.View entering={reveal(120)}>
            <Card variant="amber">
              <CardHeading color={colors.amber}>
                {`${redaction.uncertain.length} uncertain, tap to confirm`}
              </CardHeading>
              <View style={styles.uncertainRow}>
                <WhoTag speaker="pt" />
                <Text style={styles.uncertainText}>
                  {uncertainRedaction.before}
                  <Text> </Text>
                </Text>
                {confirmed ? (
                  <RedactChip token={uncertain.token} />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Confirm ${uncertain.original} is an identifier`}
                    onPress={() => setConfirmed(true)}
                    style={({ pressed }) => [styles.dashed, pressed && styles.dashedPressed]}
                  >
                    <Text style={styles.dashedText}>{uncertain.original}</Text>
                  </Pressable>
                )}
                <Text style={styles.uncertainText}>{uncertainRedaction.after}</Text>
              </View>
              <Text style={styles.amberNote}>
                {confirmed
                  ? `Confirmed. Redacted locally as ${uncertain.token}. Still 0 bytes sent.`
                  : uncertainRedaction.note}
              </Text>
            </Card>
            </Animated.View>
          )}

          <Animated.View entering={reveal(200)}>
          <Card variant="green">
            <CardHeading>Re-identify map</CardHeading>
            <Text style={styles.body}>
              Tokens map back to the real details only on this device, at render time.
            </Text>
            <View style={styles.mapList}>
              {Object.entries(redaction.reidMap).map(([token, real]) => (
                <View key={token} style={styles.mapRow}>
                  <RedactChip token={token} />
                  <Text style={styles.mapArrow}>→</Text>
                  <Text style={styles.mapReal} numberOfLines={1}>
                    {real}
                  </Text>
                </View>
              ))}
            </View>
            <View style={styles.chiprow}>
              <Pill label="Sealed in Secure Enclave" variant="green" />
            </View>
          </Card>
          </Animated.View>

          <Animated.View entering={reveal(280)}>
          <Card variant="tint">
            <View style={styles.row}>
              <CardHeading>Leaving this phone</CardHeading>
              <Pill label="0 bytes" variant="green" />
            </View>
          </Card>
          </Animated.View>
        </>
      )}
    </ConsultScreen>
  );
}

// A redacted transcript line: speaker tag + wrapping run of text + token chips.
// Token fragments animate the reveal-then-redact sweep (RedactSweepChip); plain
// text renders as-is. Fragments are precomputed upstream so sweep indices are global.
function RedactedRow({
  speaker,
  frags,
  faint,
  reduce,
}: {
  speaker: SpeakerKey;
  frags: Frag[];
  faint?: boolean;
  reduce?: boolean;
}) {
  return (
    <View style={styles.redactRow}>
      <WhoTag speaker={speaker} />
      <View style={styles.redactBody}>
        {frags.map((f, i) =>
          f.type === "token" ? (
            <RedactSweepChip key={i} token={f.token} real={f.real} index={f.idx} reduce={reduce} />
          ) : (
            <Text key={i} style={[styles.redactText, faint && styles.faint]}>
              {f.text}
            </Text>
          )
        )}
      </View>
    </View>
  );
}

function WhoTag({ speaker }: { speaker: SpeakerKey }) {
  const map = {
    dr: { label: "DR", color: colors.greenInk, bg: colors.green50, border: colors.green100 },
    pt: { label: "PT", color: colors.blue, bg: colors.blue50, border: colors.blueLine },
    other: { label: "OTHER", color: colors.amber, bg: colors.amber50, border: colors.amberLine },
    you: { label: "YOU", color: colors.ink3, bg: colors.surface, border: colors.line },
  }[speaker];
  return (
    <View style={[styles.who, { backgroundColor: map.bg, borderColor: map.border }]}>
      <Text style={[styles.whoText, { color: map.color }]}>{map.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  redactRow: { flexDirection: "row", gap: 9, marginTop: 10, alignItems: "flex-start" },
  redactBody: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    rowGap: 3,
  },
  redactText: { fontSize: 12, lineHeight: 18, color: colors.ink },
  faint: { color: colors.ink2 },
  who: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 1,
  },
  whoText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },

  uncertainRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
    rowGap: 4,
  },
  uncertainText: { fontSize: 12, lineHeight: 18, color: colors.ink2 },
  dashed: {
    borderBottomWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.amber,
  },
  dashedPressed: { opacity: 0.6 },
  dashedText: { fontSize: 12, fontWeight: "600", color: colors.amber },
  amberNote: { marginTop: 8, fontSize: 10.5, color: colors.amber, lineHeight: 15 },

  body: { marginTop: 5, fontSize: 11.5, color: colors.ink2, lineHeight: 17 },
  mapList: { marginTop: 9, gap: 6 },
  mapRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  mapArrow: { fontSize: 12, color: colors.ink3 },
  mapReal: { flex: 1, fontSize: 11.5, color: colors.ink, fontWeight: "500" },
  chiprow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
});

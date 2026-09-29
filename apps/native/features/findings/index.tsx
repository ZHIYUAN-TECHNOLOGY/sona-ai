import { router } from "expo-router";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { MarkedText } from "@/components/sona/marked-text";
import { SampleLabel } from "@/components/sona/model-answer";
import { LAYOUT } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Expand, Icon, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { haptic } from "@/features/clinical/medication-parts";
import { useEncounter } from "@/features/encounter/store";
import { followUpLine, isOverdue, shortDate, toFollowUp, type Finding, type RiskBand } from "./model";

/*
 * Demo flow 6 on screen: a card of incidental findings under the X-ray (numbered to match the
 * markers on the image), and the ward's "Findings to follow up" list. Every finding is labelled
 * unvalidated; the follow-up comes from the rules table, and one tap tracks it.
 */
const TEAL = palette.green;
const BAND: Record<RiskBand, { label: string; ink: string; fill: string }> = {
  high: { label: "High risk", ink: palette.amber, fill: "rgba(196,120,20,0.13)" },
  intermediate: { label: "Intermediate", ink: palette.blue, fill: "rgba(36,91,204,0.08)" },
  low: { label: "Low risk", ink: palette.muted, fill: "rgba(20,28,40,0.06)" },
};

/** Where the findings came from, honestly: authored fixtures are never presented as a reading. */
const provenance = (f: Finding) => f.source === "fixture" ? "Unvalidated · not read from this image" : `Unvalidated · from ${f.source}`;

export function FindingsCard({ findings, error, focus, onFocus, onTrack, onDismiss }: { findings: Finding[]; error?: string; focus?: string; onFocus?: (id: string) => void; onTrack?: (f: Finding) => void; onDismiss?: (f: Finding, reason: string) => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const shown = findings.filter(f => f.status !== "dismissed");
  if (!shown.length) return null;
  return <Surface layout={reducedMotion ? undefined : LAYOUT} style={{ padding: 18, gap: 4 }}>
    <View style={{ gap: 2, paddingBottom: 6 }}>
      <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>Incidental findings</Text>
      <SampleLabel source={shown[0]!.source} what="findings" />
      <Text selectable style={{ ...type.caption, color: palette.muted }}>{provenance(shown[0]!)}</Text>
    </View>
    {shown.map(f => <FindingRow key={f.id} n={findings.indexOf(f) + 1} finding={f} focused={focus === f.id} onFocus={onFocus && (() => onFocus(f.id))} onTrack={onTrack && (() => onTrack(f))} onDismiss={onDismiss && (reason => onDismiss(f, reason))} />)}
    {error && <Text selectable style={{ ...type.footnote, color: palette.red, paddingTop: 6 }}>{error}</Text>}
  </Surface>;
}

function FindingRow({ n, finding: f, focused, onFocus, onTrack, onDismiss }: { n: number; finding: Finding; focused: boolean; onFocus?: () => void; onTrack?: () => void; onDismiss?: (reason: string) => void }) {
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const band = BAND[f.riskBand];
  return <Animated.View layout={LAYOUT} style={{ gap: 10, paddingVertical: 12, borderTopWidth: 1, borderColor: "rgba(20,28,40,0.06)" }}>
    {/* The row's head points at its marker: tapping it puts this finding under the torch on the image. */}
    <Pressable accessibilityRole="button" accessibilityState={{ selected: focused }} accessibilityLabel={`Finding ${n}: ${f.label}`} accessibilityHint={focused ? "Shows the whole film" : "Highlights it on the image"} disabled={!onFocus} onPress={onFocus}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "flex-start", gap: 10, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 22, height: 22, borderRadius: 11, marginTop: 1, borderWidth: 1.5, borderColor: palette.blue, alignItems: "center", justifyContent: "center", backgroundColor: focused ? palette.blue : "transparent", transitionProperty: "backgroundColor", transitionDuration: 200 } as never}>
        <Text style={{ fontSize: 11, fontWeight: "700", color: focused ? palette.white : palette.blue, fontVariant: ["tabular-nums"] }}>{n}</Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <MarkedText text={f.label} style={{ ...type.subhead, fontWeight: "600", color: palette.ink }} />
        <Text selectable style={{ ...type.footnote, color: palette.muted }}>{f.intervalDays ? followUpLine(f) : "No routine follow-up needed"}</Text>
      </View>
      <View style={{ height: 22, paddingHorizontal: 8, borderRadius: 11, justifyContent: "center", backgroundColor: band.fill }}>
        <Text style={{ fontSize: 11, fontWeight: "700", color: band.ink }}>{band.label}</Text>
      </View>
    </Pressable>
    {f.status === "tracked"
      ? <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 32 }}>
        <Icon name="checkmark.circle.fill" size={13} color={TEAL} />
        <Text selectable style={{ ...type.footnote, fontWeight: "600", color: TEAL }}>Tracked · {f.owner ?? "Attending doctor"}{f.dueAt ? ` · due ${shortDate(f.dueAt)}` : ""}</Text>
      </View>
      // Without the callbacks (a role the server would refuse) the row reads only.
      : onTrack && onDismiss && <View style={{ gap: 10, paddingLeft: 32 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          {f.intervalDays ? <Action label="Track follow-up" icon="calendar.badge.plus" secondary onPress={() => { haptic("select"); onTrack(); }} /> : null}
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: dismissing }} accessibilityLabel={`Dismiss ${f.label}`} hitSlop={8} onPress={() => setDismissing(v => !v)} style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>{dismissing ? "Keep" : "Dismiss…"}</Text>
          </Pressable>
        </View>
        {dismissing && <Expand style={{ gap: 8 }}>
          <TextInput value={reason} onChangeText={setReason} placeholder="Why, e.g. known and already followed up" placeholderTextColor={palette.placeholder} accessibilityLabel="Reason for dismissing"
            style={{ minHeight: 44, borderRadius: 14, paddingHorizontal: 14, fontSize: 15, color: palette.ink, backgroundColor: "rgba(20,28,40,0.05)" }} />
          <View style={{ alignSelf: "flex-start" }}><Action label="Dismiss finding" secondary disabled={!reason.trim()} onPress={() => onDismiss(reason.trim())} /></View>
        </Expand>}
      </View>}
  </Animated.View>;
}

/** The ward's list: one compact row per open or tracked finding, overdue ones first and in red. */
export function FollowUpList({ findings }: { findings: Finding[] }) {
  const { selectPatient } = useEncounter();
  const rows = toFollowUp(findings);
  if (!rows.length) return null;
  const now = new Date();
  return <Surface style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}>
    <Text accessibilityRole="header" style={{ ...type.overline, color: palette.blue, paddingBottom: 4 }}>Findings to follow up</Text>
    {rows.map((f, i) => {
      const overdue = isOverdue(f, now);
      const status = f.status === "open" ? "Not tracked · unvalidated" : `${f.owner ?? "Attending doctor"}${f.dueAt ? ` · ${overdue ? "overdue since" : "due"} ${shortDate(f.dueAt)}` : ""}`;
      return <Pressable key={f.id} accessibilityRole="button" accessibilityLabel={`${f.patientName}, ${f.label}, ${status}`} accessibilityHint="Opens the X-ray"
        onPress={() => { haptic("select"); selectPatient(f.patientId); router.push("/xray"); }}
        style={({ pressed }) => ({ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: i ? 1 : 0, borderColor: "rgba(20,28,40,0.06)", opacity: pressed ? 0.6 : 1 })}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: overdue ? palette.red : f.status === "open" ? "#C47814" : "rgba(36,91,204,0.5)" }} />
        <View style={{ flex: 1, paddingVertical: 8 }}>
          <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{f.patientName} · {f.label.split(",")[0]}</Text>
          <Text numberOfLines={1} style={{ ...type.caption, fontWeight: overdue ? "700" : "400", color: overdue ? palette.red : palette.muted }}>{status}</Text>
        </View>
        <Icon name="chevron.right" size={12} color={palette.muted} />
      </Pressable>;
    })}
  </Surface>;
}

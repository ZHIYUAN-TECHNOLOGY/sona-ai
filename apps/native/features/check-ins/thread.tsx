import { useState } from "react";
import { AccessibilityInfo, Pressable, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { MarkedText } from "@/components/sona/marked-text";
import { LAYOUT, type riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Chip, Icon, useAccessibleEffects } from "@/components/sona/ui";
import { haptic } from "@/features/clinical/medication-parts";
import type { DayItem } from "@/features/day/model";
import { useEncounter } from "@/features/encounter/store";
import type { Patient } from "@/features/encounter/types";
import { errorText, useLive } from "@/features/live";
import { shortDate, type ReplyLabel } from "./model";
import { bookIn, resolveFlag, simulateReply, useCheckIns } from "./state";

/*
 * Check-ins on the patient sheet: each sent message and the patient's reply as a short thread.
 * A fine reply sits quietly; worse is amber and urgent red, each saying it went to the doctor.
 */
const LABEL: Record<ReplyLabel, { text: string; ink: string; wash: string }> = {
  fine: { text: "Fine · logged", ink: palette.muted, wash: "rgba(20,28,40,0.05)" },
  worse: { text: "Worse · flagged to the doctor", ink: palette.amber, wash: "rgba(196,120,20,0.13)" },
  urgent: { text: "Urgent · flagged to the doctor", ink: palette.red, wash: "rgba(162,62,62,0.10)" },
};
// The demo's reply: Amelia's fever is back.
const DEMO_REPLY = "demam balik";

export function CheckInThread({ patient, entering }: { patient: Patient; entering?: ReturnType<typeof riseIn> }) {
  const mine = useCheckIns().filter(c => c.patientId === patient.id);
  const { on: live } = useLive();
  const { showDemoControls } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!mine.length) return null;
  const next = mine.find(c => !c.replies.length);
  const reply = () => {
    if (!next) return;
    haptic("select"); setBusy(true); setError(undefined);
    simulateReply(next, patient.name, DEMO_REPLY, live).catch(e => setError(errorText(e))).finally(() => setBusy(false));
  };

  return <Animated.View entering={entering} layout={reducedMotion ? undefined : LAYOUT} style={{ gap: 8 }}>
    <Text style={{ ...type.overline, color: palette.muted }}>Check-ins</Text>
    <View style={{ borderRadius: 22, borderCurve: "continuous", backgroundColor: palette.white, padding: 14, gap: 12 }}>
      {mine.map(c => <View key={c.id} style={{ gap: 6 }}>
        <Text style={{ ...type.caption, fontWeight: "600", color: palette.muted }}>Day {c.day} · {shortDate(new Date(c.dueAt))}{c.sentAt ? "" : " · scheduled"}</Text>
        {c.sentAt && <Text numberOfLines={2} selectable style={{ ...type.footnote, color: palette.ink, padding: 10, borderRadius: 14, borderCurve: "continuous", backgroundColor: "rgba(36,91,204,0.07)", overflow: "hidden" }}>{c.message}</Text>}
        {c.replies.map(r => <Animated.View key={r.id} entering={reducedMotion ? undefined : FadeIn.duration(220)} style={{ alignSelf: "flex-end", maxWidth: "85%", gap: 4, alignItems: "flex-end" }}>
          <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, borderCurve: "continuous", backgroundColor: LABEL[r.label].wash }}>
            <MarkedText text={r.text} style={{ ...type.subhead, color: palette.ink }} />
          </View>
          <Text style={{ ...type.caption, fontWeight: "600", color: LABEL[r.label].ink }}>{r.task?.completed ? "Handled" : LABEL[r.label].text}</Text>
        </Animated.View>)}
      </View>)}
      <Text style={{ ...type.caption, color: palette.muted }}>Simulated inbox · no real patient is contacted</Text>
    </View>
    {showDemoControls && next && <Chip label={busy ? "Replying…" : `Simulate reply “${DEMO_REPLY}”`} icon={<Icon name="bubble.left" size={13} color={palette.ink} />} onPress={busy ? () => {} : reply} />}
    {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
  </Animated.View>;
}

/**
 * My Day's one tap on a flagged reply: call back (simulated) or book in. In live mode Book in is real:
 * the server books tomorrow 09:00, closes the flag and the patient's Sona Care shows the visit at once.
 */
export function FlagActions({ item }: { item: DayItem }) {
  const { on: live } = useLive();
  const { reducedMotion } = useAccessibleEffects();
  const [doing, setDoing] = useState<string>();
  const [error, setError] = useState<string>();
  const taskId = item.id.replace(/^check-in-/, "");
  const first = item.title.split(":")[0];
  const act = (label: string) => {
    haptic("select"); setError(undefined);
    if (label === "Booked in" && live) {
      setDoing("Booking…");
      bookIn(taskId, true).then(at => {
        const when = at ? at.toLocaleString("en-GB", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }) : "tomorrow";
        setDoing(`Booked in ${when} · ${first}'s app updated`);
        AccessibilityInfo.announceForAccessibility(`Booked in ${when}. ${first}'s Sona Care shows it now.`);
      }, e => { setError(errorText(e)); setDoing(undefined); });
      return;
    }
    setDoing(label);
    AccessibilityInfo.announceForAccessibility(`${label}, simulated`);
    // A beat to read the confirmation before the row leaves.
    setTimeout(() => { resolveFlag(taskId, live).catch(e => { setError(errorText(e)); setDoing(undefined); }); }, reducedMotion ? 0 : 1200);
  };
  if (doing) return <Animated.View entering={FadeIn.duration(180)} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 34 }}>
    <Icon name="checkmark.circle.fill" size={13} color={palette.green} />
    <Text style={{ ...type.footnote, fontWeight: "600", color: palette.green }}>{doing}{doing.startsWith("Booked in ") || doing === "Booking…" ? "" : " · simulated"}</Text>
  </Animated.View>;
  return <View style={{ gap: 6 }}>
    <View style={{ flexDirection: "row", gap: 8 }}>
      {([["Call back", "phone.fill"], [live ? "Book in tomorrow 9:00" : "Book in", "calendar.badge.plus"]] as const).map(([label, icon], i) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={`${label} ${first}`} onPress={() => act(i ? "Booked in" : "Called back")}
        style={({ pressed }) => ({ minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 17, backgroundColor: i ? "rgba(20,28,40,0.06)" : palette.ink, opacity: pressed ? 0.8 : 1 })}>
        <Icon name={icon} size={12} color={i ? palette.ink : palette.white} />
        <Text style={{ fontSize: 14, fontWeight: "600", color: i ? palette.ink : palette.white }}>{label}</Text>
      </Pressable>)}
    </View>
    {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
  </View>;
}

import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { MarkedText } from "@/components/sona/marked-text";
import { LAYOUT, type riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Chip, Icon, useAccessibleEffects } from "@/components/sona/ui";
import { DoneLine, slotLine, SlotPicker, type PickedSlot } from "@/features/bookings/parts";
import { haptic } from "@/features/clinical/medication-parts";
import type { DayItem } from "@/features/day/model";
import { useEncounter } from "@/features/encounter/store";
import type { Patient } from "@/features/encounter/types";
import { api, errorText, useLive } from "@/features/live";
import { useLiveChanges } from "@/features/live/channel";
import { shortDate, type ReplyLabel } from "./model";
import { addToVisit, bookIn, releaseFlag, resolveFlag, simulateReply, useCheckIns } from "./state";

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
 * My Day's one tap on a flagged reply: call back (simulated) or book in. Book in opens the slot picker
 * in place (the care-team doctor preselected); in live mode the booking is real: the server books the
 * slot, closes the flag and the patient's Sona Care shows the visit at once.
 */
export function FlagActions({ item }: { item: DayItem }) {
  const { on: live } = useLive();
  const { reducedMotion } = useAccessibleEffects();
  const [doing, setDoing] = useState<string>();
  // After a live Book in: the visit, and her X-ray findings that could ride on it.
  const [visit, setVisit] = useState<{ id: string; toAdd: { id: string; label: string; test: string; tracked: boolean; dueAt: Date | string }[] }>();
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [picking, setPicking] = useState(false);
  const taskId = item.id.replace(/^check-in-/, "");
  const first = item.title.split(":")[0];
  // Book in at the slot picked in place: live, the server books it and her Sona Care shows it at once.
  const book = (slot: PickedSlot) => {
    haptic("select"); setError(undefined); setPicking(false);
    if (!live) { act(`Booked in ${slotLine(slot.startsAt)}`); return; }
    setDoing("Booking…");
    bookIn(taskId, true, slot).then(booked => {
      if (booked) setVisit({ id: booked.appointmentId, toAdd: booked.toAdd });
      const when = slotLine(booked?.startsAt ?? slot.startsAt);
      setDoing(`Booked in ${when} · ${first}'s app updated`);
      AccessibilityInfo.announceForAccessibility(`Booked in ${when}. ${first}'s Sona Care shows it now.`);
    }, e => { setError(errorText(e)); setDoing(undefined); });
  };
  const act = (label: string) => {
    haptic("select"); setError(undefined);
    setDoing(label);
    AccessibilityInfo.announceForAccessibility(`${label}, simulated`);
    // A beat to read the confirmation before the row leaves.
    setTimeout(() => { resolveFlag(taskId, live).catch(e => { setError(errorText(e)); setDoing(undefined); }); }, reducedMotion ? 0 : 1200);
  };
  const add = (f: { id: string; test: string }) => {
    if (!visit) return;
    haptic("select");
    addToVisit(f.id, visit.id).then(() => {
      setAdded(a => [...a, f.id]);
      AccessibilityInfo.announceForAccessibility(`${f.test} added to the same visit. ${first}'s Sona Care shows it now.`);
    }, e => setError(errorText(e)));
  };
  if (doing) return <Animated.View entering={FadeIn.duration(180)} style={{ gap: 8 }}>
    {doing === "Booking…" ? <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 34 }}>
      <ActivityIndicator size="small" color={palette.muted} />
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>Booking…</Text>
    </View> : <DoneLine text={`${doing}${live && doing.startsWith("Booked in ") ? "" : " · simulated"}`} />}
    {visit?.toAdd.map(f => added.includes(f.id)
      ? <View key={f.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="checkmark.circle.fill" size={13} color={palette.green} />
        <Text style={{ ...type.footnote, fontWeight: "600", color: palette.green }}>{f.test} added to the same visit</Text>
      </View>
      : <View key={f.id} style={{ gap: 6 }}>
        <Text style={{ ...type.footnote, color: palette.ink }}>{f.tracked
          ? `Her ${f.test} (${f.label.toLowerCase()}) is due ${new Date(f.dueAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" })}. Same trip?`
          : `Her ${f.label.toLowerCase()} has no follow-up yet.`}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Add ${f.test} to the same visit`} onPress={() => add(f)}
          style={({ pressed }) => ({ alignSelf: "flex-start", minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 17, backgroundColor: palette.ink, opacity: pressed ? 0.8 : 1 })}>
          <Icon name="plus" size={12} color={palette.white} />
          <Text style={{ fontSize: 14, fontWeight: "600", color: palette.white }}>Add {f.test} to this visit</Text>
        </Pressable>
      </View>)}
    {visit && visit.toAdd.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Done with this flag" onPress={() => releaseFlag(taskId)}
      style={({ pressed }) => ({ alignSelf: "flex-start", minHeight: 34, justifyContent: "center", paddingHorizontal: 12, borderRadius: 17, backgroundColor: "rgba(20,28,40,0.06)", opacity: pressed ? 0.7 : 1 })}>
      <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink }}>Done</Text>
    </Pressable>}
    {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
  </Animated.View>;
  return <View style={{ gap: 6 }}>
    {live && item.patientId && <DoseLine patientId={item.patientId} />}
    <View style={{ flexDirection: "row", gap: 8 }}>
      {([["Call back", "phone.fill"], ["Book in", "calendar.badge.plus"]] as const).map(([label, icon], i) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={`${label} ${first}`}
        accessibilityState={i ? { expanded: picking } : undefined} onPress={() => { if (!i) act("Called back"); else { haptic("select"); setPicking(p => !p); } }}
        style={({ pressed }) => ({ minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 17, backgroundColor: i ? (picking ? "rgba(36,91,204,0.12)" : "rgba(20,28,40,0.06)") : palette.ink, opacity: pressed ? 0.8 : 1 })}>
        <Icon name={icon} size={12} color={i ? (picking ? palette.blue : palette.ink) : palette.white} />
        <Text style={{ fontSize: 14, fontWeight: "600", color: i ? (picking ? palette.blue : palette.ink) : palette.white }}>{label}</Text>
      </Pressable>)}
    </View>
    {picking && <SlotPicker live={live} onPick={book} onCancel={() => setPicking(false)} />}
    {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
  </View>;
}

/**
 * Live mode: what the patient's own dose log says, next to a flagged reply, so the doctor sees at a
 * glance whether "fever returned" came with missed antibiotics. Re-read when she marks a dose.
 */
function DoseLine({ patientId }: { patientId: string }) {
  const [line, setLine] = useState<{ text: string; missed: boolean }>();
  const read = useCallback(() => {
    void api.adherence.get({ patientId }).then(a => setLine(a.line ? { text: a.line, missed: true } : a.due ? { text: `All ${a.taken} doses taken so far`, missed: false } : undefined), () => {});
  }, [patientId]);
  useEffect(read, [read]);
  useLiveChanges(["day"], read);
  if (!line) return null;
  return <View accessible accessibilityLabel={`Doses: ${line.text}`} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
    <Icon name={line.missed ? "pills.fill" : "checkmark.circle.fill"} size={12} color={line.missed ? palette.amber : palette.green} />
    <Text style={{ ...type.footnote, fontWeight: "600", color: line.missed ? palette.amber : palette.green }}>{line.text}</Text>
  </View>;
}

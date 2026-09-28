import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Linking, Pressable, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { MarkedText } from "@/components/sona/marked-text";
import { LAYOUT, type riseIn } from "@/components/sona/motion";
import { ErrorLine } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Chip, Icon, useAccessibleEffects } from "@/components/sona/ui";
import { DoneLine, slotLine, SlotPicker, type PickedSlot } from "@/features/bookings/parts";
import { haptic } from "@/features/clinical/medication-parts";
import type { DayItem } from "@/features/day/model";
import { useEncounter } from "@/features/encounter/store";
import type { Patient } from "@/features/encounter/types";
import { api, errorText, requestId, useLive } from "@/features/live";
import { useLiveChanges } from "@/features/live/channel";
import { useRole } from "@/features/live/roles";
import { callBackNote, shortDate, WARD_PHONE, type ReplyLabel } from "./model";
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
 * My Day's one tap on a flagged reply: call back or book in. Call back opens the phone's dialer, then
 * asks to log the call: the flag's task is done and, live, the patient's Sona Care thread says who
 * called. Book in opens the slot picker in place (the care-team doctor preselected); in live mode the
 * booking is real: the server books the slot, closes the flag and the patient's Sona Care shows the
 * visit at once. Each action shows only for a role the server lets do it.
 */
export function FlagActions({ item }: { item: DayItem }) {
  const { on: live, user } = useLive();
  const role = useRole();
  const canCall = role.can("tasks.complete") && (!live || role.can("messages.reply"));
  const canBook = role.can("checkIns.bookIn");
  const { reducedMotion } = useAccessibleEffects();
  const [doing, setDoing] = useState<string>();
  // After a live Book in: the visit, and her X-ray findings that could ride on it.
  const [visit, setVisit] = useState<{ id: string; toAdd: { id: string; label: string; test: string; tracked: boolean; dueAt: Date | string }[] }>();
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [picking, setPicking] = useState(false);
  // Dialled and waiting to be logged; `logging` while the note goes to the server.
  const [dialled, setDialled] = useState(false);
  const [logging, setLogging] = useState(false);
  // One ID per flag, so a retried log stores one note.
  const [noteId] = useState(requestId);
  const taskId = item.id.replace(/^check-in-/, "");
  const first = item.title.split(":")[0];
  // Book in at the slot picked in place: live, the server books it and her Sona Care shows it at once.
  const book = (slot: PickedSlot) => {
    haptic("select"); setError(undefined); setPicking(false);
    if (!live) { done(`Booked in ${slotLine(slot.startsAt)} · simulated`); return; }
    setDoing("Booking…");
    bookIn(taskId, true, slot).then(booked => {
      if (booked) setVisit({ id: booked.appointmentId, toAdd: booked.toAdd });
      const when = slotLine(booked?.startsAt ?? slot.startsAt);
      setDoing(`Booked in ${when} · ${first}'s app updated`);
      AccessibilityInfo.announceForAccessibility(`Booked in ${when}. ${first}'s Sona Care shows it now.`);
    }, e => { setError(errorText(e)); setDoing(undefined); });
  };
  // The confirmation, a beat to read it, then the flag's task is closed and the row leaves.
  const done = (label: string) => {
    setDoing(label);
    AccessibilityInfo.announceForAccessibility(label);
    setTimeout(() => { resolveFlag(taskId, live).catch(e => { setError(errorText(e)); setDoing(undefined); }); }, reducedMotion ? 0 : 1200);
  };
  const call = () => {
    haptic("select"); setError(undefined); setPicking(false); setDialled(true);
    Linking.openURL(`tel:${WARD_PHONE.tel}`).catch(() => setError(`This device can't place calls. Dial ${WARD_PHONE.display} from a phone, then log it.`));
  };
  // Live: the note lands in her Sona Care thread first; only then is the call shown as logged.
  const logCall = async () => {
    haptic("select"); setError(undefined);
    if (live && item.patientId) {
      setLogging(true);
      try { await api.messages.reply({ patientId: item.patientId, text: callBackNote(user?.name), requestId: noteId }); }
      catch (e) { setError(`Not logged: ${errorText(e)}`); return; }
      finally { setLogging(false); }
    }
    done(live && item.patientId ? `Called back · noted in ${first}'s Sona Care` : "Called back · logged");
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
    </View> : <DoneLine text={doing} />}
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
  if (!canCall && !canBook) return live && item.patientId ? <DoseLine patientId={item.patientId} /> : null;
  const pill = (label: string, icon: string, primary: boolean, onPress: () => void, extra?: { expanded?: boolean; busy?: boolean; a11y?: string }) =>
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={extra?.a11y ?? label} accessibilityState={{ expanded: extra?.expanded, busy: extra?.busy }} disabled={extra?.busy} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 17, backgroundColor: primary ? palette.ink : extra?.expanded ? "rgba(36,91,204,0.12)" : "rgba(20,28,40,0.06)", opacity: pressed || extra?.busy ? 0.7 : 1 })}>
      <Icon name={icon} size={12} color={primary ? palette.white : extra?.expanded ? palette.blue : palette.ink} />
      <Text style={{ fontSize: 14, fontWeight: "600", color: primary ? palette.white : extra?.expanded ? palette.blue : palette.ink }}>{label}</Text>
    </Pressable>;
  return <View style={{ gap: 6 }}>
    {live && item.patientId && <DoseLine patientId={item.patientId} />}
    {dialled && <Text selectable style={{ ...type.footnote, color: palette.muted }}>Dialled the ward line, {WARD_PHONE.display} (no patient number on file). Log the call when you're done.</Text>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {dialled
        ? [pill(logging ? "Logging…" : "Log call-back", "checkmark", true, () => { void logCall(); }, { busy: logging, a11y: `Log call-back to ${first}` }),
          pill("Not now", "xmark", false, () => { setDialled(false); setError(undefined); })]
        : [canCall && pill("Call back", "phone.fill", true, call, { a11y: `Call back ${first}` }),
          canBook && pill("Book in", "calendar.badge.plus", false, () => { haptic("select"); setPicking(p => !p); }, { expanded: picking, a11y: `Book in ${first}` })]}
    </View>
    {picking && <SlotPicker live={live} onPick={book} onCancel={() => setPicking(false)} />}
    {error && (dialled ? <ErrorLine text={error} onRetry={error.startsWith("Not logged") ? () => { void logCall(); } : undefined} /> : <Text selectable style={{ ...type.footnote, color: palette.red }}>{error}</Text>)}
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

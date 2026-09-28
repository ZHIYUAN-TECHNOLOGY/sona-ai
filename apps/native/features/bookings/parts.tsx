import { clinicSlots, DOCTORS, slotWords } from "@sona-ai/domain/doctors";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import Animated, { FadeIn, withSpring, withTiming } from "react-native-reanimated";
import { riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Chip, Expand, Icon, useAccessibleEffects } from "@/components/sona/ui";
import { haptic } from "@/features/clinical/medication-parts";
import type { DayItem } from "@/features/day/model";
import { api, errorText } from "@/features/live";
import { decideBooking } from "@/features/live/server-day";

/*
 * Booking on the clinician side, in place (never a new screen): the slot picker Book in opens under a
 * flagged reply, and Confirm / Decline on a Sona Care booking request row.
 *
 * Motion, after 60fps "Canopi Date Picker" (https://60fps.design/shots/canopi-date-picker): the picker
 * unfolds from the row on the layout spring (fast, subtle, no bounce) and the times crossfade when the
 * day changes, so the doctor never leaves the row. The confirmation, after 60fps "Finma Demo Account
 * Setup Check Animation" (https://60fps.design/shots/finma-demo-account-setup-check-animation): the
 * check pops in on a subtle spring from 0.6 and the line rises in just behind it. Reduce Motion: the
 * picker fades, the check and line appear still.
 */

type Slots = { doctor: { id: string; name: string; specialty: string }; careTeam: { id: string; name: string; specialty: string }[]; days: { day: Date; times: Date[] }[] };
export type PickedSlot = { startsAt: Date; doctorId: string };

// Fixture mode: the synthetic care team's clinic times, nothing held.
function localSlots(doctorId?: string): Slots {
  const team = DOCTORS.filter(d => d.careTeam).sort((a, b) => a.name.localeCompare(b.name));
  const doctor = team.find(d => d.id === doctorId) ?? team[0]!;
  return { doctor, careTeam: team, days: clinicSlots(doctor, new Date()) };
}
const DAYS_SHOWN = 6;
/** "Thu 1 Oct, 10:30" in the hospital's time. */
export const slotLine = (at: Date | string) => { const w = slotWords(at); return `${w.day}, ${w.time}`; };

/** Next clinic days for a care-team doctor (preselected), that day's free times, then one confirm. */
export function SlotPicker({ live, onPick, onCancel }: { live: boolean; onPick: (slot: PickedSlot) => void; onCancel: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const [doctorId, setDoctorId] = useState<string>();
  const [slots, setSlots] = useState<Slots>();
  const [error, setError] = useState<string>();
  const [dayAt, setDayAt] = useState(0);
  const [at, setAt] = useState<number>();
  useEffect(() => {
    let stale = false;
    const pick = (s: Slots) => { if (stale) return; setSlots(s); setDayAt(0); setAt(s.days[0] ? new Date(s.days[0].times[0]!).getTime() : undefined); };
    setError(undefined);
    if (!live) pick(localSlots(doctorId));
    else api.bookings.slots(doctorId ? { doctorId } : undefined).then(pick, e => { if (!stale) setError(errorText(e)); });
    return () => { stale = true; };
  }, [live, doctorId]);
  const days = slots?.days.slice(0, DAYS_SHOWN) ?? [];
  const day = days[dayAt];
  const choose = (next: () => void) => { haptic("select"); next(); };

  return <Expand style={{ gap: 10 }}>
    {!slots ? (error ? <Text selectable style={{ ...type.footnote, color: palette.red }}>{error}</Text> : <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start", minHeight: 40 }} />) : <>
      {slots.careTeam.length > 1 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {slots.careTeam.map(d => <Chip key={d.id} label={`${d.name.split(" ").slice(0, 2).join(" ")} · ${d.specialty}`} selected={d.id === slots.doctor.id}
          accessibilityLabel={`With ${d.name}, ${d.specialty}`} onPress={() => choose(() => setDoctorId(d.id))} />)}
      </View>}
      {days.length ? <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }}>
          {days.map((d, i) => { const w = slotWords(d.day); return <Chip key={w.day} label={w.day.replace(/ \S+$/, "")} selected={i === dayAt} accessibilityLabel={w.day}
            onPress={() => choose(() => { setDayAt(i); setAt(new Date(d.times[0]!).getTime()); })} />; })}
        </ScrollView>
        <Animated.View key={`${slots.doctor.id}-${dayAt}`} entering={reducedMotion ? undefined : FadeIn.duration(200)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {day?.times.map(t => { const ms = new Date(t).getTime(); return <Chip key={ms} label={slotWords(t).time} selected={ms === at} accessibilityLabel={slotLine(t)} onPress={() => choose(() => setAt(ms))} />; })}
        </Animated.View>
      </> : <Text style={{ ...type.footnote, color: palette.muted }}>No free clinic time in the next two weeks. Call the clinic to fit them in.</Text>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {at !== undefined && <Pressable accessibilityRole="button" accessibilityLabel={`Book in ${slotLine(new Date(at))} with ${slots.doctor.name}`}
          onPress={() => onPick({ startsAt: new Date(at), doctorId: slots.doctor.id })}
          style={({ pressed }) => ({ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: 20, backgroundColor: palette.ink, opacity: pressed ? 0.8 : 1 })}>
          <Icon name="calendar.badge.checkmark" size={13} color={palette.white} />
          <Text style={{ fontSize: 14, fontWeight: "600", color: palette.white }}>Book {slotLine(new Date(at))}</Text>
        </Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel booking" onPress={onCancel} hitSlop={6} style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: palette.muted }}>Cancel</Text>
        </Pressable>
      </View>
    </>}
  </Expand>;
}

/** The check lands on a subtle spring from 0.6 (Finma). */
const pop = () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ scale: 0.6 }] }, animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ scale: withSpring(1, { duration: 380, dampingRatio: 0.72 }) }] } };
};

/** A done line: green check and what happened ("Booked in Thu 1 Oct, 10:30 · Amelia's app updated"). */
export function DoneLine({ text }: { text: string }) {
  const { reducedMotion } = useAccessibleEffects();
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 34 }}>
    <Animated.View entering={reducedMotion ? undefined : pop}><Icon name="checkmark.circle.fill" size={13} color={palette.green} /></Animated.View>
    <Animated.View entering={reducedMotion ? undefined : riseIn({ delay: 80, distance: 6, duration: 300 })} style={{ flexShrink: 1 }}>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.green }}>{text}</Text>
    </Animated.View>
  </View>;
}

// Rows just decided stay on My Day for a beat, so the doctor reads the confirmation before the row leaves.
let kept: DayItem[] = [];
const listeners = new Set<() => void>();
const setKept = (next: DayItem[]) => { kept = next; listeners.forEach(l => l()); };
export const useKeptBookings = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => kept);
const release = (id: string) => setKept(kept.filter(k => k.id !== id));

/** Confirm (the visit goes on the patient's Schedule) or decline with a note (it goes to their thread), in place. */
export function BookingActions({ item }: { item: DayItem }) {
  const { reducedMotion } = useAccessibleEffects();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>();
  const [error, setError] = useState<string>();
  const requestId = item.id.replace(/^booking-/, "");
  const first = item.title.split(" ")[0];
  const decide = (decision: "confirm" | "decline") => {
    haptic("select"); setBusy(true); setError(undefined);
    setKept([...kept.filter(k => k.id !== item.id), item]);
    decideBooking({ requestId, decision, note: decision === "decline" ? note.trim() || undefined : undefined }).then(r => {
      const text = decision === "confirm" ? `Confirmed ${slotLine(r.startsAt)} · ${first}'s app updated` : `Declined · ${first} was asked to choose another time`;
      setDone(text);
      AccessibilityInfo.announceForAccessibility(text);
      setTimeout(() => release(item.id), reducedMotion ? 800 : 2400);
    }, e => { setError(errorText(e)); release(item.id); }).finally(() => setBusy(false));
  };
  if (done) return <DoneLine text={done} />;
  const pill = (label: string, icon: string, dark: boolean, onPress: () => void) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={`${label} ${first}'s request`} disabled={busy} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 17, backgroundColor: dark ? palette.ink : "rgba(20,28,40,0.06)", opacity: pressed || busy ? 0.7 : 1 })}>
    <Icon name={icon} size={12} color={dark ? palette.white : palette.ink} />
    <Text style={{ fontSize: 14, fontWeight: "600", color: dark ? palette.white : palette.ink }}>{label}</Text>
  </Pressable>;
  return <View style={{ gap: 8 }}>
    {!declining ? <View style={{ flexDirection: "row", gap: 8 }}>
      {pill(busy ? "Confirming…" : "Confirm", "checkmark", true, () => decide("confirm"))}
      {pill("Decline", "xmark", false, () => { haptic("select"); setDeclining(true); })}
    </View> : <Expand style={{ gap: 8 }}>
      <TextInput value={note} onChangeText={setNote} autoFocus placeholder={`Note for ${first} (optional), e.g. Wednesday 9:00 works`} placeholderTextColor={palette.muted} maxLength={500}
        accessibilityLabel={`Note for ${first}, optional`} returnKeyType="send" onSubmitEditing={() => decide("decline")}
        style={{ minHeight: 40, borderRadius: 14, borderCurve: "continuous", paddingHorizontal: 12, fontSize: 15, color: palette.ink, backgroundColor: "rgba(20,28,40,0.05)" }} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {pill(busy ? "Declining…" : "Decline and tell them", "paperplane", true, () => decide("decline"))}
        {pill("Back", "chevron.left", false, () => setDeclining(false))}
      </View>
    </Expand>}
    {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
  </View>;
}

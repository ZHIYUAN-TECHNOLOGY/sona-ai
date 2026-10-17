import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import Animated, { Easing, FadeIn, FadeOut, FadeOutDown, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { SampleLabel } from "@/components/sona/model-answer";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { QuickActions, type QuickAction } from "@/components/sona/quick-actions";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Chip, Expand, Icon, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { ErrorLine, PressScale } from "@/components/sona/parts";
import { usePreloadVisit } from "@/features/encounter/navigation";
import { useEncounterSelect } from "@/features/encounter/store";
import type { Patient } from "@/features/encounter/types";
import { useLive } from "@/features/live";
import { serverDayPatients, serverVisit } from "@/features/live/day";
import { api, errorText } from "@/features/live";
import { useOpened } from "@/components/sona/opening";
import { refreshServerData, serverDayCount, useServerData, useServerDay, useServerDayError } from "@/features/live/server-day";
import { localDate } from "@/features/tasks/state";
import { useDemoOffset } from "@/features/live/demo-clock";
import { useRole } from "@/features/live/roles";
import type { Bed, Owner } from "@/features/ward/model";
import { WardGlance } from "@/features/ward/ops";
import { TodayWatches } from "@/features/watches";
import { needLine } from "./counts";
import { DayVisits, NeedsYou } from "./needs-you";
import { useNeedsYou, useWardBeds } from "./use-counts";
import { dayOf, groupVisits, ownersOf, scheduleFor, unownedBlocked, type DayItem, type ScheduleVisit } from "./model";

/*
 * Today: the insight line ("2 patients need you · 4 visits"), the keys, then who needs you now (one ranking, the
 * header's count; its first row is the day's lead), the discharges blocked, your tasks and the day's visits. On first
 * open, as the opening layer lifts, the keys then the sections rise in (0.45 s, 80 ms apart); later visits show them settled.
 */
let sortedOnce = false;

const nowMinutes = (d: Date) => d.getHours() * 60 + d.getMinutes();
const haptic = () => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); };


/*
 * Time ruler (after Habitastic's check-in timeline): a quiet tick ruler (15-minute ticks, hour
 * labels) with the window clipped to the card width. Each visit is a round avatar pin with first name and time; a
 * "Now" bubble marks the current time. Drag it with momentum; on release it settles on the
 * nearest visit or back on now (spring 0.6 s, damping 0.85) with one haptic. Tap a pin to open it.
 */
// Lanes: now pill 2–24 pt, visit pins from 32 pt, ticks and hour labels at the bottom.
const LANE_PIN = 32, PILL = 60;
const PX = 5; // points per minute: 30 minutes = 150 pt, room for a name pin
// A pin's width in minutes: avatars, label and padding at 13 pt (~7 pt a character), plus a gap.
const pinMinutes = (group: { p: { name: string; time: string } }[]) => {
  const avatars = 30 + (Math.min(group.length, 3) - 1 + (group.length > 3 ? 1 : 0)) * 20;
  const label = group.length === 1 ? group[0]!.p.name.split(" ")[0]!.length + 8 : 18 + (new Set(group.map(v => v.p.time)).size > 1 ? 6 : 0);
  return (avatars + label * 7 + 30) / PX;
};
const TONE_PIN = { done: { fill: "rgba(36,91,204,0.14)", ink: palette.blue }, open: { fill: "rgba(196,120,20,0.16)", ink: palette.amber } };
/** A visit pin fades out as it reaches the ruler's left edge, so no half-cut pill sits against it. */
function EdgeFade({ x, left, children }: { x: SharedValue<number>; left: number; children: ReactNode }) {
  const style = useAnimatedStyle(() => ({ opacity: interpolate(x.value + left, [0, 24], [0, 1], "clamp") }));
  return <Animated.View style={[{ alignItems: "flex-start" }, style]}>{children}</Animated.View>;
}
function TimeBar({ schedule, now, onOpen }: { schedule: ScheduleVisit[]; now?: number; onOpen: (patientId: string) => void }) {
  const { width } = useWindowDimensions();
  const { reducedMotion } = useAccessibleEffects();
  const view = width - 40;
  // The whole day, 00:00–24:00. Today opens on now; other days on their first visit.
  const from = 0, to = 24 * 60;
  const xOf = (m: number) => (m - from) * PX;
  const visits = schedule.map(v => { const [h, m] = v.time.split(":").map(Number); return { p: { ...v, subtitle: v.reason }, at: h! * 60 + m! }; }).sort((a, b) => a.at - b.at);
  const home = now ?? visits[0]?.at ?? 9 * 60;
  // Anchors put a time 15% across the ruler, so now and the next visits fit; the view starts on now.
  const anchor = (m: number) => view * 0.15 - xOf(m);
  const stops = [anchor(home), ...groupVisits(visits, pinMinutes).map(g => anchor(g[0]!.at))];
  const min = view - xOf(to), max = 0;
  const x = useSharedValue(anchor(home)), start = useSharedValue(0);
  const tick = () => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); };
  const pan = Gesture.Pan().activeOffsetX([-8, 8]).failOffsetY([-10, 10])
    .onBegin(() => { start.set(x.value); })
    .onUpdate(e => { x.set(Math.min(max, Math.max(min, start.value + e.translationX))); })
    .onEnd(e => {
      const projected = x.value + e.velocityX * 0.2;
      let target = stops[0]!;
      for (const s of stops) if (Math.abs(s - projected) < Math.abs(target - projected)) target = s;
      x.set(reducedMotion ? target : withSpring(target, { duration: 600, dampingRatio: 0.85, velocity: e.velocityX }));
      scheduleOnRN(tick);
    });
  const ruler = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const ticks = Array.from({ length: (to - from) / 5 + 1 }, (_, i) => from + i * 5);
  const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  // The now pill tracks the line but stays inside the view: pinned to an edge (with an arrow) when
  // now is scrolled away, and tapping it brings the ruler back to now.
  const nowAt = xOf(now ?? -9999) + 4;
  const pill = useAnimatedStyle(() => { const px = x.value + nowAt; return { transform: [{ translateX: Math.min(view + 4 - PILL / 2 - 4, Math.max(PILL / 2 + 4, px)) - PILL / 2 }] }; });
  const leftArrow = useAnimatedStyle(() => ({ opacity: x.value + nowAt < PILL / 2 + 4 ? 1 : 0 }));
  const rightArrow = useAnimatedStyle(() => ({ opacity: x.value + nowAt > view - PILL / 2 ? 1 : 0 }));
  const backToNow = () => { tick(); x.set(reducedMotion ? anchor(home) : withSpring(anchor(home), { duration: 600, dampingRatio: 0.85 })); };
  return <View accessible={false} style={{ height: 116, overflow: "hidden", marginHorizontal: -4, borderRadius: radius.control }}>
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ position: "absolute", left: 4, top: 0, bottom: 0, width: xOf(to) + 1 }, ruler]}>
        {/* 289 ticks: an hour's is a tick with its label under it; the others are one view each, placed where the hour's
            column centres its tick (1.5 pt wide in a 1 pt column: 0.25 pt left of the minute), half the views to mount. */}
        {ticks.map(m => m % 60 === 0 ? <View key={m} style={{ position: "absolute", left: xOf(m), bottom: 18, alignItems: "center", width: 1 }}>
          <View style={{ width: 1.5, height: 16, borderRadius: 1, backgroundColor: "rgba(20,28,40,0.3)" }} />
          <Text style={{ ...type.caption, position: "absolute", top: 20, width: 40, textAlign: "center", fontWeight: "600", color: palette.muted, fontVariant: ["tabular-nums"] }}>{clock(m)}</Text>
        </View> : <View key={m} style={{ position: "absolute", left: xOf(m) - 0.25, bottom: 18, width: 1.5, height: m % 15 === 0 ? 10 : 6, borderRadius: 1, backgroundColor: m % 15 === 0 ? "rgba(20,28,40,0.16)" : "rgba(20,28,40,0.08)" }} />)}
        {/* Now: only the line scrolls with the ruler; its time pill lives in its own lane above. */}
        {now !== undefined && <View pointerEvents="none" style={{ position: "absolute", left: xOf(now) - 1, top: LANE_PIN - 4, width: 2, height: 116 - 18 - (LANE_PIN - 4), borderRadius: 1, backgroundColor: palette.blue, opacity: 0.5 }} />}
        {groupVisits(visits, pinMinutes).map(group => { const first = group[0]!; const incomplete = group.some(v => v.p.incomplete); const tone = TONE_PIN[incomplete ? "open" : "done"];
          const single = group.length === 1;
          const label = single ? `${first.p.name}, ${first.p.time}, ${first.p.subtitle}` : `${group.length} patients from ${first.p.time}: ${group.map(v => v.p.name).join(", ")}`;
          return <Pressable key={first.p.id} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={single ? "Opens the visit" : "Lists these patients"} hitSlop={6}
            onPress={() => { const ids = group.map(v => v.p.patientId).filter(Boolean); if (ids.length !== group.length) return; single ? onOpen(ids[0]!) : router.push({ pathname: "/visits", params: { ids: ids.join(",") } }); }}
            style={{ position: "absolute", left: xOf(first.at) - 16, top: LANE_PIN, alignItems: "flex-start" }}><EdgeFade x={x} left={4 + xOf(first.at) - 16}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 2, paddingRight: 10, height: 36, borderRadius: 18, backgroundColor: palette.white, borderWidth: 1, borderColor: "rgba(20,28,40,0.06)", boxShadow: "0 3px 10px rgba(24,32,48,0.08)" }}>
              <View style={{ flexDirection: "row" }}>{group.slice(0, 3).map((v, i) => { const t = TONE_PIN[v.p.incomplete ? "open" : "done"]; return <View key={v.p.id}
                style={{ width: 30, height: 30, borderRadius: 15, marginLeft: i ? -10 : 0, borderWidth: single ? 0 : 2, borderColor: palette.white, backgroundColor: single ? t.fill : v.p.incomplete ? "#F6E7D3" : "#DCE6F8", alignItems: "center", justifyContent: "center", zIndex: 3 - i }}>
                <Text style={{ ...type.caption, fontWeight: "700", color: t.ink }}>{v.p.initials}</Text>
              </View>; })}{group.length > 3 && <View style={{ height: 30, minWidth: 30, marginLeft: -10, paddingHorizontal: 5, borderRadius: 15, borderWidth: 2, borderColor: palette.white, backgroundColor: palette.ink, alignItems: "center", justifyContent: "center" }}><Text style={{ ...type.caption, fontWeight: "700", color: palette.white }}>+{group.length - 3}</Text></View>}</View>
              <Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink }}>{single ? first.p.name.split(" ")[0] : `${group.length} patients`} <Text style={{ fontWeight: "500", color: palette.muted, fontVariant: ["tabular-nums"] }}>· {first.p.time}{!single && group.at(-1)!.p.time !== first.p.time ? `–${group.at(-1)!.p.time}` : ""}</Text></Text>
            </View>
            <View style={{ marginLeft: 15, width: 2, height: 14, borderRadius: 1, backgroundColor: tone.ink, opacity: 0.5 }} />
          </EdgeFade></Pressable>; })}
      </Animated.View>
    </GestureDetector>
    {!visits.length && <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: LANE_PIN, alignItems: "center" }}><View style={{ height: 32, paddingHorizontal: 14, borderRadius: 16, justifyContent: "center", backgroundColor: "rgba(20,28,40,0.05)" }}><Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>No visits</Text></View></View>}
    {now !== undefined && <Animated.View style={[{ position: "absolute", left: 0, top: 2, width: PILL, alignItems: "center", zIndex: 3 }, pill]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Now, ${clock(now!)}. Scroll the timeline back to now`} onPress={backToNow} hitSlop={10}
        style={{ height: 22, paddingHorizontal: 8, borderRadius: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: palette.blue, boxShadow: "0 2px 6px rgba(36,91,204,0.25)" }}>
        <Animated.View style={[{ position: "absolute", left: -12 }, leftArrow]}><Icon name="chevron.left" size={9} color={palette.blue} /></Animated.View>
        <Text style={{ ...type.caption, lineHeight: 13, fontWeight: "700", color: palette.white, fontVariant: ["tabular-nums"], includeFontPadding: false }}>{clock(now!)}</Text>
        <Animated.View style={[{ position: "absolute", right: -12 }, rightArrow]}><Icon name="chevron.right" size={9} color={palette.blue} /></Animated.View>
      </Pressable>
    </Animated.View>}
  </View>;
}

/**
 * A bed manager's Today after the ward line: the blocked discharges with a blocker nobody owns, each with
 * the team suggested for it (one tap assigns, the same call as the Ward's owner picker) and the bed on the Ward.
 */
function UnownedBeds({ beds }: { beds: Bed[] }) {
  const server = useServerData();
  // Assigned here and not yet back from the server's task list: shown owned at once, restored if refused.
  const [assigned, setAssigned] = useState<Record<string, Owner>>({});
  const { reducedMotion } = useAccessibleEffects();
  const [error, setError] = useState<string>();
  const rows = unownedBlocked(beds, { ...ownersOf(server?.tasks ?? []), ...assigned });
  const assign = (id: string, owner: Owner) => {
    haptic(); setError(undefined); setAssigned(a => ({ ...a, [id]: owner }));
    api.ward.assignOwner({ blockerId: id, owner }).then(() => refreshServerData().catch(() => {}),
      e => { setAssigned(({ [id]: _, ...rest }) => rest); setError(`Not assigned: ${errorText(e)}`); });
  };
  if (!rows.length) return <Text style={{ ...type.subhead, color: palette.muted }}>Every blocker has an owner.</Text>;
  return <Surface layout={reducedMotion ? undefined : LAYOUT} style={{ padding: 16, gap: 12 }}>
    <Text style={{ ...type.overline, color: palette.amber }}>No owner yet · {rows.length} {rows.length === 1 ? "bed" : "beds"}</Text>
    {rows.map((r, i) => <Animated.View key={r.bed} layout={reducedMotion ? undefined : LAYOUT} style={{ gap: 8, paddingTop: i ? 12 : 0, borderTopWidth: i ? 1 : 0, borderColor: "rgba(20,28,40,0.06)" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{r.bed} · {r.name.split(" ")[0]}</Text>
          {r.hours > 0 && <Text style={{ ...type.caption, color: palette.muted }}>~{r.hours} bed-hours waiting</Text>}
        </View>
        <Chip label={`Open ${r.bed}`} accessibilityLabel={`Open ${r.bed} on the ward`} onPress={() => { haptic(); router.push({ pathname: "/ward", params: { filter: "blocked", bed: r.bed } }); }} />
      </View>
      {r.blockers.map(x => <View key={x.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ ...type.footnote, flex: 1, color: palette.ink }}>{x.label} <Text style={{ color: palette.muted }}>· {x.suggested} suggested</Text></Text>
        <Chip selected label={`Assign ${x.suggested}`} accessibilityLabel={`Assign ${x.label.toLowerCase()} on ${r.bed} to ${x.suggested}`} onPress={() => assign(x.id, x.suggested)} />
      </View>)}
    </Animated.View>)}
    {error && <ErrorLine text={error} />}
  </Surface>;
}

/*
 * Day picker (after Days' calendar top modal): tapping the date line springs this card down from
 * it, scaling up from its top-left anchor (spring 0.45 s, damping 0.72) while its weeks rise in
 * 40 ms apart. It floats over the ruler and list; picking a day folds it back. Dots mark visit
 * counts; today keeps a blue ring. Weekend days with nothing booked are dimmed.
 */
function MonthCard({ offset, now, counts, onPick, onClose }: { offset: number; now: Date; counts: (offset: number) => number; onPick: (offset: number) => void; onClose: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const today = new Date(now); today.setHours(12, 0, 0, 0);
  const [month, setMonth] = useState(() => { const d = dayOf(offset, today); return new Date(d.getFullYear(), d.getMonth(), 1, 12); });
  const lead = (month.getDay() + 6) % 7; // Monday first
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const offsetOf = (d: number) => Math.round((new Date(month.getFullYear(), month.getMonth(), d, 12).getTime() - today.getTime()) / 86_400_000);
  const shift = (by: number) => { haptic(); setMonth(m => new Date(m.getFullYear(), m.getMonth() + by, 1, 12)); };
  return <>
    <Pressable accessibilityLabel="Close day picker" onPress={onClose} style={{ position: "absolute", left: -20, right: -20, top: -400, height: 3000, zIndex: 1 }} />
    <Animated.View entering={reducedMotion ? FadeIn.duration(160) : riseIn({ distance: -10, scale: 0.9, duration: 450 })} exiting={FadeOut.duration(140)}
      style={{ position: "absolute", top: 78, left: 0, right: 0, zIndex: 2, transformOrigin: "top left", borderRadius: radius.card, borderCurve: "continuous", backgroundColor: palette.surface, borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", boxShadow: "0 0 0 0.5px rgba(20,28,40,0.06), 0 18px 44px rgba(24,32,48,0.18)", padding: 14, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => shift(-1)} hitSlop={8} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}><Icon name="chevron.left" size={13} color={palette.ink} /></Pressable>
        <Text accessibilityRole="header" style={{ flex: 1, textAlign: "center", ...type.headline, color: palette.ink }}>{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => shift(1)} hitSlop={8} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}><Icon name="chevron.right" size={13} color={palette.ink} /></Pressable>
      </View>
      <View style={{ flexDirection: "row" }}>{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <Text key={i} style={{ flex: 1, textAlign: "center", ...type.caption, fontWeight: "600", color: palette.muted }}>{d}</Text>)}</View>
      {weeks.map((week, w) => <Animated.View key={w} entering={reducedMotion ? undefined : riseIn({ delay: 80 + w * 40, distance: 6, duration: 300 })} style={{ flexDirection: "row" }}>
        {Array.from({ length: 7 }, (_, i) => week[i] ?? null).map((d, i) => { if (!d) return <View key={i} style={{ flex: 1, height: 44 }} />;
          const o = offsetOf(d), n = counts(o), on = o === offset, isToday = o === 0;
          return <Pressable key={i} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${isToday ? "Today, " : ""}${d} ${month.toLocaleDateString("en-GB", { month: "long" })}, ${n} ${n === 1 ? "visit" : "visits"}`}
            onPress={() => onPick(o)} style={{ flex: 1, height: 44, alignItems: "center", justifyContent: "center", gap: 2 }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: on ? palette.ink : "transparent", borderWidth: isToday && !on ? 1.5 : 0, borderColor: palette.blue }}>
              <Text style={{ ...type.callout, fontWeight: on || isToday ? "700" : "500", color: on ? palette.white : isToday ? palette.blue : n ? palette.ink : palette.muted, fontVariant: ["tabular-nums"] }}>{d}</Text>
            </View>
            <View style={{ position: "absolute", bottom: 1, flexDirection: "row", gap: 2 }}>{Array.from({ length: Math.min(3, n) }, (_, k) => <View key={k} style={{ width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: palette.blue, opacity: 0.7 }} />)}</View>
          </Pressable>; })}
      </Animated.View>)}
      {offset !== 0 && <Pressable accessibilityRole="button" onPress={() => onPick(0)} style={{ alignSelf: "center", minHeight: 44, paddingHorizontal: 16, borderRadius: 18, justifyContent: "center", backgroundColor: palette.blueWash }}>
        <Text style={{ ...type.subhead, fontWeight: "600", color: palette.blue }}>Jump to today</Text>
      </Pressable>}
    </Animated.View>
  </>;
}

export function MyDay({ patients: fixturePatients, greeting, actions, onOpen: open }: { patients: Patient[]; greeting: string; actions: QuickAction[]; onOpen: (patientId: string, open: DayItem["open"]) => void }) {
  const [calendar, setCalendar] = useState(false);
  // Insight first: the ranked day leads, and the 24-hour ruler waits behind one row (it is navigation, not the answer).
  const [timeline, setTimeline] = useState(false);
  const [offset, setOffset] = useState(0);
  // Live backend mode: the day's appointments, results and tasks come from the server (fixtures otherwise).
  const { on: live } = useLive();
  const { role } = useRole();
  // Management and bed managers get a ward-first Today, not clinical tasks; a bed manager's also lists the beds nobody owns yet.
  const bedManager = live && role === "bed-manager";
  const managing = live && role === "management" || bedManager;
  const beds = useWardBeds();
  // The minute timer: re-reads waits and visit times by the clock.
  const [at, setAt] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setAt(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  // "Now" on the hospital's demo clock in live mode, as Sona Care reads it (else the phone's): the day, its visits and how long ago a patient asked.
  const offsetMs = useDemoOffset();
  const clock = new Date(at + offsetMs);
  const today = useServerDay(live ? localDate(clock) : undefined);
  const otherDay = useServerDay(live && offset !== 0 ? localDate(dayOf(offset, clock)) : undefined);
  // The day on view failed to load: said as that with Retry, never shown as a day with nothing booked.
  const dayError = useServerDayError(live ? localDate(dayOf(offset, clock)) : undefined);
  const patients = live ? serverDayPatients(fixturePatients, today ?? []) : fixturePatients;
  // Today's one ranking (counts.needsYou): the header counts its patients and Needs you now lists them, so the two always agree.
  const needs = useNeedsYou();
  const { reducedMotion } = useAccessibleEffects();
  const now = nowMinutes(clock);
  // First open: the opening layer covers the wait (components/sona/opening), and the sections rise in as it lifts.
  const opened = useOpened();
  const sorting = !opened;
  const [animate, setAnimate] = useState(!sortedOnce && !reducedMotion);
  useEffect(() => { if (opened) sortedOnce = true; }, [opened]);

  const schedule = live && offset !== 0 ? (otherDay ?? []).map(a => serverVisit(a, fixturePatients.map(p => p.id))) : scheduleFor(offset, patients, clock);
  const date = dayOf(offset, clock);
  const [switched, setSwitched] = useState(false);
  const pick = (next: number) => { if (next === offset) return; haptic(); setSwitched(true); setAnimate(false); setOffset(next); };
  // The visit most likely opened next (the first need's, else the first on the roster) is built once the opening has lifted.
  usePreloadVisit(opened ? needs[0]?.patient?.id ?? patients[0]?.id : undefined);
  // The shelf reports where it ends, so the collapsed capsule appears only once it has scrolled away. Every key stays, Results included.
  const shelf = <QuickActions actions={actions} />;

  return <View style={{ gap: 14 }}>
    <View style={{ gap: 16, zIndex: 5 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text accessibilityRole="header" style={{ ...type.display, fontWeight: "600", color: palette.ink }}>{greeting}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`${offset === 0 ? "Today" : ""} ${date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}. Choose another day`} accessibilityState={{ expanded: calendar }}
            onPress={() => { haptic(); setCalendar(v => !v); }} hitSlop={8} style={{ alignSelf: "flex-start", gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ ...type.headline, fontWeight: "600", color: offset === 0 ? palette.blue : palette.ink }}>{offset === 0 ? "Today, " : ""}{date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</Text>
              <Animated.View style={{ transform: [{ rotate: calendar ? "180deg" : "0deg" }], transitionProperty: "transform", transitionDuration: reducedMotion ? 0 : 240 } as never}><Icon name="chevron.down" size={12} color={offset === 0 ? palette.blue : palette.ink} /></Animated.View>
            </View>
            <Text style={{ ...type.footnote, fontWeight: "500", color: palette.muted }}>{offset === 0 ? (managing ? "" : `${needLine(needs.length)} · `) : offset < 0 ? "Looking back · " : "Coming up · "}{schedule.length} {schedule.length === 1 ? "visit" : "visits"}</Text>
          </Pressable>
        </View>
        {offset !== 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Back to today" onPress={() => pick(0)} hitSlop={8}
          style={{ minHeight: 38, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: 19, backgroundColor: palette.blueWash, marginTop: 4 }}>
          <Icon name="arrow.uturn.backward" size={12} color={palette.blue} /><Text style={{ ...type.subhead, fontWeight: "600", color: palette.blue }}>Today</Text>
        </Pressable> : null}
      </View>
      {calendar && <MonthCard offset={offset} now={clock} counts={o => live ? serverDayCount(localDate(dayOf(o, clock))) : scheduleFor(o, patients, clock).length} onPick={o => { setCalendar(false); pick(o); }} onClose={() => setCalendar(false)} />}
    </View>
    {dayError && <ErrorLine text={`${offset === 0 ? "Today's" : "This day's"} visits didn't load: ${dayError.error}`} onRetry={dayError.retry} />}
    {/* Management's day leads with the ward and this week's numbers, not clinical tasks. */}
    {managing && <WardGlance />}
    {offset === 0 && bedManager && <UnownedBeds beds={beds} />}
    {offset === 0 && managing && shelf}
    {offset === 0 && managing && <TodayWatches />}
    {managing || sorting ? null : <Animated.View key={`day-${offset}`} entering={switched && !reducedMotion ? riseIn({ delay: 60, distance: 48, duration: 420 }) : undefined} exiting={reducedMotion ? undefined : FadeOutDown.duration(180)} style={{ gap: 14 }}>
      {/* Medium-style cascade on first open: the keys, then the sections a beat later. */}
      {offset === 0 && <Animated.View entering={animate ? riseIn({ distance: 14, duration: 450 }) : undefined}>{shelf}</Animated.View>}
      {/* Who needs you (the header's count; its first row is the day's lead), the discharges blocked and your tasks, each acted on in place; its own empty line stands for the day's. */}
      {offset === 0 && <Animated.View entering={animate ? riseIn({ delay: 80, distance: 14, duration: 450 }) : undefined}><NeedsYou needs={needs} now={now} beds={beds} live={live} /></Animated.View>}
      {/* What the clinician asked Sona to keep asking, answered, since they asked to see it each day. */}
      {offset === 0 && <TodayWatches />}
      {/* The day's visits by time (only real visits open; another day's authored schedule is read-only), then the ruler behind one row. */}
      {!dayError && <DayVisits schedule={schedule} offset={offset} onOpen={id => open(id, {})} />}
      {schedule.length > 0 && <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: timeline }} onPress={() => { haptic(); setTimeline(v => !v); }} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name={timeline ? "chevron.up" : "clock"} size={13} color={palette.blue} />
          <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{timeline ? "Hide the timeline" : "See the day on a timeline"}</Text>
        </Pressable>
        {timeline && <Expand><TimeBar key={offset} schedule={schedule} now={offset === 0 ? now : undefined} onOpen={id => open(id, {})} /></Expand>}
      </Animated.View>}
      {offset !== 0 && !live && <Text style={{ ...type.caption, color: palette.muted }}>Clinic schedule for other days; open today's visits to act.</Text>}
      {offset !== 0 && live && <SampleLabel source="fixture" rule />}
    </Animated.View>}
  </View>;
}

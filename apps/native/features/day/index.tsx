import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import Animated, { Easing, FadeIn, FadeOut, FadeOutDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Expand, Icon, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import type { Patient } from "@/features/encounter/types";
import { useLive } from "@/features/live";
import { newestResult, serverDayPatients, serverVisit } from "@/features/live/day";
import { acknowledgeResult, serverDayCount, useServerData, useServerDay, useVisitTasks } from "@/features/live/server-day";
import { localDate } from "@/features/tasks/state";
import { dayOf, groupVisits, rankDay, rankOtherDay, scheduleFor, type DayItem, type DayTone, type ScheduleVisit } from "./model";

/*
 * My day, ranked (after Superlist's AI list making): on first open a small "Sorting your day…"
 * card pulses, then morphs away as the ranked items drop in one after another (spring 0.45 s,
 * damping 0.72, 90 ms apart), most urgent first, each with the reason it is there. Later visits
 * to home show the list settled; re-ranking after a pin or snooze glides rows to their new place.
 */
const TONE: Record<DayTone, { dot: string; ink: string; wash: string }> = {
  urgent: { dot: palette.red, ink: palette.red, wash: "rgba(162,62,62,0.10)" },
  soon: { dot: "#C47814", ink: palette.amber, wash: "rgba(196,120,20,0.13)" },
  routine: { dot: "rgba(36,91,204,0.5)", ink: palette.blue, wash: "rgba(36,91,204,0.08)" },
};
const ICON: Record<DayItem["kind"], string> = { result: "testtube.2", blocker: "pills", visit: "calendar", task: "checklist" };
let sortedOnce = false;

const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const haptic = () => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); };

function Sorting() {
  const pulse = useSharedValue(0.4);
  useEffect(() => { pulse.set(withRepeat(withSequence(withTiming(1, { duration: 420 }), withTiming(0.4, { duration: 420 })), -1)); }, [pulse]);
  const dots = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View exiting={FadeOut.duration(180)} style={{ alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, height: 44, borderRadius: 22, backgroundColor: palette.ink }}>
    <Animated.View style={[{ flexDirection: "row", gap: 3 }, dots]}>{[0, 1, 2].map(i => <View key={i} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: palette.white }} />)}</Animated.View>
    <Text style={{ fontSize: 15, fontWeight: "600", color: palette.white }}>Sorting your day…</Text>
  </Animated.View>;
}

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
  return <View accessible={false} style={{ height: 116, overflow: "hidden", marginHorizontal: -4, borderRadius: 16 }}>
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ position: "absolute", left: 4, top: 0, bottom: 0, width: xOf(to) + 1 }, ruler]}>
        {ticks.map(m => { const hour = m % 60 === 0; return <View key={m} style={{ position: "absolute", left: xOf(m), bottom: 18, alignItems: "center", width: 1 }}>
          <View style={{ width: 1.5, height: hour ? 16 : m % 15 === 0 ? 10 : 6, borderRadius: 1, backgroundColor: hour ? "rgba(20,28,40,0.3)" : m % 15 === 0 ? "rgba(20,28,40,0.16)" : "rgba(20,28,40,0.08)" }} />
          {hour && <Text style={{ position: "absolute", top: 20, width: 40, textAlign: "center", fontSize: 10, fontWeight: "600", color: palette.muted, fontVariant: ["tabular-nums"] }}>{clock(m)}</Text>}
        </View>; })}
        {/* Now: only the line scrolls with the ruler; its time pill lives in its own lane above. */}
        {now !== undefined && <View pointerEvents="none" style={{ position: "absolute", left: xOf(now) - 1, top: LANE_PIN - 4, width: 2, height: 116 - 18 - (LANE_PIN - 4), borderRadius: 1, backgroundColor: palette.blue, opacity: 0.5 }} />}
        {groupVisits(visits, pinMinutes).map(group => { const first = group[0]!; const incomplete = group.some(v => v.p.incomplete); const tone = TONE_PIN[incomplete ? "open" : "done"];
          const single = group.length === 1;
          const label = single ? `${first.p.name}, ${first.p.time}, ${first.p.subtitle}` : `${group.length} patients from ${first.p.time}: ${group.map(v => v.p.name).join(", ")}`;
          return <Pressable key={first.p.id} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={single ? "Opens the visit" : "Lists these patients"} hitSlop={6}
            onPress={() => { const ids = group.map(v => v.p.patientId).filter(Boolean); if (ids.length !== group.length) return; single ? onOpen(ids[0]!) : router.push({ pathname: "/visits", params: { ids: ids.join(",") } }); }}
            style={{ position: "absolute", left: xOf(first.at) - 16, top: LANE_PIN, alignItems: "flex-start" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 2, paddingRight: 10, height: 36, borderRadius: 18, backgroundColor: palette.white, borderWidth: 1, borderColor: "rgba(20,28,40,0.06)", boxShadow: "0 3px 10px rgba(24,32,48,0.08)" }}>
              <View style={{ flexDirection: "row" }}>{group.slice(0, 3).map((v, i) => { const t = TONE_PIN[v.p.incomplete ? "open" : "done"]; return <View key={v.p.id}
                style={{ width: 30, height: 30, borderRadius: 15, marginLeft: i ? -10 : 0, borderWidth: single ? 0 : 2, borderColor: palette.white, backgroundColor: single ? t.fill : v.p.incomplete ? "#F6E7D3" : "#DCE6F8", alignItems: "center", justifyContent: "center", zIndex: 3 - i }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: t.ink }}>{v.p.initials}</Text>
              </View>; })}{group.length > 3 && <View style={{ height: 30, minWidth: 30, marginLeft: -10, paddingHorizontal: 5, borderRadius: 15, borderWidth: 2, borderColor: palette.white, backgroundColor: palette.ink, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 10, fontWeight: "700", color: palette.white }}>+{group.length - 3}</Text></View>}</View>
              <Text style={{ fontSize: 13, fontWeight: "600", color: palette.ink }}>{single ? first.p.name.split(" ")[0] : `${group.length} patients`} <Text style={{ fontWeight: "500", color: palette.muted, fontVariant: ["tabular-nums"] }}>· {first.p.time}{!single && group.at(-1)!.p.time !== first.p.time ? `–${group.at(-1)!.p.time}` : ""}</Text></Text>
            </View>
            <View style={{ marginLeft: 15, width: 2, height: 14, borderRadius: 1, backgroundColor: tone.ink, opacity: 0.5 }} />
          </Pressable>; })}
      </Animated.View>
    </GestureDetector>
    {!visits.length && <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: LANE_PIN, alignItems: "center" }}><View style={{ height: 32, paddingHorizontal: 14, borderRadius: 16, justifyContent: "center", backgroundColor: "rgba(20,28,40,0.05)" }}><Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>No visits</Text></View></View>}
    {now !== undefined && <Animated.View style={[{ position: "absolute", left: 0, top: 2, width: PILL, alignItems: "center", zIndex: 3 }, pill]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Now, ${clock(now!)}. Scroll the timeline back to now`} onPress={backToNow} hitSlop={10}
        style={{ height: 22, paddingHorizontal: 8, borderRadius: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: palette.blue, boxShadow: "0 2px 6px rgba(36,91,204,0.25)" }}>
        <Animated.View style={[{ position: "absolute", left: -12 }, leftArrow]}><Icon name="chevron.left" size={9} color={palette.blue} /></Animated.View>
        <Text style={{ fontSize: 11, lineHeight: 13, fontWeight: "700", color: palette.white, fontVariant: ["tabular-nums"], includeFontPadding: false }}>{clock(now!)}</Text>
        <Animated.View style={[{ position: "absolute", right: -12 }, rightArrow]}><Icon name="chevron.right" size={9} color={palette.blue} /></Animated.View>
      </Pressable>
    </Animated.View>}
  </View>;
}

function Row({ item, first, index, animate, pinned, onOpen, onPin, onSnooze }: { item: DayItem; first: boolean; index: number; animate: boolean; pinned: boolean; onOpen: () => void; onPin: () => void; onSnooze: () => void }) {
  const [menu, setMenu] = useState(false);
  const tone = TONE[item.tone];
  return <Animated.View layout={LAYOUT} entering={animate ? riseIn({ delay: index * 90, distance: 14, duration: 450 }) : undefined}>
    <View style={{ borderTopWidth: first ? 0 : 1, borderColor: "rgba(20,28,40,0.06)" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 14, paddingRight: 6, paddingVertical: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.reason}${pinned ? ". Pinned" : ""}`} accessibilityHint="Opens the visit" onPress={onOpen} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 36, height: 36, borderRadius: 11, borderCurve: "continuous", backgroundColor: tone.wash, alignItems: "center", justifyContent: "center" }}><Icon name={ICON[item.kind]} size={16} color={tone.ink} /></View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{pinned ? "📌 " : ""}{item.title}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone.dot }} />
              <Text numberOfLines={1} style={{ flex: 1, ...type.caption, fontWeight: "600", color: tone.ink }}>{item.reason}</Text>
            </View>
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`More for ${item.title}`} accessibilityState={{ expanded: menu }} onPress={() => { haptic(); setMenu(v => !v); }} hitSlop={6}
          style={{ width: 36, height: 44, alignItems: "center", justifyContent: "center" }}><Icon name="ellipsis" size={15} color={palette.muted} /></Pressable>
      </View>
      {menu && <Expand style={{ flexDirection: "row", gap: 8, paddingLeft: 62, paddingBottom: 12 }}>
        {[[pinned ? "Unpin" : "Pin to top", "pin", onPin], ["Snooze 1 h", "moon.zzz", onSnooze]].map(([label, icon, act]) => <Pressable key={label as string} accessibilityRole="button" accessibilityLabel={label as string}
          onPress={() => { haptic(); setMenu(false); (act as () => void)(); }} style={{ minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 17, backgroundColor: "rgba(20,28,40,0.06)" }}>
          <Icon name={icon as string} size={12} color={palette.ink} /><Text style={{ fontSize: 14, fontWeight: "500", color: palette.ink }}>{label as string}</Text>
        </Pressable>)}
      </Expand>}
    </View>
  </Animated.View>;
}

/*
 * Day picker (after Days' calendar top modal): tapping the date line springs this card down from
 * it, scaling up from its top-left anchor (spring 0.45 s, damping 0.72) while its weeks rise in
 * 40 ms apart. It floats over the ruler and list; picking a day folds it back. Dots mark visit
 * counts; today keeps a blue ring. Weekend days with nothing booked are dimmed.
 */
function MonthCard({ offset, counts, onPick, onClose }: { offset: number; counts: (offset: number) => number; onPick: (offset: number) => void; onClose: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const today = new Date(); today.setHours(12, 0, 0, 0);
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
      style={{ position: "absolute", top: 78, left: 0, right: 0, zIndex: 2, transformOrigin: "top left", borderRadius: 26, borderCurve: "continuous", backgroundColor: "#FBFCFE", borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", boxShadow: "0 0 0 0.5px rgba(20,28,40,0.06), 0 18px 44px rgba(24,32,48,0.18)", padding: 14, gap: 8 }}>
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
              <Text style={{ fontSize: 15, fontWeight: on || isToday ? "700" : "500", color: on ? palette.white : isToday ? palette.blue : n ? palette.ink : palette.muted, fontVariant: ["tabular-nums"] }}>{d}</Text>
            </View>
            <View style={{ position: "absolute", bottom: 1, flexDirection: "row", gap: 2 }}>{Array.from({ length: Math.min(3, n) }, (_, k) => <View key={k} style={{ width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: palette.blue, opacity: 0.7 }} />)}</View>
          </Pressable>; })}
      </Animated.View>)}
      {offset !== 0 && <Pressable accessibilityRole="button" onPress={() => onPick(0)} style={{ alignSelf: "center", minHeight: 36, paddingHorizontal: 16, borderRadius: 18, justifyContent: "center", backgroundColor: palette.blueWash }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: palette.blue }}>Jump to today</Text>
      </Pressable>}
    </Animated.View>
  </>;
}

export function MyDay({ patients: fixturePatients, greeting, actions, onOpen: open }: { patients: Patient[]; greeting: string; actions: ReactNode; onOpen: (patientId: string, open: DayItem["open"]) => void }) {
  const [calendar, setCalendar] = useState(false);
  const [offset, setOffset] = useState(0);
  // Live backend mode: the day's appointments, results and tasks come from the server (fixtures otherwise).
  const { on: live } = useLive();
  const server = useServerData();
  const tasksOf = useVisitTasks();
  const today = useServerDay(live ? localDate(new Date()) : undefined);
  const otherDay = useServerDay(live && offset !== 0 ? localDate(dayOf(offset)) : undefined);
  const patients = live ? serverDayPatients(fixturePatients, today ?? []) : fixturePatients;
  const result = live ? newestResult(server?.results ?? []) : undefined;
  // Only real visits open; the authored schedule on other days is read-only. Opening a live result acknowledges it.
  const onOpen = (id: string | undefined, target: DayItem["open"]) => {
    if (!id) return;
    if (result?.id && target.next === "briefing" && id === result.patientId) void acknowledgeResult(result.id).catch(() => {});
    open(id, target);
  };
  const { encounters } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const [now, setNow] = useState(nowMinutes);
  useEffect(() => { const timer = setInterval(() => setNow(nowMinutes()), 60_000); return () => clearInterval(timer); }, []);
  // First open sorts after the home greeting has settled; "Re-rank" replays it on demand.
  const [sorting, setSorting] = useState(!sortedOnce && !reducedMotion);
  const [animate, setAnimate] = useState(!sortedOnce && !reducedMotion);
  const [run, setRun] = useState(0);
  useEffect(() => { sortedOnce = true; if (!sorting) return; const timer = setTimeout(() => setSorting(false), run ? 1100 : 1700); return () => clearTimeout(timer); }, [sorting, run]);
  const [pins, setPins] = useState<string[]>([]);
  const [snoozed, setSnoozed] = useState<string[]>([]);
  const [showSnoozed, setShowSnoozed] = useState(false);

  const schedule = live && offset !== 0 ? (otherDay ?? []).map(a => serverVisit(a, fixturePatients.map(p => p.id))) : scheduleFor(offset, patients);
  const ranked = offset === 0 ? rankDay(patients, encounters, now, undefined, live ? { result, tasksOf } : undefined) : rankOtherDay(offset, schedule);
  const need = ranked.filter(item => item.tone !== "routine").length;
  const date = dayOf(offset);
  const [switched, setSwitched] = useState(false);
  const pick = (next: number) => { if (next === offset) return; haptic(); setSwitched(true); setAnimate(false); setOffset(next); };
  const active = ranked.filter(item => !snoozed.includes(item.id));
  const ordered = [...active.filter(item => pins.includes(item.id)), ...active.filter(item => !pins.includes(item.id))];
  const later = ranked.filter(item => snoozed.includes(item.id));
  const [top, ...rest] = ordered;

  return <View style={{ gap: 14 }}>
    <View style={{ gap: 16, zIndex: 5 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text accessibilityRole="header" style={{ ...type.display, fontWeight: "600", color: palette.ink }}>{greeting}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`${offset === 0 ? "Today" : ""} ${date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}. Choose another day`} accessibilityState={{ expanded: calendar }}
            onPress={() => { haptic(); setCalendar(v => !v); }} hitSlop={8} style={{ alignSelf: "flex-start", gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontSize: 17, fontWeight: "600", color: offset === 0 ? palette.blue : palette.ink }}>{offset === 0 ? "Today, " : ""}{date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</Text>
              <View style={{ transform: [{ rotate: calendar ? "180deg" : "0deg" }], transitionProperty: "transform", transitionDuration: reducedMotion ? 0 : 240 } as never}><Icon name="chevron.down" size={12} color={offset === 0 ? palette.blue : palette.ink} /></View>
            </View>
            <Text style={{ ...type.footnote, fontWeight: "500", color: palette.muted }}>{offset === 0 ? `${need} need you · ` : offset < 0 ? "Looking back · " : "Coming up · "}{schedule.length} {schedule.length === 1 ? "visit" : "visits"}</Text>
          </Pressable>
        </View>
        {offset !== 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Back to today" onPress={() => pick(0)} hitSlop={8}
          style={{ minHeight: 38, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: 19, backgroundColor: palette.blueWash, marginTop: 4 }}>
          <Icon name="arrow.uturn.backward" size={12} color={palette.blue} /><Text style={{ fontSize: 14, fontWeight: "600", color: palette.blue }}>Today</Text>
        </Pressable> : null}
      </View>
      {calendar && <MonthCard offset={offset} counts={o => live ? serverDayCount(localDate(dayOf(o))) : scheduleFor(o, patients).length} onPick={o => { setCalendar(false); pick(o); }} onClose={() => setCalendar(false)} />}
    </View>
    <TimeBar key={offset} schedule={schedule} now={offset === 0 ? now : undefined} onOpen={id => onOpen(id, {})} />
    {offset === 0 && actions}
    {sorting ? <Sorting /> : <Animated.View key={`day-${offset}`} entering={switched && !reducedMotion ? riseIn({ delay: 60, distance: 48, duration: 420 }) : undefined} exiting={reducedMotion ? undefined : FadeOutDown.duration(180)} style={{ gap: 14 }}>
      {top && <Animated.View key={`top-${run}`} layout={LAYOUT} entering={animate ? riseIn({ distance: 14, scale: 0.97, duration: 450 }) : undefined}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Most urgent: ${top.title}. ${top.reason}`} accessibilityHint="Opens the visit" onPress={() => onOpen(top.patientId, top.open)}
          style={({ pressed }) => ({ transform: [{ scale: pressed && !reducedMotion ? 0.98 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
          <Surface feature style={{ padding: 18, gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: TONE[top.tone].dot }} />
              <Text style={{ ...type.overline, color: TONE[top.tone].ink }}>{pins.includes(top.id) ? "Pinned" : offset === 0 ? "Most urgent" : offset < 0 ? "First seen" : "First to prepare"}</Text>
            </View>
            <View style={{ gap: 4 }}>
              <Text style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{top.title}</Text>
              <Text style={{ ...type.callout, color: palette.muted }}>{top.detail}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flexShrink: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: TONE[top.tone].wash }}><Text style={{ ...type.caption, fontWeight: "600", color: TONE[top.tone].ink }}>{top.reason}</Text></View>
              {top.patientId && <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: palette.ink, alignItems: "center", justifyContent: "center" }}><Icon name="arrow.right" size={14} color={palette.white} /></View>}
            </View>
          </Surface>
        </Pressable>
      </Animated.View>}
      {rest.length > 0 && <Surface layout={LAYOUT} style={{ paddingVertical: 2 }}>
        {rest.map((item, i) => <Row key={`${run}-${item.id}`} item={item} first={i === 0} index={i + 1} animate={animate} pinned={pins.includes(item.id)} onOpen={() => onOpen(item.patientId, item.open)}
          onPin={() => setPins(list => list.includes(item.id) ? list.filter(id => id !== item.id) : [item.id, ...list])}
          onSnooze={() => setSnoozed(list => [...list, item.id])} />)}
      </Surface>}
      {later.length > 0 && <Animated.View layout={LAYOUT} entering={FadeIn.duration(200)} style={{ gap: 6 }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showSnoozed }} onPress={() => setShowSnoozed(v => !v)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="moon.zzz" size={13} color={palette.muted} /><Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>Snoozed · {later.length}</Text>
        </Pressable>
        {showSnoozed && later.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Wake ${item.title}`} onPress={() => setSnoozed(list => list.filter(id => id !== item.id))} style={{ minHeight: 40, justifyContent: "center", paddingLeft: 20 }}>
          <Text style={{ ...type.footnote, color: palette.muted }}>{item.title} · <Text style={{ color: palette.blue }}>Wake</Text></Text>
        </Pressable>)}
      </Animated.View>}
      {!ordered.length && <Text style={{ ...type.callout, color: palette.muted, textAlign: "center", paddingVertical: 12 }}>Nothing scheduled this day.</Text>}
      <Text style={{ ...type.caption, color: palette.muted }}>{live ? "Ranked by urgency from the live backend’s synthetic records." : offset === 0 ? "Ranked by urgency, with the reason on every item. Demo rules over synthetic records." : "Synthetic clinic schedule for other days; open today's visits to act."}</Text>
    </Animated.View>}
  </View>;
}

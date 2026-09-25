import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Expand, Icon, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import type { Patient } from "@/features/encounter/types";
import { groupVisits, rankDay, type DayItem, type DayTone } from "./model";

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
const PX = 5; // points per minute: 30 minutes = 150 pt, room for a name pin
const PIN_MINUTES = 28; // a pin is about this many minutes wide; closer visits share one pin
const TONE_PIN = { done: { fill: "rgba(36,91,204,0.14)", ink: palette.blue }, open: { fill: "rgba(196,120,20,0.16)", ink: palette.amber } };
function TimeBar({ patients, now, onOpen }: { patients: Patient[]; now: number; onOpen: (patientId: string) => void }) {
  const { width } = useWindowDimensions();
  const { reducedMotion } = useAccessibleEffects();
  const view = width - 40;
  const from = (Math.floor(now / 60) - 1) * 60, to = from + 9 * 60;
  const xOf = (m: number) => (m - from) * PX;
  const visits = patients.map(p => { const [h, m] = p.time.split(":").map(Number); return { p, at: h! * 60 + m! }; }).sort((a, b) => a.at - b.at);
  // Anchors put a time 15% across the ruler, so now and the next visits fit; the view starts on now.
  const anchor = (m: number) => view * 0.15 - xOf(m);
  const stops = [anchor(now), ...groupVisits(visits, PIN_MINUTES).map(g => anchor(g[0]!.at))];
  const min = view - xOf(to), max = 0;
  const x = useSharedValue(anchor(now)), start = useSharedValue(0);
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
  return <View accessible={false} style={{ height: 112, overflow: "hidden", marginHorizontal: -4, borderRadius: 16 }}>
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ position: "absolute", left: 4, top: 0, bottom: 0, width: xOf(to) + 1 }, ruler]}>
        {ticks.map(m => { const hour = m % 60 === 0; return <View key={m} style={{ position: "absolute", left: xOf(m), bottom: 18, alignItems: "center", width: 1 }}>
          <View style={{ width: 1.5, height: hour ? 16 : m % 15 === 0 ? 10 : 6, borderRadius: 1, backgroundColor: hour ? "rgba(20,28,40,0.3)" : m % 15 === 0 ? "rgba(20,28,40,0.16)" : "rgba(20,28,40,0.08)" }} />
          {hour && <Text style={{ position: "absolute", top: 20, width: 40, textAlign: "center", fontSize: 10, fontWeight: "600", color: palette.muted, fontVariant: ["tabular-nums"] }}>{clock(m)}</Text>}
        </View>; })}
        {/* Now: a line through the ruler and a bubble above it. */}
        <View pointerEvents="none" style={{ position: "absolute", left: xOf(now) - 22, top: 4, width: 44, alignItems: "center" }}>
          <View style={{ paddingHorizontal: 7, height: 20, borderRadius: 10, justifyContent: "center", backgroundColor: palette.red }}><Text style={{ fontSize: 10, fontWeight: "700", color: palette.white, fontVariant: ["tabular-nums"] }}>{clock(now)}</Text></View>
          <View style={{ width: 2, height: 70, backgroundColor: palette.red, opacity: 0.7 }} />
        </View>
        {groupVisits(visits, PIN_MINUTES).map(group => { const first = group[0]!; const incomplete = group.some(v => v.p.incomplete); const tone = TONE_PIN[incomplete ? "open" : "done"];
          const single = group.length === 1;
          const label = single ? `${first.p.name}, ${first.p.time}, ${first.p.subtitle}` : `${group.length} patients from ${first.p.time}: ${group.map(v => v.p.name).join(", ")}`;
          return <Pressable key={first.p.id} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={single ? "Opens the visit" : "Lists these patients"} hitSlop={6}
            onPress={() => single ? onOpen(first.p.id) : router.push({ pathname: "/visits", params: { ids: group.map(v => v.p.id).join(",") } })}
            style={{ position: "absolute", left: xOf(first.at) - 16, top: 26, alignItems: "flex-start" }}>
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

export function MyDay({ patients, onOpen }: { patients: Patient[]; onOpen: (patientId: string, open: DayItem["open"]) => void }) {
  const { encounters } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const [now, setNow] = useState(nowMinutes);
  useEffect(() => { const timer = setInterval(() => setNow(nowMinutes()), 60_000); return () => clearInterval(timer); }, []);
  // First open sorts after the home greeting has settled; "Re-rank" replays it on demand.
  const [sorting, setSorting] = useState(!sortedOnce && !reducedMotion);
  const [animate, setAnimate] = useState(!sortedOnce && !reducedMotion);
  const [run, setRun] = useState(0);
  useEffect(() => { sortedOnce = true; if (!sorting) return; const timer = setTimeout(() => setSorting(false), run ? 1100 : 1700); return () => clearTimeout(timer); }, [sorting, run]);
  const rerank = () => { haptic(); setAnimate(!reducedMotion); setSorting(!reducedMotion); setRun(value => value + 1); };
  const [pins, setPins] = useState<string[]>([]);
  const [snoozed, setSnoozed] = useState<string[]>([]);
  const [showSnoozed, setShowSnoozed] = useState(false);

  const ranked = rankDay(patients, encounters, now);
  const active = ranked.filter(item => !snoozed.includes(item.id));
  const ordered = [...active.filter(item => pins.includes(item.id)), ...active.filter(item => !pins.includes(item.id))];
  const later = ranked.filter(item => snoozed.includes(item.id));
  const [top, ...rest] = ordered;

  return <View style={{ gap: 14 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: "600", color: palette.ink }}>Your day, ranked</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Re-rank my day" onPress={rerank} disabled={sorting} hitSlop={8}
        style={{ minHeight: 30, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, borderRadius: 15, backgroundColor: "rgba(20,28,40,0.06)", opacity: sorting ? 0.5 : 1 }}>
        <Icon name="sparkles" size={11} color={palette.ink} /><Text style={{ fontSize: 13, fontWeight: "600", color: palette.ink }}>Re-rank</Text>
      </Pressable>
    </View>
    <TimeBar patients={patients} now={now} onOpen={id => onOpen(id, {})} />
    {sorting ? <Sorting /> : <>
      {top && <Animated.View key={`top-${run}`} layout={LAYOUT} entering={animate ? riseIn({ distance: 14, scale: 0.97, duration: 450 }) : undefined}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Most urgent: ${top.title}. ${top.reason}`} accessibilityHint="Opens the visit" onPress={() => onOpen(top.patientId, top.open)}
          style={({ pressed }) => ({ transform: [{ scale: pressed && !reducedMotion ? 0.98 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
          <Surface feature style={{ padding: 18, gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: TONE[top.tone].dot }} />
              <Text style={{ ...type.overline, color: TONE[top.tone].ink }}>{pins.includes(top.id) ? "Pinned" : "Most urgent"}</Text>
            </View>
            <View style={{ gap: 4 }}>
              <Text style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{top.title}</Text>
              <Text style={{ ...type.callout, color: palette.muted }}>{top.detail}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flexShrink: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: TONE[top.tone].wash }}><Text style={{ ...type.caption, fontWeight: "600", color: TONE[top.tone].ink }}>{top.reason}</Text></View>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: palette.ink, alignItems: "center", justifyContent: "center" }}><Icon name="arrow.right" size={14} color={palette.white} /></View>
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
      <Text style={{ ...type.caption, color: palette.muted }}>Ranked by urgency, with the reason on every item. Demo rules over synthetic records.</Text>
    </>}
  </View>;
}

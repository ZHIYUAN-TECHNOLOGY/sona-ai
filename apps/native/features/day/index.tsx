import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Expand, Icon, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import type { Patient } from "@/features/encounter/types";
import { rankDay, type DayItem, type DayTone } from "./model";

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

/** Visits as blocks on a morning track with a "now" line. */
function TimeBar({ patients, now }: { patients: Patient[]; now: number }) {
  const from = 8 * 60, to = 13 * 60;
  const at = (m: number) => `${Math.min(100, Math.max(0, ((m - from) / (to - from)) * 100))}%` as const;
  return <View accessible accessibilityLabel={`Visits: ${patients.map(p => `${p.name} at ${p.time}`).join(", ")}`} style={{ gap: 6 }}>
    <View style={{ height: 28, borderRadius: 10, backgroundColor: "rgba(20,28,40,0.05)", overflow: "hidden" }}>
      {patients.map(p => { const [h, m] = p.time.split(":").map(Number); const start = h! * 60 + m!; return <View key={p.id}
        style={{ position: "absolute", top: 4, bottom: 4, left: at(start), width: `${(30 / (to - from)) * 100}%`, borderRadius: 7, backgroundColor: p.incomplete ? "rgba(196,120,20,0.35)" : "rgba(36,91,204,0.35)", justifyContent: "center", paddingLeft: 5 }}>
        <Text numberOfLines={1} style={{ fontSize: 10, fontWeight: "700", color: palette.ink }}>{p.initials}</Text>
      </View>; })}
      {now > from && now < to && <View style={{ position: "absolute", top: 0, bottom: 0, left: at(now), width: 2, backgroundColor: palette.red }} />}
    </View>
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>{[8, 9, 10, 11, 12, 13].map(h => <Text key={h} style={{ ...type.caption, fontSize: 10, color: palette.muted, fontVariant: ["tabular-nums"] }}>{String(h).padStart(2, "0")}:00</Text>)}</View>
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
    <TimeBar patients={patients} now={now} />
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

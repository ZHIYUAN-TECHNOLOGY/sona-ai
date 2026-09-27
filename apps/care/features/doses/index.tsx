import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, Text, type TextStyle, View } from "react-native";
import Animated, { Easing, FadeInDown, useReducedMotion, withSpring, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useDischarge } from "@/features/discharge/row";
import { consistency, nextLine, weekLine } from "@/features/home";
import { Sunbeam } from "@/lib/halftone";
import { palette } from "@/lib/theme";
import { HoldButton, pillStyle, surfaceStyle } from "@/lib/ui";
import { dosesToday, dueNow, early, nextDose, weekOf, type WeekDay } from "./model";

/**
 * Doses taken, kept on this phone (the dose key: medicine and due time), read through
 * useSyncExternalStore so React Compiler never caches a stale module read.
 * ponytail: phone-only and not per account; a server log lets the care team see adherence later.
 */
const KEY = "sona-care.doses.taken";
let taken: string[] = [];
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
SecureStore.getItemAsync(KEY).then(v => { if (v) { taken = [...new Set([...JSON.parse(v) as string[], ...taken])]; listeners.forEach(l => l()); } }).catch(() => {});

export function markTaken(key: string) {
  if (taken.includes(key)) return;
  taken = [...taken, key].slice(-40);
  listeners.forEach(l => l());
  SecureStore.setItemAsync(KEY, JSON.stringify(taken)).catch(() => {});
}

/** The clock, ticking every 30 seconds by default, so countdowns and "due now" move on their own. */
export function useNow(every = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), every); return () => clearInterval(id); }, [every]);
  return now;
}

/** The next dose from the discharge plan, or undefined (still in hospital, or nothing on a schedule), with the timed medicines and what is taken. */
export function useNextDose(now: Date) {
  const { data } = useDischarge();
  const done = useSyncExternalStore(subscribe, () => taken);
  if (data?.status !== "discharged") return { plan: data, dose: undefined, taken: done, meds: [] };
  const { medicines: m } = data, meds = [...m.new, ...m.changed, ...m.continue];
  return { plan: data, dose: nextDose(meds, data.dischargedAt, done, now), taken: done, meds };
}

export function useDoseNeeds() {
  const now = useNow();
  const { dose } = useNextDose(now);
  return dose && dueNow(dose.dueAt, now) ? 1 : 0;
}

/** A card's small grey title ("Today's medicines", "Consistency"). */
export const KICKER: TextStyle = { fontSize: 13, lineHeight: 18, fontWeight: "600", color: palette.muted };
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * A soft grey bento card on home (Lumi kit): the whole card is one labelled button, while a `footer`
 * control (the hold button) stays its own accessible element and `overlay` sits on top (the sunbeam).
 * `tall` cards grow to fill their column. It rises in `index` × 40 ms after the first; still under Reduce Motion.
 */
export function Tile({ label, onPress, children, footer, overlay, tall = false, index = 0 }: { label: string; onPress: () => void; children: React.ReactNode; footer?: React.ReactNode; overlay?: React.ReactNode; tall?: boolean; index?: number }) {
  const reduced = useReducedMotion();
  return <Animated.View entering={reduced ? undefined : FadeInDown.duration(320).delay(index * 40).easing(EASE_OUT)} style={{ flexGrow: tall ? 1 : 0 }}>
    <Pressable accessible={false} onPress={onPress}
      style={({ pressed }) => [surfaceStyle, { flexGrow: 1, minHeight: tall ? 220 : 150, padding: 16, gap: 12, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
      <View accessible accessibilityRole="button" accessibilityLabel={label} onAccessibilityTap={onPress} style={{ flexGrow: 1, justifyContent: "space-between", gap: 12 }}>{children}</View>
      {footer}
      {overlay}
    </Pressable>
  </Animated.View>;
}

/** The check springs in from 0.6 with a slight overshoot (the confirm spring), never from nothing. */
const badgeIn = () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ scale: 0.6 }] }, animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ scale: withSpring(1, { duration: 380, dampingRatio: 0.72 }) }] } };
};

/** One of today's doses: green with a white check once taken, grey until then. `pop` springs the check in (the one just logged). */
function DoseDot({ done, pop }: { done: boolean; pop: boolean }) {
  const box = { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" } as const;
  return done
    ? <Animated.View entering={pop ? badgeIn : undefined} style={[box, { backgroundColor: palette.green }]}>
      <Svg width={14} height={14} viewBox="0 0 24 24"><Path d="M20 6 9 17l-5-5" fill="none" stroke={palette.white} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /></Svg>
    </Animated.View>
    : <View style={[box, { backgroundColor: "#E4E6EE" }]} />;
}

/** The next dose as a white pill, on a one-second clock only in its last hour, so only this pill re-renders each tick. */
function NextPill({ dueAt, ticking }: { dueAt: Date; ticking: boolean }) {
  const now = useNow(ticking ? 1000 : 30_000);
  const n = nextLine(dueAt, now);
  return <View style={[pillStyle, { alignSelf: "flex-start", minHeight: 30, paddingHorizontal: 11, paddingVertical: 5, justifyContent: "center", backgroundColor: palette.white }]}>
    <Text style={{ fontSize: 12.5, lineHeight: 17, fontWeight: n.due ? "700" : "600", color: n.due ? palette.amber : palette.ink, fontVariant: ["tabular-nums"] }}>{n.text}</Text>
  </View>;
}

/**
 * Home's tall medicine card (Lumi kit frame 1): a circle per dose today, how many are taken, and the
 * next one in a pill (a live countdown in its last hour). Once a dose is within 2 h, a compact hold
 * logs it in place; its circle springs green and the sunbeam passes once. Tap opens /dose.
 */
export function MedsCard({ index }: { index: number }) {
  const now = useNow();
  const { plan, dose, taken: done, meds } = useNextDose(now);
  const reduced = useReducedMotion();
  const [took, setTook] = useState<{ key: string; name: string; at: Date }>();
  const today = plan?.status === "discharged" ? dosesToday(meds, plan.dischargedAt, done, now) : [];
  const count = today.filter(d => d.taken).length;
  // Just logged: the hold hides and the sunbeam holds until the next dose is itself due.
  const logged = took && !(dose && dueNow(dose.dueAt, now)) ? took : undefined;
  const take = () => { if (!dose) return; markTaken(dose.key); setTook({ key: dose.key, name: dose.name, at: new Date() }); };
  const next = dose && nextLine(dose.dueAt, now);
  const head = today.length ? `${count} of ${today.length} doses taken` : plan?.status === "discharged" ? "Nothing on a timer today" : "Once you're home";
  const all = today.length > 0 && count === today.length;
  return <Tile tall index={index} label={`Today's medicines. ${head}.${dose && next ? ` ${dose.name}, ${next.text}.` : ""} Open details`}
    onPress={() => router.push(dose || today.length ? "/dose" : "/discharge")}
    footer={dose && !logged && !early(dose.dueAt, now) && <HoldButton compact label="Hold · Taken" doneLabel={`${dose.name} taken`} onDone={take} />}
    overlay={logged && <Sunbeam play={logged.at.getTime()} radius={30} />}>
    <View style={{ gap: 12 }}>
      <Text style={KICKER}>Today's medicines</Text>
      {today.length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {today.map(d => <DoseDot key={d.key} done={d.taken} pop={!reduced && d.key === took?.key} />)}
      </View>}
    </View>
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 22, lineHeight: 27, fontWeight: "700", letterSpacing: -0.6, color: all ? palette.green : palette.ink }}>{head}</Text>
      {dose && next && <NextPill dueAt={dose.dueAt} ticking={next.ticking} />}
    </View>
  </Tile>;
}

const BAR: Record<WeekDay["state"], string> = { all: palette.blue, some: "#A9B6F9", none: "#E4E6EE", ahead: "#E4E6EE", free: "#E4E6EE" };
const SAYS: Record<WeekDay["state"], string> = { all: "all taken", some: "some taken", none: "missed", ahead: "still to come", free: "nothing due" };

/**
 * Home's short consistency card (Lumi kit's "rate"): the share of due doses taken this week, big, and a
 * thin bar per day since discharge (blue all taken, lighter some, grey none or not due). A missed dose
 * adds one amber line naming when. Tap opens /dose.
 */
export function ConsistencyCard({ index }: { index: number }) {
  const now = useNow();
  const { plan, taken: done, meds } = useNextDose(now);
  const out = plan?.status === "discharged" ? plan.dischargedAt : undefined;
  const pct = consistency(meds, out, done, now);
  const week = weekOf(meds, out, done, now);
  const line = weekLine(meds, out, done, now);
  const days = week.map((d, i) => `${i === week.length - 1 ? "today" : d.label} ${SAYS[d.state]}`).join(", ");
  return <Tile index={index} label={`Consistency. ${pct === undefined ? "Nothing due yet" : `${pct}% of doses taken this week. ${line.text}`}.${days ? ` By day: ${days}.` : ""} Open medicines`}
    onPress={() => router.push(out ? "/dose" : "/discharge")}>
    <Text style={KICKER}>Consistency</Text>
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 32, lineHeight: 38, fontWeight: "700", letterSpacing: -1.2, color: palette.ink, fontVariant: ["tabular-nums"] }}>
        {pct ?? "—"}{pct !== undefined && <Text style={{ fontSize: 17, fontWeight: "600", color: palette.muted }}> %</Text>}
      </Text>
      {line.tone === "amber" && <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: "600", color: palette.amber }}>{line.text}</Text>}
      {week.length > 0 && <View style={{ flexDirection: "row", gap: 5, height: 26 }}>
        {week.map((d, i) => <View key={i} style={{ flex: 1, maxWidth: 8, borderRadius: 4, backgroundColor: BAR[d.state] }} />)}
      </View>}
    </View>
  </Tile>;
}

export { Pill, tintOf } from "./pill";

import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, Text, type TextStyle, useWindowDimensions, View, type ViewStyle } from "react-native";
import Animated, { FadeIn, useReducedMotion, withSpring, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { useDischarge } from "@/features/discharge/row";
import { countdown, weekLine } from "@/features/home";
import { Sunbeam } from "@/lib/halftone";
import { palette, type } from "@/lib/theme";
import { Card, HoldButton, Section, surfaceStyle } from "@/lib/ui";
import { clock, dueNow, early, nextDose, weekOf, whenWords, type WeekDay } from "./model";

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

/** The check badge springs in from 0.6 with a slight overshoot (the confirm spring), never from nothing. */
const badgeIn = () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ scale: 0.6 }] }, animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ scale: withSpring(1, { duration: 380, dampingRatio: 0.72 }) }] } };
};

/** The last hour's mm:ss on its own one-second clock, so only this text re-renders each tick. */
function Ticking({ dueAt, style }: { dueAt: Date; style: TextStyle }) {
  const now = useNow(1000);
  return <Text style={style}>{countdown(dueAt, now).value}</Text>;
}

/**
 * Home's medicine card (reference kit): how long until the next dose, what it is and how to take it,
 * and a compact hold-to-confirm that logs it without leaving home. Once taken: a check, the time struck
 * through, when it was taken and the next dose named, with the sunbeam passing once. Tap opens /dose.
 */
export function DoseTile() {
  const now = useNow();
  const { plan, dose } = useNextDose(now);
  const reduced = useReducedMotion();
  const [took, setTook] = useState<{ name: string; dueAt: Date; at: Date }>();
  // The taken state holds until the next dose is itself due.
  const done = took && !(dose && dueNow(dose.dueAt, now)) ? took : undefined;
  const take = () => { if (!dose) return; markTaken(dose.key); setTook({ name: dose.name, dueAt: dose.dueAt, at: new Date() }); };
  const c = dose && countdown(dose.dueAt, now);
  const big: TextStyle = { fontSize: 32, lineHeight: 38, fontWeight: "700", letterSpacing: -1.2, color: palette.ink, fontVariant: ["tabular-nums"] };
  const line = done ? (dose ? `Next: ${dose.name} · ${whenWords(dose.dueAt, now)}` : "Nothing else on a timer")
    : dose ? `${dose.name} · ${dose.line}` : plan?.status === "discharged" ? "As needed · nothing on a timer" : "Once you're home";
  const label = done ? `${done.name} taken at ${clock(done.at)}. ${line}` : dose && c ? `Next medicine, ${dose.name} at ${clock(dose.dueAt)}. ${c.kicker}. ${dose.line}` : `Next medicine. ${line}`;
  return <Tile label={`${label}. Open details`} onPress={() => router.push(dose || done ? "/dose" : "/discharge")}
    // Taking it from home only once it is close (within 2 h); earlier, the card opens the dose screen, which asks quietly.
    footer={dose && !done && !early(dose.dueAt, now) && <HoldButton compact label="Hold · Taken" doneLabel={`${dose.name} taken`} onDone={take} />}
    overlay={done && <Sunbeam play={done.at.getTime()} radius={28} />}>
    {done
      ? <Animated.View entering={reduced ? FadeIn.duration(160) : badgeIn} style={{ width: 38, height: 38, borderRadius: 14, borderCurve: "continuous", backgroundColor: palette.green, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: palette.white, fontSize: 17, fontWeight: "700" }}>✓</Text>
      </Animated.View>
      : <View style={{ width: 38, height: 38, borderRadius: 14, borderCurve: "continuous", backgroundColor: palette.blueWash, alignItems: "center", justifyContent: "center" }}>
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={palette.blue} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Circle cx={12} cy={13} r={8} /><Path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3M6.38 18.7 4 21M17.64 18.67 20 21" />
        </Svg>
      </View>}
    <View style={{ gap: 2 }}>
      <Text style={{ fontSize: 12.5, lineHeight: 17, fontWeight: done || c?.due ? "700" : "500", color: done ? palette.green : c?.due ? palette.amber : palette.muted }}>{done ? `Taken at ${clock(done.at)}` : c ? c.kicker : "Next medicine"}</Text>
      {done ? <Text numberOfLines={1} adjustsFontSizeToFit style={{ ...big, color: palette.muted, textDecorationLine: "line-through" }}>{clock(done.dueAt)}</Text>
        : dose && c?.ticking ? <Ticking dueAt={dose.dueAt} style={big} />
          : <Text numberOfLines={1} adjustsFontSizeToFit style={big}>{c ? c.value : "—"}</Text>}
      <Text numberOfLines={3} style={{ ...type.footnote, color: palette.muted }}>{line}</Text>
    </View>
  </Tile>;
}

/**
 * A tall glass card for home's "Up next" pair: tapping anywhere opens it, while a `footer` control (the
 * hold button) stays its own accessible element; `overlay` sits on top (the sunbeam). It grows with
 * text, and at large Dynamic Type the pair wraps to one per row (the basis scales with the font).
 */
export function Tile({ label, onPress, children, footer, overlay }: { label: string; onPress: () => void; children: React.ReactNode; footer?: React.ReactNode; overlay?: React.ReactNode }) {
  const { fontScale } = useWindowDimensions();
  return <Pressable accessible={false} onPress={onPress}
    style={({ pressed }) => [surfaceStyle, { flexGrow: 1, flexBasis: 150 * fontScale, minHeight: 200, padding: 16, gap: 12, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
    <View accessible accessibilityRole="button" accessibilityLabel={label} onAccessibilityTap={onPress} style={{ flexGrow: 1, justifyContent: "space-between", gap: 12 }}>{children}</View>
    {footer}
    {overlay}
  </Pressable>;
}

const DOT: Record<WeekDay["state"], ViewStyle> = {
  all: { experimental_backgroundImage: "linear-gradient(135deg, #6FD0A8, #2E9C6E)" } as ViewStyle,
  some: { experimental_backgroundImage: `linear-gradient(90deg, ${palette.green} 50%, #EDEAF4 50%)` } as ViewStyle,
  none: { borderWidth: 2, borderColor: palette.amber },
  ahead: { borderWidth: 1.5, borderColor: "#CFCADC" },
  free: { backgroundColor: "#EDEAF4", opacity: 0.6 },
};
const SAYS: Record<WeekDay["state"], string> = { all: "all taken", some: "some taken", none: "missed", ahead: "still to come", free: "nothing due" };

/**
 * Home's quick review of the week: a dot per day since discharge (green all taken, half some, amber ring
 * missed, empty ring still to come) and one line. Hidden when nothing is on a timer.
 */
export function WeekCard({ also }: { also?: string }) {
  const now = useNow();
  const { plan, taken: done, meds } = useNextDose(now);
  if (plan?.status !== "discharged") return null;
  const week = weekOf(meds, plan.dischargedAt, done, now);
  if (week.every(d => d.state === "free")) return null;
  const line = weekLine(meds, plan.dischargedAt, done, now);
  return <>
    <Section light="This" bold="week" />
    <Card style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14, paddingVertical: 16 }}>
      <View accessible accessibilityLabel={`Doses by day: ${week.map((d, i) => `${i === week.length - 1 ? "today" : d.label} ${SAYS[d.state]}`).join(", ")}`} style={{ flexDirection: "row", gap: 6 }}>
        {week.map((d, i) => <View key={i} style={{ alignItems: "center", gap: 5 }}>
          <View style={[{ width: 18, height: 18, borderRadius: 9 }, DOT[d.state]]} />
          <Text style={{ fontSize: 10.5, fontWeight: "700", color: palette.muted }}>{d.label}</Text>
        </View>)}
      </View>
      <View style={{ flex: 1, minWidth: 140, gap: 2 }}>
        <Text style={{ ...type.body, fontWeight: "700", color: line.tone === "muted" ? palette.ink : palette[line.tone] }}>{line.text}</Text>
        {also && <Text style={{ ...type.footnote, color: palette.muted }}>{also}</Text>}
      </View>
    </Card>
  </>;
}

export { Pill, tintOf } from "./pill";

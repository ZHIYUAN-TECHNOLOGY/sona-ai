import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, type TextStyle, View } from "react-native";
import { Text } from "@/lib/text";
import Animated, { Easing, FadeInDown, useReducedMotion } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useDischarge } from "@/features/discharge/row";
import { doseStatus, sparkPath, weekLine } from "@/features/home";
import { Sunbeam } from "@/lib/halftone";
import { palette } from "@/lib/theme";
import { HoldButton, surfaceStyle } from "@/lib/ui";
import { clock, dueNow, early, nextDose, weekOf } from "./model";
import { Pill, tintOf } from "./pill";
import { now as clockNow, useClockOffset } from "@/lib/clock";
import { client } from "@/utils/orpc";

/**
 * Doses taken (the dose key: medicine and due time), kept on this phone so hold to take is instant
 * offline, and sent to the server (care.doses) so the care team sees adherence; the server's list is
 * merged back on join and after each live change. Read through useSyncExternalStore so React
 * Compiler never caches a stale module read.
 */
const KEY = "sona-care.doses.taken";
let taken: string[] = [];
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
SecureStore.getItemAsync(KEY).then(v => { if (v) { taken = [...new Set([...JSON.parse(v) as string[], ...taken])]; listeners.forEach(l => l()); } }).catch(() => {});

function keep(next: string[]) {
  taken = next.slice(-80);
  listeners.forEach(l => l());
  SecureStore.setItemAsync(KEY, JSON.stringify(taken)).catch(() => {});
}

export function markTaken(key: string) {
  if (taken.includes(key)) return;
  keep([...taken, key]);
  // ponytail: a dose taken offline stays on the phone until the next sync re-sends what the server lacks.
  void client.care.doses.take({ key }).catch(() => {});
}

/** Forgets this phone's taken doses (the account is not linked to a record, e.g. after the demo reset). */
export function clearTaken() { if (taken.length) keep([]); }

/** Merges the server's record into this phone's, and sends anything the server is missing (taken while offline). */
export async function syncTaken() {
  const server = await client.care.doses.list();
  const missing = taken.filter(k => !server.includes(k));
  await Promise.all(missing.map(key => client.care.doses.take({ key }).catch(() => {})));
  const merged = [...new Set([...taken, ...server])];
  if (merged.length !== taken.length) keep(merged);
}

/**
 * "Remind me later": the dose card steps aside until `until` (ms), in this app only (no notification
 * is scheduled, so the screen says it shows here again). Kept beside the taken log so every screen agrees.
 */
let snoozed: { key: string; until: number } | undefined;
export function snooze(next: typeof snoozed) {
  snoozed = next;
  listeners.forEach(l => l());
}
export const useSnooze = () => useSyncExternalStore(subscribe, () => snoozed);

/** The clock, ticking every 30 seconds by default, so countdowns and "due now" move on their own. */
/** The current time on the demo clock (see lib/clock), ticking every `every` ms and whenever the clock jumps. */
export function useNow(every = 30_000) {
  const offset = useClockOffset();
  const [now, setNow] = useState(clockNow);
  useEffect(() => { setNow(clockNow()); const id = setInterval(() => setNow(clockNow()), every); return () => clearInterval(id); }, [every, offset]);
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

/** A card's small grey title ("Next dose", "Recovery today"). */
export const KICKER: TextStyle = { fontSize: 13, lineHeight: 18, fontWeight: "500", color: palette.muted };
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** Home's cards rise in one after another, 40 ms apart (ease-out); still under Reduce Motion. */
export const rise = (reduced: boolean, index: number) => reduced ? undefined : FadeInDown.duration(320).delay(index * 40).easing(EASE_OUT);

/**
 * A white card on home (Life OS): the whole card is one labelled button, while a `footer` control (the
 * hold button) stays its own accessible element and `overlay` sits on top (the sunbeam). It grows to
 * fill its column, so two side by side match heights, and rises in `index` × 40 ms after the first.
 */
export function Tile({ label, onPress, children, footer, overlay, index = 0 }: { label: string; onPress: () => void; children: React.ReactNode; footer?: React.ReactNode; overlay?: React.ReactNode; index?: number }) {
  const reduced = useReducedMotion();
  return <Animated.View entering={rise(reduced, index)} style={{ flexGrow: 1 }}>
    <Pressable accessible={false} onPress={onPress}
      style={({ pressed }) => [surfaceStyle, { flexGrow: 1, minHeight: 150, padding: 16, gap: 12, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
      <View accessible accessibilityRole="button" accessibilityLabel={label} onAccessibilityTap={onPress} style={{ flexGrow: 1, justifyContent: "space-between", gap: 12 }}>{children}</View>
      {footer}
      {overlay}
    </Pressable>
  </Animated.View>;
}

/** A small rounded icon square tinted by what it stands for (Life OS), beside a card's title. */
export function IconTile({ bg, children }: { bg: string; children: React.ReactNode }) {
  return <View style={{ width: 36, height: 36, borderRadius: 11, borderCurve: "continuous", alignItems: "center", justifyContent: "center", backgroundColor: bg }}>{children}</View>;
}

const SPARK = { width: 96, height: 26 };
const PILL_ICON = "m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7ZM8.5 8.5l7 7";

/**
 * Home's next-dose card (Life OS "heart rate" position): the medicine's pill tile, the time big, its
 * name and how far off (amber within half an hour), and a 7-day sparkline of doses taken (violet, as
 * Medicines in Recovery today; a missed dose adds an amber line). Within 2 h a compact hold logs it in
 * place; then the hold hides and the sunbeam passes once. Tap opens /dose.
 */
export function DoseCard({ index }: { index: number }) {
  const now = useNow();
  const { plan, dose, taken: done, meds } = useNextDose(now);
  const [took, setTook] = useState<{ name: string; at: Date }>();
  // Just logged: the hold hides and the done line holds until the next dose is itself due.
  const logged = took && !(dose && dueNow(dose.dueAt, now)) ? took : undefined;
  const take = () => { if (!dose) return; markTaken(dose.key); setTook({ name: dose.name, at: clockNow() }); };
  const out = plan?.status === "discharged" ? plan.dischargedAt : undefined;
  const week = weekOf(meds, out, done, now), missed = weekLine(meds, out, done, now);
  const spark = sparkPath(week, SPARK.width, SPARK.height);
  const status = dose && doseStatus(dose.dueAt, now);
  const big = dose ? clock(dose.dueAt) : out ? "None" : "—";
  const small = dose ? dose.name : out ? "Nothing on a timer" : "Once you're home";
  return <Tile index={index} label={`Next dose. ${dose ? `${dose.name} at ${big}, ${status!.text}` : small}.${logged ? ` ${logged.name} taken.` : ""} This week: ${missed.text}. Open medicines`}
    onPress={() => router.push(out ? "/dose" : "/discharge")}
    footer={dose && !logged && !early(dose.dueAt, now) && <HoldButton compact label="Hold · Taken" doneLabel={`${dose.name} taken`} onDone={take} />}
    overlay={logged && <Sunbeam play={logged.at.getTime()} radius={22} />}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <IconTile bg={dose ? tintOf(dose.name) : palette.mutedWash}>
        {dose ? <Pill name={dose.name} size={32} /> : <Svg width={18} height={18} viewBox="0 0 24 24"><Path d={PILL_ICON} fill="none" stroke={palette.muted} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" /></Svg>}
      </IconTile>
      <Text style={KICKER}>Next dose</Text>
    </View>
    <View style={{ gap: 2 }}>
      <Text style={{ fontSize: 28, lineHeight: 34, fontWeight: "400", letterSpacing: -0.8, color: palette.ink, fontVariant: ["tabular-nums"] }}>{big}</Text>
      <Text numberOfLines={2} style={{ fontSize: 14, lineHeight: 19, fontWeight: "500", color: palette.ink }}>{small}</Text>
      {logged ? <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: "600", color: palette.green }}>✓ {logged.name} taken</Text>
        : status && <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: status.tone === "amber" ? "600" : "400", color: palette[status.tone] }}>{status.text}</Text>}
    </View>
    {spark && <View style={{ gap: 4 }}>
      <Svg width={SPARK.width} height={SPARK.height}><Path d={spark} fill="none" stroke={palette.feature} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>
      {missed.tone === "amber" && <Text style={{ fontSize: 12, lineHeight: 16, fontWeight: "600", color: palette.amber }}>{missed.text}</Text>}
    </View>}
  </Tile>;
}

export { Pill, tintOf };

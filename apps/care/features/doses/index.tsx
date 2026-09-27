import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Defs, Ellipse, G, Line, LinearGradient, Rect, Stop } from "react-native-svg";
import { useDischarge } from "@/features/discharge/row";
import { palette, type } from "@/lib/theme";
import { surfaceStyle } from "@/lib/ui";
import { clock, dueNow, nextDose, untilLine, whenWords } from "./model";

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

/** The clock, ticking every 30 seconds, so countdowns and "due now" move on their own. */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(id); }, []);
  return now;
}

/** The next dose from the discharge plan, or undefined (still in hospital, or nothing on a schedule). */
export function useNextDose(now: Date) {
  const { data } = useDischarge();
  const done = useSyncExternalStore(subscribe, () => taken);
  if (data?.status !== "discharged") return { plan: data, dose: undefined };
  const { medicines: m } = data;
  return { plan: data, dose: nextDose([...m.new, ...m.changed, ...m.continue], data.dischargedAt, done, now), taken: done };
}

export function useDoseNeeds() {
  const now = useNow();
  const { dose } = useNextDose(now);
  return dose && dueNow(dose.dueAt, now) ? 1 : 0;
}

/** Home's glance tile: when the next dose is, what it is, and how long until it; tap to take it. */
export function DoseTile() {
  const now = useNow();
  const { plan, dose } = useNextDose(now);
  const due = dose && dueNow(dose.dueAt, now);
  // A countdown only when it is close; further off, the day reads faster ("tomorrow").
  const when = dose && (dose.dueAt.getTime() - now.getTime() > 3 * 3600_000 ? whenWords(dose.dueAt, now).replace(` ${clock(dose.dueAt)}`, "") : untilLine(dose.dueAt, now));
  const [value, line] = dose ? [clock(dose.dueAt), `${dose.name} · ${when}`]
    : plan?.status === "discharged" ? ["As needed", "Nothing on a timer"] : ["—", "Once you're home"];
  return <Tile overline="Next medicine" value={value} line={line} tone={due ? "amber" : "muted"} icon={dose && <View style={{ width: 34, height: 34, borderRadius: 11, borderCurve: "continuous", backgroundColor: tintOf(dose.name), alignItems: "center", justifyContent: "center" }}><Pill name={dose.name} size={28} /></View>}
    label={dose ? `Next medicine, ${dose.name} at ${value}, ${when}` : `Next medicine. ${line}`}
    onPress={() => router.push(dose ? "/dose" : "/discharge")} />;
}

/** A small glass tile: an overline, one big value and one line of state (content surface, never the feature). */
export function Tile({ overline, value, line, tone = "muted", icon, label, onPress }: { overline: string; value: string; line: string; tone?: "muted" | "amber" | "red"; icon?: React.ReactNode; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={({ pressed }) => [surfaceStyle, { flex: 1, minHeight: 128, padding: 16, gap: 4, justifyContent: "space-between", transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", minHeight: 30 }}>
      <Text style={{ ...type.overline, color: palette.blue, flexShrink: 1 }}>{overline}</Text>
      {icon}
    </View>
    <View style={{ gap: 2 }}>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ ...type.title, fontWeight: "600", color: palette.ink, fontVariant: ["tabular-nums"] }}>{value}</Text>
      <Text numberOfLines={1} style={{ ...type.footnote, fontWeight: tone === "muted" ? "400" : "600", color: tone === "muted" ? palette.muted : palette[tone] }}>{line}</Text>
    </View>
  </Pressable>;
}

// Illustrative dosage forms (not a brand's pack or imprint), after the clinician app's medicine thumbnails.
const LOOKS: Record<string, { form: "tablet" | "caplet"; body: string; accent: string; tint: string }> = {
  Azithromycin: { form: "caplet", body: "#DCE8FB", accent: "#A9C2EC", tint: "rgba(36,91,204,0.10)" },
  Cetirizine: { form: "tablet", body: "#FFFFFF", accent: "#D7D2EE", tint: "rgba(110,80,210,0.10)" },
  Paracetamol: { form: "caplet", body: "#FFFFFF", accent: "#CDE3DF", tint: "rgba(20,140,130,0.10)" },
};
const fallback = LOOKS.Cetirizine!;
export const tintOf = (name: string) => (LOOKS[name] ?? fallback).tint;

/** A soft drawn pill: a shadow under a lit body with a score line. */
export function Pill({ name, size }: { name: string; size: number }) {
  const look = LOOKS[name] ?? fallback;
  return <Svg width={size} height={size} viewBox="0 0 44 44" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Defs>
      <LinearGradient id="lit" x1="0" y1="0" x2="0.3" y2="1">
        <Stop offset="0" stopColor="#FFFFFF" />
        <Stop offset="1" stopColor={look.body} />
      </LinearGradient>
    </Defs>
    <Ellipse cx={22} cy={38} rx={11} ry={2.2} fill="rgba(40,70,140,0.12)" />
    {look.form === "tablet"
      ? <G>
        <Ellipse cx={22} cy={24} rx={13} ry={11} fill={look.accent} />
        <Ellipse cx={22} cy={21.5} rx={13} ry={10.5} fill="url(#lit)" stroke="rgba(20,28,40,0.08)" strokeWidth={0.6} />
        <Line x1={22} y1={14} x2={22} y2={29} stroke={look.accent} strokeWidth={1.2} strokeLinecap="round" />
      </G>
      : <G rotation={-28} origin="22, 22">
        <Rect x={6} y={18} width={32} height={13} rx={6.5} fill={look.accent} />
        <Rect x={6} y={15} width={32} height={13} rx={6.5} fill="url(#lit)" stroke="rgba(20,28,40,0.08)" strokeWidth={0.6} />
        <Line x1={22} y1={17.5} x2={22} y2={25.5} stroke={look.accent} strokeWidth={1.2} strokeLinecap="round" />
      </G>}
  </Svg>;
}

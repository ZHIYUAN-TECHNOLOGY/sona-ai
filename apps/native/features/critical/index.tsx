import { elapsed } from "@sona-ai/domain/critical";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Pressable, View } from "react-native";
import Animated, { FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { useAccessibleEffects } from "@/components/sona/ui";
import { api, errorText, useLive } from "@/features/live";
import { LockedAction, useRole } from "@/features/live/roles";
import { acknowledgeResult, refreshServerData, useServerData } from "@/features/live/server-day";

/*
 * Critical result alert (after Qure's qER pattern): a value past the lab's call-now limit drops a
 * banner over whatever screen is open, with a clock running since it arrived, until someone
 * acknowledges it. Live mode polls the server's results; fixture mode uses a local stand-in.
 * ponytail: in-app only; a push to a locked phone needs expo-notifications and a development build.
 */
type Critical = { id: string; patientName: string; test: string; value: string; unit?: string | null; flag: string; receivedAt: Date };

// Fixture mode's one simulated critical result.
let local: Critical | undefined;
const listeners = new Set<() => void>();
const setLocal = (next: Critical | undefined) => { local = next; listeners.forEach(l => l()); };

/** The demo's lab feed: Daniel's potassium comes back at 2.6 mmol/L. */
export async function simulateCriticalResult(live: boolean) {
  const result = { patientId: "SYN-1086", test: "Potassium", value: "2.6", unit: "mmol/L" };
  if (!live) { setLocal({ id: "local-critical", patientName: "Daniel Rahman", ...result, flag: "critical low", receivedAt: new Date() }); return; }
  await api.results.receive(result);
  await refreshServerData();
}

// Live updates push new results; this slow check is only the safety net.
const POLL_MS = 60_000;

export function CriticalAlert() {
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibleEffects();
  const { on: live } = useLive();
  const server = useServerData();
  const fixture = useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => local);
  // Live: a slow safety check; new results normally arrive over live updates.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => { void refreshServerData().catch(() => {}); }, POLL_MS);
    return () => clearInterval(timer);
  }, [live]);
  const waiting: Critical | undefined = live
    ? server?.results.filter(r => r.critical && !r.acknowledgedAt).map(r => ({ ...r, flag: r.flag ?? "critical", receivedAt: new Date(r.receivedAt) }))[0]
    : fixture;

  const [now, setNow] = useState(() => new Date());
  const [done, setDone] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const canAck = useRole().can("results.acknowledge");
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [waiting?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // One warning buzz and one announcement per result, when it lands.
  const seen = useRef<string>(undefined);
  useEffect(() => {
    if (!waiting || seen.current === waiting.id) return;
    seen.current = waiting.id;
    if (process.env.EXPO_OS === "ios") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    AccessibilityInfo.announceForAccessibility(`Critical result: ${waiting.test} ${waiting.value} for ${waiting.patientName}`);
  }, [waiting?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!done) return; const timer = setTimeout(() => setDone(undefined), 2600); return () => clearTimeout(timer); }, [done]);

  const acknowledge = async () => {
    if (!waiting || busy) return;
    setBusy(true); setError(undefined);
    const took = elapsed(waiting.receivedAt, new Date());
    try {
      if (live) await acknowledgeResult(waiting.id); else setLocal(undefined);
      if (process.env.EXPO_OS === "ios") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDone(`Acknowledged after ${took} · recorded in handover`);
    } catch (e) { setError(`Not acknowledged: ${errorText(e)}`); }
    finally { setBusy(false); }
  };

  if (!waiting && !done) return null;
  const top = insets.top + 6;
  return <Animated.View key={waiting?.id ?? "done"} entering={reducedMotion ? undefined : riseIn({ distance: -18, duration: 320 })} exiting={FadeOut.duration(180)}
    accessibilityLiveRegion="assertive" style={{ position: "absolute", top, left: 12, right: 12, zIndex: 100, borderRadius: 22, borderCurve: "continuous", padding: 14, gap: 10,
      backgroundColor: "rgba(255,255,255,0.97)", borderWidth: 1, borderColor: waiting ? "rgba(162,62,62,0.35)" : "rgba(15,110,102,0.3)", boxShadow: "0 12px 32px rgba(24,32,48,0.18)" }}>
    {waiting ? <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.red }} />
        <Text style={{ ...type.overline, color: palette.red, flex: 1 }}>Critical result · {waiting.flag.replace("critical ", "")}</Text>
        <Text accessibilityLabel={`Waiting ${elapsed(waiting.receivedAt, now)}`} style={{ fontSize: 15, fontWeight: "700", color: palette.red, fontVariant: ["tabular-nums"] }}>{elapsed(waiting.receivedAt, now)}</Text>
      </View>
      <Text selectable style={{ ...type.headline, color: palette.ink }}>{waiting.test} {waiting.value}{waiting.unit ? ` ${waiting.unit}` : ""} · {waiting.patientName}</Text>
      {!canAck ? <LockedAction label="Needs a doctor to acknowledge" path="results.acknowledge" height={44} /> : <Pressable accessibilityRole="button" accessibilityLabel={error ? `Retry acknowledging ${waiting.test} for ${waiting.patientName}` : `Acknowledge ${waiting.test} for ${waiting.patientName}`} disabled={busy} onPress={acknowledge}
        style={({ pressed }) => ({ minHeight: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.red, opacity: busy ? 0.6 : 1, transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: ["transform", "opacity"], transitionDuration: 120 } as never)}>
        <Text style={{ fontSize: 15, fontWeight: "600", color: palette.white }}>{busy ? "Acknowledging…" : error ? "Retry acknowledge" : "Acknowledge"}</Text>
      </Pressable>}
      {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
    </> : <Text selectable style={{ ...type.subhead, fontWeight: "600", color: "#0F6E66" }}>{done}</Text>}
  </Animated.View>;
}

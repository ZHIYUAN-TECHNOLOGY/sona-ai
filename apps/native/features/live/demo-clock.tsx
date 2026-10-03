import { PressScale } from "@/components/sona/parts";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ActionSheetIOS, Alert, Pressable, View } from "react-native";
import { Action, Body, Card, Notice } from "@/components/sona/ui";
import { api, errorText, useLive } from ".";
import { useLiveChanges } from "./channel";
import { calendarDays, demoLine, hospitalTime } from "./day";

/**
 * The demo clock (live mode, synthetic demo hospital): jumps the server's time for the whole hospital
 * to the first or second check-in (day 2 and day 7 unless the doctor chose others) or the clinic review, counted from the latest discharge, and back to
 * real time. Every connected app re-reads, so the patient's Sona Care shows the check-in as it lands.
 */
type Status = Awaited<ReturnType<typeof api.demo.status>>;
const JUMPS = [["now", "Real time"], ["day-1", "Day 1 morning dose"], ["day-2", "Day 2 check-in"], ["day-7", "Day 7 check-in"], ["visit", "Clinic review day"]] as const;
type Jump = (typeof JUMPS)[number][0];
/** "day-2" and "day-7" land on the first and second check-in days chosen at discharge; label them with those days. */
const labelled = (status?: Status) => JUMPS.map(([to, label]) => {
  const day = to === "day-2" ? status?.checkInDays[0] : to === "day-7" ? status?.checkInDays[1] : undefined;
  return [to, day ? `Day ${day} check-in` : label] as const;
});

// The clock, held once for every screen that shows it (Today's date and pill, Settings' card): one read in flight serves them all.
let held: Status | undefined, reading: Promise<Status> | undefined;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const keep = (next: Status) => { held = next; listeners.forEach(l => l()); return next; };
const readStatus = () => reading ??= api.demo.status().then(keep).finally(() => { reading = undefined; });
const jumpTo = (to: Jump) => api.demo.jump({ to }).then(keep);

/** The clock in live mode (undefined until read, or when off), read on mount and on any "day" change: a jump announces one. */
function useDemoStatus(onError?: (e: unknown) => void) {
  const { on } = useLive();
  const status = useSyncExternalStore(subscribe, () => held);
  const read = () => { if (on) void readStatus().catch(e => onError?.(e)); };
  useEffect(read, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveChanges(["day"], read);
  return on ? status : undefined;
}

/** How far the hospital's demo clock runs ahead of real time in live mode (0 otherwise). The phone's time plus this is "now" in both apps. */
export const useDemoOffset = () => useDemoStatus()?.offsetMs ?? 0;

export function DemoClockCard() {
  const { on } = useLive();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const status = useDemoStatus(e => setError(errorText(e)));
  // Ticks from the offset, so the card keeps the demo's time while it stays open.
  const [at, setAt] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setAt(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  if (!on) return null;
  const jump = (to: Jump) => {
    setBusy(to); setError(undefined);
    void jumpTo(to).catch(e => setError(errorText(e))).finally(() => setBusy(undefined));
  };
  const now = new Date(at + (status?.offsetMs ?? 0));
  const days = status?.dischargedAt ? calendarDays(status.dischargedAt, now) : undefined;
  return <Card label="Demo" title="Demo clock">
    <Body>{status ? `${hospitalTime(now)}${status.offsetMs ? ` · demo time${days !== undefined ? `, day ${days} after discharge` : ""}` : " · real time"}` : "Reading the clock…"}</Body>
    <View style={{ gap: 8 }}>
      {labelled(status).map(([to, label]) => <Action key={to} label={busy === to ? "Moving…" : label} secondary={to !== "day-2"}
        disabled={Boolean(busy) || !status?.available.includes(to)} onPress={() => jump(to)} />)}
    </View>
    <Body muted>Moves the server's time for the demo hospital only, then sends any check-in now due. Sona Care follows at once. Discharge a patient first; the jumps count from their discharge.</Body>
    {error && <Notice warning>{error}</Notice>}
  </Card>;
}

/**
 * My Day's demo clock, one tap away: a small pill with the time both apps are on at `now` ("Demo time · Wed
 * 30 Sep at 10:02 · day 2 after discharge", or "Demo clock · real time"), which opens the jumps as an
 * action sheet. Live mode only; real clinic appointments stay on today's list.
 */
export function DemoTimeLine({ now }: { now: Date }) {
  const status = useDemoStatus();
  const [error, setError] = useState<string>();
  if (!status) return null;
  const label = demoLine(status, now);
  const choices = labelled(status).filter(([to]) => status.available.includes(to));
  const jump = (to: Jump) => { setError(undefined); void jumpTo(to).catch(e => setError(errorText(e))); };
  const open = () => {
    if (process.env.EXPO_OS === "ios") ActionSheetIOS.showActionSheetWithOptions(
      { title: "Demo clock", message: "Moves the demo hospital's time; Sona Care follows at once.", options: [...choices.map(([, l]) => l), "Cancel"], cancelButtonIndex: choices.length },
      i => { if (i < choices.length) jump(choices[i]![0]); });
    else Alert.alert("Demo clock", undefined, [...choices.map(([to, l]) => ({ text: l, onPress: () => jump(to) })), { text: "Cancel", style: "cancel" as const }]);
  };
  return <View style={{ gap: 4 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}. Change the demo clock`} onPress={open}
      style={{ alignSelf: "flex-start" }}>{({ pressed }) => <PressScale pressed={pressed} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: status.offsetMs ? "rgba(125,82,244,0.12)" : "rgba(20,28,40,0.05)" }}>
      <Body>{`${label}  ›`}</Body>
    </PressScale>}</Pressable>
    {error && <Notice warning>{error}</Notice>}
  </View>;
}

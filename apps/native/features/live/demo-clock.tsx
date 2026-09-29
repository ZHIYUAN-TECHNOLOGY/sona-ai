import { useCallback, useEffect, useState } from "react";
import { ActionSheetIOS, Alert, Pressable, View } from "react-native";
import { Action, Body, Card, Notice } from "@/components/sona/ui";
import { api, errorText, useLive } from ".";
import { useLiveChanges } from "./channel";

/**
 * The demo clock (live mode, synthetic demo hospital): jumps the server's time for the whole hospital
 * to the first or second check-in (day 2 and day 7 unless the doctor chose others) or the clinic review, counted from the latest discharge, and back to
 * real time. Every connected app re-reads, so the patient's Sona Care shows the check-in as it lands.
 */
type Status = Awaited<ReturnType<typeof api.demo.status>>;
const JUMPS = [["now", "Real time"], ["day-1", "Day 1 morning dose"], ["day-2", "Day 2 check-in"], ["day-7", "Day 7 check-in"], ["visit", "Clinic review day"]] as const;
/** "day-2" and "day-7" land on the first and second check-in days chosen at discharge; label them with those days. */
const labelled = (status?: Status) => JUMPS.map(([to, label]) => {
  const day = to === "day-2" ? status?.checkInDays[0] : to === "day-7" ? status?.checkInDays[1] : undefined;
  return [to, day ? `Day ${day} check-in` : label] as const;
});
const when = (d: Date) => new Date(d).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });
const DAY = 86_400_000;
/** Days since discharge counted on calendar days in Kuala Lumpur (discharge day is day 0), as Sona Care and the check-ins count them. */
const calendarDays = (from: Date | string, to: Date | string) => {
  const day = (d: Date | string) => Math.floor((new Date(d).getTime() + 8 * 3600_000) / DAY);
  return day(to) - day(from);
};

export function DemoClockCard() {
  const { on } = useLive();
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const read = useCallback(() => { void api.demo.status().then(setStatus, e => setError(errorText(e))); }, []);
  useEffect(() => { if (on) read(); }, [on, read]);
  useLiveChanges(["day"], read);
  if (!on) return null;
  const jump = (to: (typeof JUMPS)[number][0]) => {
    setBusy(to); setError(undefined);
    void api.demo.jump({ to }).then(setStatus, e => setError(errorText(e))).finally(() => setBusy(undefined));
  };
  const days = status?.dischargedAt ? calendarDays(status.dischargedAt, status.now) : undefined;
  return <Card label="Demo" title="Demo clock">
    <Body>{status ? `${when(status.now)}${status.offsetMs ? ` · demo time${days !== undefined ? `, day ${days} after discharge` : ""}` : " · real time"}` : "Reading the clock…"}</Body>
    <View style={{ gap: 8 }}>
      {labelled(status).map(([to, label]) => <Action key={to} label={busy === to ? "Moving…" : label} secondary={to !== "day-2"}
        disabled={Boolean(busy) || !status?.available.includes(to)} onPress={() => jump(to)} />)}
    </View>
    <Body muted>Moves the server's time for the demo hospital only, then sends any check-in now due. Sona Care follows at once. Discharge a patient first; the jumps count from their discharge.</Body>
    {error && <Notice warning>{error}</Notice>}
  </Card>;
}

/**
 * My Day's demo clock, one tap away: a small pill with the time both apps are on ("Demo time · Wed
 * 30 Sep at 10:02 · day 2 after discharge", or "Demo clock · real time"), which opens the jumps as an
 * action sheet. Live mode only; real clinic appointments stay on today's list.
 */
export function DemoTimeLine() {
  const { on } = useLive();
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState<string>();
  const read = useCallback(() => { void api.demo.status().then(setStatus, () => {}); }, []);
  useEffect(() => { if (on) read(); }, [on, read]);
  useLiveChanges(["day"], read);
  if (!on || !status) return null;
  const days = status.dischargedAt ? calendarDays(status.dischargedAt, status.now) : undefined;
  const label = status.offsetMs ? `Demo time · ${when(status.now)}${days !== undefined ? ` · day ${days} after discharge` : ""}` : "Demo clock · real time";
  const choices = labelled(status).filter(([to]) => status.available.includes(to));
  const jump = (to: (typeof JUMPS)[number][0]) => { setError(undefined); void api.demo.jump({ to }).then(setStatus, e => setError(errorText(e))); };
  const open = () => {
    if (process.env.EXPO_OS === "ios") ActionSheetIOS.showActionSheetWithOptions(
      { title: "Demo clock", message: "Moves the demo hospital's time; Sona Care follows at once.", options: [...choices.map(([, l]) => l), "Cancel"], cancelButtonIndex: choices.length },
      i => { if (i < choices.length) jump(choices[i]![0]); });
    else Alert.alert("Demo clock", undefined, [...choices.map(([to, l]) => ({ text: l, onPress: () => jump(to) })), { text: "Cancel", style: "cancel" as const }]);
  };
  return <View style={{ gap: 4 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}. Change the demo clock`} onPress={open}
      style={({ pressed }) => ({ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: status.offsetMs ? "rgba(125,82,244,0.12)" : "rgba(20,28,40,0.05)", opacity: pressed ? 0.7 : 1 })}>
      <Body>{`${label}  ›`}</Body>
    </Pressable>
    {error && <Notice warning>{error}</Notice>}
  </View>;
}

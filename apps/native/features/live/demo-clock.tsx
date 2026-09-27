import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Action, Body, Card, Notice } from "@/components/sona/ui";
import { api, errorText, useLive } from ".";
import { useLiveChanges } from "./channel";

/**
 * The demo clock (live mode, synthetic demo hospital): jumps the server's time for the whole hospital
 * to the day-2 check-in, day 7 or the clinic review, counted from the latest discharge, and back to
 * real time. Every connected app re-reads, so the patient's Sona Care shows the check-in as it lands.
 */
type Status = Awaited<ReturnType<typeof api.demo.status>>;
const JUMPS = [["now", "Real time"], ["day-2", "Day 2 check-in"], ["day-7", "Day 7 check-in"], ["visit", "Clinic review day"]] as const;
const when = (d: Date) => new Date(d).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });
const DAY = 86_400_000;

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
  const days = status?.dischargedAt ? Math.floor((new Date(status.now).getTime() - new Date(status.dischargedAt).getTime()) / DAY) : undefined;
  return <Card label="Demo" title="Demo clock">
    <Body>{status ? `${when(status.now)}${status.offsetMs ? ` · demo time${days !== undefined ? `, day ${days} after discharge` : ""}` : " · real time"}` : "Reading the clock…"}</Body>
    <View style={{ gap: 8 }}>
      {JUMPS.map(([to, label]) => <Action key={to} label={busy === to ? "Moving…" : label} secondary={to !== "day-2"}
        disabled={Boolean(busy) || !status?.available.includes(to)} onPress={() => jump(to)} />)}
    </View>
    <Body muted>Moves the server's time for the demo hospital only, then sends any check-in now due. Sona Care follows at once. Discharge a patient first; the jumps count from their discharge.</Body>
    {error && <Notice warning>{error}</Notice>}
  </Card>;
}

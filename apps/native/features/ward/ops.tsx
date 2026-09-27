import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { api, useLive } from "@/features/live";
import { useLiveChanges } from "@/features/live/channel";

/**
 * The ops counter (live mode): this week's numbers for ward and hospital management, counted by the
 * server from the loops' own rows (ops.get), and re-read whenever a discharge, check-in, finding or
 * dose changes, so they tick up during the demo. Lost follow-ups turn amber above zero.
 */
type Ops = Awaited<ReturnType<typeof api.ops.get>>;
const TEAL = "#0F6E66";

export const hoursMinutes = (mins: number) => {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h ? `${h} h${m ? ` ${m} m` : ""}` : `${m} m`;
};

export function OpsStrip() {
  const { on } = useLive();
  const [ops, setOps] = useState<Ops>();
  const read = useCallback(() => { void api.ops.get().then(setOps, () => {}); }, []);
  useEffect(() => { if (on) read(); }, [on, read]);
  useLiveChanges(["ward", "day", "checkIns", "findings"], read);
  if (!on || !ops) return null;
  const tiles: { value: string; label: string; tone?: "good" | "warn" }[] = [
    { value: hoursMinutes(ops.bedMinutesSaved), label: `bed time saved · ${ops.discharges} discharge${ops.discharges === 1 ? "" : "s"}`, tone: ops.bedMinutesSaved ? "good" : undefined },
    { value: `${ops.redFlagsActedOn} of ${ops.redFlags}`, label: "red flags acted on", tone: ops.redFlags && ops.redFlagsActedOn < ops.redFlags ? "warn" : ops.redFlags ? "good" : undefined },
    { value: ops.medianMinutesToBook === null ? "–" : hoursMinutes(ops.medianMinutesToBook), label: "flag → booked (median)" },
    { value: `${ops.checkInsAnswered} of ${ops.checkInsSent}`, label: "check-ins answered" },
    { value: `${ops.lostFollowUps}`, label: `lost X-ray follow-ups · ${ops.trackedFollowUps} tracked`, tone: ops.lostFollowUps ? "warn" : "good" },
    { value: ops.dosesDue ? `${Math.round((ops.dosesTaken / ops.dosesDue) * 100)}%` : "–", label: "doses taken (Sona Care)" },
  ];
  return <View accessible accessibilityLabel={`This week. ${tiles.map(t => `${t.value} ${t.label}`).join(". ")}.`} style={{ gap: 8 }}>
    <Text style={{ ...type.overline, color: palette.blue }}>This week · counted from records</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {tiles.map(t => <View key={t.label} style={{ flexBasis: "31%", flexGrow: 1, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 16, borderCurve: "continuous",
        backgroundColor: t.tone === "warn" ? "rgba(196,120,20,0.1)" : t.tone === "good" ? "rgba(15,110,102,0.08)" : "rgba(20,28,40,0.04)" }}>
        <Text style={{ fontSize: 19, fontWeight: "700", color: t.tone === "warn" ? palette.amber : t.tone === "good" ? TEAL : palette.ink, fontVariant: ["tabular-nums"] }}>{t.value}</Text>
        <Text numberOfLines={2} style={{ ...type.caption, color: palette.muted }}>{t.label}</Text>
      </View>)}
    </View>
  </View>;
}

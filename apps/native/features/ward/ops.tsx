import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Icon, Surface } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import { api, useLive } from "@/features/live";
import { useLiveChanges } from "@/features/live/channel";
import { useFindings } from "@/features/live/findings-sync";
import { useServerBeds } from "@/features/live/ward-sync";
import { wardBeds, wardSummary } from "./model";

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

/** The ward at a glance: beds, fit to go, blocked (amber above zero) and bed-hours lost waiting. */
export function WardTiles({ summary }: { summary: ReturnType<typeof wardSummary> }) {
  return <View style={{ flexDirection: "row", gap: 8 }}>
    {([[`${summary.beds}`, "beds"], [`${summary.fit}`, "fit to go"], [`${summary.blocked}`, "blocked"], [`~${summary.bedHours}`, "bed-hours"]] as const).map(([n, label], i) =>
      <View key={label} style={{ flex: 1, paddingVertical: 10, borderRadius: 16, borderCurve: "continuous", alignItems: "center", backgroundColor: i === 2 && summary.blocked ? "rgba(196,120,20,0.1)" : "rgba(20,28,40,0.04)" }}>
        <Text style={{ fontSize: 20, fontWeight: "700", color: i === 2 && summary.blocked ? palette.amber : palette.ink, fontVariant: ["tabular-nums"] }}>{n}</Text>
        <Text style={{ ...type.caption, color: palette.muted }}>{label}</Text>
      </View>)}
  </View>;
}

/**
 * Management's My Day lead (instead of clinical tasks): one line on where the ward stands, the ward
 * tiles, this week's ops counter, and one tap to the ward to act on it.
 */
export function WardGlance() {
  const { patients, encounters } = useEncounter();
  const { findings } = useFindings();
  const summary = wardSummary(useServerBeds(findings) ?? wardBeds(patients, encounters));
  return <Surface feature style={{ padding: 16, gap: 14 }}>
    <View style={{ gap: 4 }}>
      <Text style={{ ...type.overline, color: summary.blocked ? palette.amber : palette.blue }}>Ward now</Text>
      <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{summary.blocked ? `${summary.blocked} discharge${summary.blocked === 1 ? "" : "s"} blocked · ~${summary.bedHours} bed-hours` : `${summary.fit} fit to go · nothing blocked`}</Text>
    </View>
    <WardTiles summary={summary} />
    <OpsStrip />
    <Pressable accessibilityRole="button" accessibilityLabel="Open the ward" onPress={() => router.push("/ward")}
      style={({ pressed }) => ({ height: 48, borderRadius: 24, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: palette.ink, opacity: pressed ? 0.85 : 1 })}>
      <Text style={{ fontSize: 15, fontWeight: "600", color: palette.white }}>Open the ward</Text><Icon name="arrow.right" size={13} color={palette.white} />
    </Pressable>
  </Surface>;
}

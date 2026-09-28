import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Expand, Icon, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import { api, useLive } from "@/features/live";
import { useLiveChanges } from "@/features/live/channel";
import { useFindings } from "@/features/live/findings-sync";
import { useServerBeds } from "@/features/live/ward-sync";
import { bedBar, wardBeds, wardSummary, type Bed, type BedKind } from "./model";

/*
 * Ward summary, minimal (after 60fps "Ultrahuman Positive Recovery Text Animation",
 * https://60fps.design/shots/ultrahuman-positive-recovery-text-animation): one headline, one range
 * bar of the beds, and the week's detail revealed on demand with a staggered fade/slide-up.
 *
 * The ops counter (live mode): this week's numbers for ward and hospital management, counted by the
 * server from the loops' own rows (ops.get), and re-read whenever a discharge, check-in, finding or
 * dose changes, so they tick up during the demo. Lost follow-ups turn amber above zero.
 */
type Ops = Awaited<ReturnType<typeof api.ops.get>>;
const TEAL = "#0F6E66";
const KIND: Record<BedKind, string> = { blocked: palette.amber, fit: TEAL, watch: "#D9AE72", other: "#CDD2D9" };

export const hoursMinutes = (mins: number) => {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h ? `${h} h${m ? ` ${m} m` : ""}` : `${m} m`;
};

/** One segment per bed, coloured by what it needs; the segments grow in on mount (static under Reduce Motion). */
export function BedBar({ beds }: { beds: Bed[] }) {
  const { reducedMotion } = useAccessibleEffects();
  const { segments, legend, label } = bedBar(beds);
  return <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ gap: 10 }}>
    <View style={{ flexDirection: "row", gap: 3, height: 11 }}>
      {segments.map((k, i) => <Animated.View key={i} entering={reducedMotion ? undefined : riseIn({ delay: i * 35, distance: 4, scale: 0.5, duration: 320 })}
        style={{ flex: 1, borderRadius: 5.5, borderCurve: "continuous", backgroundColor: KIND[k] }} />)}
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 }}>
      {legend.map(l => <View key={l.kind} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: KIND[l.kind] }} />
        <Text style={{ ...type.footnote, color: palette.muted }}><Text style={{ fontWeight: "700", color: palette.ink, fontVariant: ["tabular-nums"] }}>{l.count}</Text> {l.label}</Text>
      </View>)}
    </View>
  </View>;
}

/** This week, collapsed to its one number (bed time saved); the six ops stats open as a quiet list. */
export function ThisWeek() {
  const { on } = useLive();
  const { reducedMotion } = useAccessibleEffects();
  const [ops, setOps] = useState<Ops>();
  const [open, setOpen] = useState(false);
  const read = useCallback(() => { void api.ops.get().then(setOps, () => {}); }, []);
  useEffect(() => { if (on) read(); }, [on, read]);
  useLiveChanges(["ward", "day", "checkIns", "findings"], read);
  if (!on || !ops) return null;
  const rows: { value: string; label: string; tone?: "good" | "warn" }[] = [
    { value: hoursMinutes(ops.bedMinutesSaved), label: `Bed time saved · ${ops.discharges} discharge${ops.discharges === 1 ? "" : "s"}`, tone: ops.bedMinutesSaved ? "good" : undefined },
    { value: `${ops.redFlagsActedOn} of ${ops.redFlags}`, label: "Red flags acted on", tone: ops.redFlags && ops.redFlagsActedOn < ops.redFlags ? "warn" : ops.redFlags ? "good" : undefined },
    { value: ops.medianMinutesToBook === null ? "–" : hoursMinutes(ops.medianMinutesToBook), label: "Flag → booked (median)" },
    { value: `${ops.checkInsAnswered} of ${ops.checkInsSent}`, label: "Check-ins answered" },
    { value: `${ops.lostFollowUps}`, label: `Lost X-ray follow-ups · ${ops.trackedFollowUps} tracked`, tone: ops.lostFollowUps ? "warn" : "good" },
    { value: ops.dosesDue ? `${Math.round((ops.dosesTaken / ops.dosesDue) * 100)}%` : "–", label: "Doses taken (Sona Care)" },
  ];
  const saved = rows[0];
  return <Animated.View layout={reducedMotion ? undefined : LAYOUT}>
    <Pressable accessibilityRole="button" accessibilityLabel={`This week: ${saved.value} bed time saved`} accessibilityHint={open ? "Hides this week's numbers" : "Shows this week's numbers"}
      accessibilityState={{ expanded: open }} onPress={() => setOpen(v => !v)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text style={{ ...type.subhead, flex: 1, color: palette.muted }}><Text style={{ fontWeight: "700", color: saved.tone ? TEAL : palette.ink, fontVariant: ["tabular-nums"] }}>{saved.value}</Text> bed time saved</Text>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>This week</Text>
      <Icon name={open ? "chevron.up" : "chevron.right"} size={11} color={palette.blue} />
    </Pressable>
    {open && <Expand>
      <View accessible accessibilityLabel={`This week, counted from records. ${rows.map(r => `${r.label}: ${r.value}`).join(". ")}.`} style={{ paddingBottom: 2 }}>
        {rows.map((r, i) => <Animated.View key={r.label} entering={reducedMotion ? undefined : riseIn({ delay: 60 + i * 45, distance: 8, duration: 300 })}
          style={{ flexDirection: "row", alignItems: "baseline", gap: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: "rgba(20,28,40,0.06)" }}>
          <Text numberOfLines={2} style={{ ...type.footnote, flex: 1, color: palette.muted }}>{r.label}</Text>
          <Text style={{ ...type.subhead, fontWeight: "600", fontVariant: ["tabular-nums"], color: r.tone === "warn" ? palette.amber : r.tone === "good" ? TEAL : palette.ink }}>{r.value}</Text>
        </Animated.View>)}
        <Text style={{ ...type.caption, color: palette.muted, paddingTop: 4 }}>Counted from records</Text>
      </View>
    </Expand>}
  </Animated.View>;
}

/**
 * Management's My Day lead (instead of clinical tasks): one line on where the ward stands, the bed
 * bar, this week's number (the rest on demand), and one quiet way into the ward to act on it.
 */
export function WardGlance() {
  const { patients, encounters } = useEncounter();
  const { findings } = useFindings();
  const { reducedMotion } = useAccessibleEffects();
  const beds = useServerBeds(findings) ?? wardBeds(patients, encounters);
  const summary = wardSummary(beds);
  return <Surface feature layout={reducedMotion ? undefined : LAYOUT} style={{ padding: 16, gap: 14 }}>
    <View style={{ gap: 4 }}>
      <Text style={{ ...type.overline, color: summary.blocked ? palette.amber : palette.blue }}>Ward now</Text>
      <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{summary.blocked ? `${summary.blocked} discharge${summary.blocked === 1 ? "" : "s"} blocked · ~${summary.bedHours} bed-hours waiting` : `${summary.fit} fit to go · nothing blocked`}</Text>
    </View>
    <BedBar beds={beds} />
    <ThisWeek />
    <Action secondary label="Open the ward" icon="bed.double" onPress={() => router.push("/ward")} />
  </Surface>;
}

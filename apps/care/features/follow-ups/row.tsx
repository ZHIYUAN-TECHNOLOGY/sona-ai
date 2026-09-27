import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { useMe } from "@/features/me";
import { Tile } from "@/features/doses";
import { palette } from "@/lib/theme";
import { pillStyle } from "@/lib/ui";
import { orpc } from "@/utils/orpc";
import { away, dayLabel, followUpNeeds } from "./lines";

/** The patient's follow-ups, earliest first, fetched once they have joined. */
export function useFollowUps() {
  const { state } = useMe();
  return useQuery({ ...orpc.care.followUps.queryOptions(), enabled: state === "joined" });
}
export function useFollowUpNeeds() {
  const { data } = useFollowUps();
  return followUpNeeds(data);
}

/**
 * Home's visit card (reference kit): the day in a pill, what the visit is, and how far off (amber when
 * due soon, red once overdue). The data has no place or phone yet, so the card opens My visits.
 */
export function VisitTile() {
  const { data } = useFollowUps();
  const next = data?.[0];
  const title = next ? next.title : data ? "Nothing booked yet" : "Clinic reviews and tests";
  const when = next ? (next.status === "overdue" ? "Overdue · book it soon" : away(next.inDays).replace(/^./, c => c.toUpperCase())) : "Your visits show here";
  const color = next?.status === "overdue" ? palette.red : next?.status === "due-soon" ? palette.amber : palette.muted;
  return <Tile label={`Next visit${next ? `, ${dayLabel(next.date)}` : ""}. ${title}. ${when}. Open my visits`} onPress={() => router.push("/follow-ups")}>
    <View style={[pillStyle, { alignSelf: "flex-start", minHeight: 30, paddingHorizontal: 11, justifyContent: "center" }]}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: palette.muted, fontVariant: ["tabular-nums"] }}>{next ? dayLabel(next.date) : "Next visit"}</Text>
    </View>
    <View style={{ gap: 4 }}>
      <Text numberOfLines={3} style={{ fontSize: 19, lineHeight: 23, fontWeight: "700", letterSpacing: -0.6, color: next ? palette.ink : palette.muted }}>{title}</Text>
      <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: color === palette.muted ? "400" : "600", color }}>{when}</Text>
    </View>
  </Tile>;
}

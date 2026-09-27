import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { useMe } from "@/features/me";
import { Tile } from "@/features/doses";
import { palette } from "@/lib/theme";
import { pillStyle } from "@/lib/ui";
import { orpc } from "@/utils/orpc";
import { away, followUpNeeds, pillLine } from "./lines";

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
 * Home's tall visit card (Lumi kit frame 1): the day (and time, when booked) in a white pill, what the
 * visit is, large, and how far off (amber when due soon, red once overdue). The data has no place or
 * phone yet, so there is no call or directions button: the whole card opens My visits.
 */
export function VisitTile({ index }: { index: number }) {
  const { data } = useFollowUps();
  const next = data?.[0];
  const title = next ? next.title : data ? "Nothing booked yet" : "Clinic reviews and tests";
  const when = next ? (next.status === "overdue" ? "Overdue · book it soon" : away(next.inDays).replace(/^./, c => c.toUpperCase())) : "Your visits show here";
  const color = next?.status === "overdue" ? palette.red : next?.status === "due-soon" ? palette.amber : palette.muted;
  return <Tile tall index={index} label={`Next visit${next ? `, ${pillLine(next)}` : ""}. ${title}. ${when}. Open my visits`} onPress={() => router.push("/follow-ups")}>
    <View style={[pillStyle, { alignSelf: "flex-start", minHeight: 30, paddingHorizontal: 11, paddingVertical: 5, justifyContent: "center", backgroundColor: palette.white }]}>
      <Text style={{ fontSize: 12.5, lineHeight: 17, fontWeight: "600", color: palette.ink, fontVariant: ["tabular-nums"] }}>{next ? pillLine(next) : "Next visit"}</Text>
    </View>
    <View style={{ gap: 4 }}>
      <Text numberOfLines={4} style={{ fontSize: 22, lineHeight: 27, fontWeight: "700", letterSpacing: -0.6, color: next ? palette.ink : palette.muted }}>{title}</Text>
      <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: color === palette.muted ? "400" : "600", color }}>{when}</Text>
    </View>
    <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: "600", color: palette.muted }}>Care team</Text>
  </Tile>;
}

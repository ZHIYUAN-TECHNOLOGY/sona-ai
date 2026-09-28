import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Text } from "@/lib/text";
import { useMe } from "@/features/me";
import { IconTile, KICKER, Tile } from "@/features/doses";
import { palette } from "@/lib/theme";
import { orpc } from "@/utils/orpc";
import { away, followUpNeeds, pillLine } from "./lines";
import { Capsule } from "./timeline";

/** The patient's follow-ups, earliest first, fetched once they have joined. */
export function useFollowUps() {
  const { state } = useMe();
  return useQuery({ ...orpc.care.followUps.queryOptions(), enabled: state === "joined" });
}
/** The booking requests the patient sent (waiting, confirmed or declined), once they have joined. */
export function useBookingRequests() {
  const { state } = useMe();
  return useQuery({ ...orpc.care.bookings.list.queryOptions(), enabled: state === "joined" });
}
export function useFollowUpNeeds() {
  const { data } = useFollowUps();
  return followUpNeeds(data);
}

const CALENDAR = "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2";

/**
 * Home's next-visit card (the kit's "Visiting your doctor"): a calendar tile, how far off, big (amber when due
 * soon, red once overdue), what it is and its day and time in a white capsule. The data has no place or phone yet, so there is no
 * call or directions button: the whole card opens My visits.
 */
export function VisitCard({ index }: { index: number }) {
  const { data } = useFollowUps();
  const next = data?.[0];
  const big = next ? (next.status === "overdue" ? "Overdue" : away(next.inDays).replace(/^./, c => c.toUpperCase())) : "None";
  const title = next ? next.title : data ? "Nothing booked yet" : "Your visits show here";
  const tone = next?.status === "overdue" ? palette.red : next?.status === "due-soon" ? palette.amber : palette.ink;
  return <Tile index={index} label={`Next visit. ${next ? `${title}, ${pillLine(next)}, ${big}` : title}. Open my visits`} onPress={() => router.push("/follow-ups")}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <IconTile bg={palette.blueWash}>
        <Svg width={18} height={18} viewBox="0 0 24 24"><Path d={CALENDAR} fill="none" stroke={palette.blue} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" /></Svg>
      </IconTile>
      <Text style={KICKER}>Next visit</Text>
    </View>
    <View style={{ gap: 2 }}>
      <Text style={{ fontSize: 28, lineHeight: 34, fontWeight: "400", letterSpacing: -0.8, color: next ? tone : palette.faint }}>{big}</Text>
      <Text numberOfLines={3} style={{ fontSize: 14, lineHeight: 19, fontWeight: "500", color: palette.ink }}>{title}</Text>
      {next && <View style={{ marginTop: 6 }}><Capsule>{pillLine(next)}</Capsule></View>}
    </View>
  </Tile>;
}

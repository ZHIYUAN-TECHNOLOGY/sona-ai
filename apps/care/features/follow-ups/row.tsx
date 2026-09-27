import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMe } from "@/features/me";
import { Tile } from "@/features/doses";
import { orpc } from "@/utils/orpc";
import { followUpNeeds, nextVisit } from "./lines";

/** The patient's follow-ups, earliest first, fetched once they have joined. */
export function useFollowUps() {
  const { state } = useMe();
  return useQuery({ ...orpc.care.followUps.queryOptions(), enabled: state === "joined" });
}
export function useFollowUpNeeds() {
  const { data } = useFollowUps();
  return followUpNeeds(data);
}

/** Home's glance tile for the next follow-up: the date big, what it is and how far off. */
export function VisitTile() {
  const { data } = useFollowUps();
  const { value, line, tone } = data ? nextVisit(data) : { value: "—", line: "Clinic reviews and tests", tone: "muted" as const };
  return <Tile overline="Next visit" value={value} line={line} tone={tone} label={`Next visit, ${value}. ${line}`} onPress={() => router.push("/follow-ups")} />;
}

import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMe } from "@/features/me";
import { Row } from "@/lib/ui";
import { orpc } from "@/utils/orpc";
import { followUpNeeds, nextLine } from "./lines";

/** The patient's follow-ups, earliest first, fetched once they have joined. */
export function useFollowUps() {
  const { state } = useMe();
  return useQuery({ ...orpc.care.followUps.queryOptions(), enabled: state === "joined" });
}
export function useFollowUpNeeds() {
  const { data } = useFollowUps();
  return followUpNeeds(data);
}

/** Home row for the next follow-up: what and when, amber when close, red when overdue. */
export function FollowUpRow({ first }: { first?: boolean }) {
  const { data } = useFollowUps();
  const { line, tone } = data ? nextLine(data) : { line: "Clinic reviews and tests coming up", tone: "muted" as const };
  return <Row first={first} title="My follow-ups" line={line} tone={tone} onPress={() => router.push("/follow-ups")} />;
}

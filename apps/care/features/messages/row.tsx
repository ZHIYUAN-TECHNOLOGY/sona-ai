import { router } from "expo-router";
import { Row } from "@/lib/ui";

/** Home row for the care team thread (lane A): last message and whether a reply is waiting. */
export function useMessageNeeds() { return 0; }
export function CareTeamRow({ first }: { first?: boolean }) {
  return <Row first={first} title="Message my care team" line="Not for emergencies · call 999" onPress={() => router.push("/messages")} />;
}

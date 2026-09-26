import { router } from "expo-router";
import { Row } from "@/lib/ui";

/** Home row for the next follow-up (lane B): what and when, amber when close, red when overdue. */
export function useFollowUpNeeds() { return 0; }
export function FollowUpRow({ first }: { first?: boolean }) {
  return <Row first={first} title="My follow-ups" line="Clinic reviews and tests coming up" onPress={() => router.push("/follow-ups")} />;
}

import { router } from "expo-router";
import { Row } from "@/lib/ui";

/** Home row for the discharge plan (lane B): today's medicines at a glance. */
export function DischargeRow({ first }: { first?: boolean }) {
  return <Row first={first} title="My discharge" line="Your leaflet, medicines and warning signs" onPress={() => router.push("/discharge")} />;
}

import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMe } from "@/features/me";
import { Row } from "@/lib/ui";
import { orpc } from "@/utils/orpc";
import { dischargeLine } from "./lines";

/** The patient's discharge plan, fetched once they have joined. */
export function useDischarge() {
  const { state } = useMe();
  return useQuery({ ...orpc.care.discharge.queryOptions(), enabled: state === "joined" });
}

/** Home row for the discharge plan: today's medicines at a glance. */
export function DischargeRow({ first }: { first?: boolean }) {
  const { data } = useDischarge();
  return <Row first={first} title="My discharge" line={dischargeLine(data)} onPress={() => router.push("/discharge")} />;
}

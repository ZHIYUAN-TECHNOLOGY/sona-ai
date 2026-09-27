import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";
import { useMe } from "@/features/me";
import { Text } from "@/lib/text";
import { palette } from "@/lib/theme";
import { Row } from "@/lib/ui";
import { orpc } from "@/utils/orpc";
import { dischargeLine, type Group } from "./lines";

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

/** What the stay did to a medicine, as the kit's small capsule: blue for new, amber for changed, grey otherwise. */
export const TAGS: Record<Group, { label: string; bg: string; fg: string }> = {
  new: { label: "New", bg: palette.blueWash, fg: palette.blue },
  changed: { label: "Changed", bg: palette.amberWash, fg: palette.amber },
  stopped: { label: "Stopped", bg: palette.mutedWash, fg: palette.muted },
  continue: { label: "Same as before", bg: palette.mutedWash, fg: palette.muted },
};

export function Tag({ group, label = TAGS[group].label }: { group: Group; label?: string }) {
  const { bg, fg } = TAGS[group];
  return <View style={{ alignSelf: "center", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: bg }}>
    <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, lineHeight: 17, fontWeight: "600", color: fg }}>{label}</Text>
  </View>;
}

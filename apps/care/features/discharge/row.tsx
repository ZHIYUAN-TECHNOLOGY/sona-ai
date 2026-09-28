import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";
import { useMe } from "@/features/me";
import { useEffect } from "react";
import { setPlanLang, useLang, useT } from "@/lib/i18n";
import "./strings";
import { Text } from "@/lib/text";
import { palette } from "@/lib/theme";
import { Row } from "@/lib/ui";
import { orpc } from "@/utils/orpc";
import { dischargeLine, type Group } from "./lines";

/**
 * The patient's discharge plan in the language Sona Care speaks, fetched once they have joined (re-read
 * when the language changes, keeping the last plan on screen meanwhile); the plan's own language leads
 * Sona Care's words until the patient picks one.
 */
export function useDischarge() {
  const { state } = useMe();
  const lang = useLang();
  const query = useQuery({ ...orpc.care.discharge.queryOptions({ input: { lang } }), enabled: state === "joined", placeholderData: keepPreviousData });
  const language = query.data?.status === "discharged" ? query.data.language : undefined;
  useEffect(() => { if (language) setPlanLang(language); }, [language]);
  return query;
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

export function Tag({ group, label }: { group: Group; label?: string }) {
  const t = useT();
  const { bg, fg } = TAGS[group];
  label ??= t(`dis.tag.${group}`);
  return <View style={{ alignSelf: "center", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: bg }}>
    <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, lineHeight: 17, fontWeight: "600", color: fg, textAlign: "center" }}>{label}</Text>
  </View>;
}

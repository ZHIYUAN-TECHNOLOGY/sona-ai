import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { ScrollView, View, useWindowDimensions } from "react-native";
import Animated from "react-native-reanimated";
import { riseIn } from "@/components/sona/motion";
import { List, ListRow } from "@/components/sona/list";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, useAccessibleEffects } from "@/components/sona/ui";
import { openSessionFromSheet } from "@/features/encounter/navigation";
import { useEncounter } from "@/features/encounter/store";

/** Route `/visits?ids=…`: the patients behind a grouped ruler pin, in time order. Picking one opens that visit. */
export function VisitsSheet() {
  const { ids } = useLocalSearchParams<{ ids?: string }>();
  const { patients, encounters } = useEncounter();
  const { height } = useWindowDimensions();
  const { reducedMotion } = useAccessibleEffects();
  const list = (ids ?? "").split(",").map(id => patients.find(p => p.id === id)).filter(p => p !== undefined).sort((a, b) => a.time.localeCompare(b.time));
  const sheet = useNavigation();
  const pick = (id: string) => openSessionFromSheet(sheet, id);
  // The ruler's group can outlive its visits (a live day re-read, a stale link): say so calmly.
  if (!list.length) return <View style={{ paddingTop: 36, paddingBottom: 34, paddingHorizontal: 20, gap: 12 }}>
    <Text accessibilityRole="header" style={{ ...type.heading, color: palette.ink }}>No visits here now</Text>
    <Text style={{ ...type.callout, color: palette.muted }}>These visits have moved or finished. Today's list on My Day is current.</Text>
    <View style={{ alignSelf: "flex-start" }}><Action label="Back to My Day" secondary onPress={() => router.back()} /></View>
  </View>;
  return <View style={{ paddingTop: 36, paddingBottom: 34, gap: 18 }}>
    <Text accessibilityRole="header" style={{ paddingHorizontal: 20, ...type.heading, color: palette.ink }}>{list.length} patients <Text style={{ color: palette.muted, fontWeight: "500" }}>· {list[0]?.time}{list.length > 1 && list.at(-1)!.time !== list[0]!.time ? `–${list.at(-1)!.time}` : ""}</Text></Text>
    <ScrollView style={{ maxHeight: height * 0.6, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20 }}>
      <List>
        {list.map((p, i) => { const started = Boolean(encounters[p.id]?.requests.length); return <Animated.View key={p.id} entering={reducedMotion ? undefined : riseIn({ delay: i * 40, distance: 8, duration: 280 })}>
          <ListRow title={p.name} detail={started ? "In progress" : p.subtitle} tone={started ? "next" : p.incomplete ? "soon" : "calm"} initials={p.initials} trailing={p.time} divider={i > 0} onPress={() => pick(p.id)} accessibilityHint="Opens the visit" />
        </Animated.View>; })}
      </List>
    </ScrollView>
  </View>;
}

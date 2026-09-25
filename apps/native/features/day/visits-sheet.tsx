import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import Animated from "react-native-reanimated";
import { riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Icon, useAccessibleEffects } from "@/components/sona/ui";
import { openSession } from "@/features/encounter/navigation";
import { useEncounter } from "@/features/encounter/store";

/** Route `/visits?ids=…`: the patients behind a grouped ruler pin, in time order. Picking one opens that visit. */
export function VisitsSheet() {
  const { ids } = useLocalSearchParams<{ ids?: string }>();
  const { patients, encounters } = useEncounter();
  const { height } = useWindowDimensions();
  const { reducedMotion } = useAccessibleEffects();
  const list = (ids ?? "").split(",").map(id => patients.find(p => p.id === id)).filter(p => p !== undefined).sort((a, b) => a.time.localeCompare(b.time));
  const pick = (id: string) => { router.back(); setTimeout(() => openSession(id), 350); };
  return <View style={{ paddingTop: 22, paddingBottom: 34, gap: 10 }}>
    <Text accessibilityRole="header" style={{ paddingHorizontal: 20, ...type.heading, color: palette.ink }}>{list.length} patients <Text style={{ color: palette.muted, fontWeight: "500" }}>· {list[0]?.time}{list.length > 1 && list.at(-1)!.time !== list[0]!.time ? `–${list.at(-1)!.time}` : ""}</Text></Text>
    <ScrollView style={{ maxHeight: height * 0.6, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20 }}>
      <View style={{ borderRadius: 18, borderCurve: "continuous", backgroundColor: palette.white, overflow: "hidden" }}>
        {list.map((p, i) => { const started = Boolean(encounters[p.id]?.requests.length); return <Animated.View key={p.id} entering={reducedMotion ? undefined : riseIn({ delay: i * 40, distance: 8, duration: 280 })}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${p.name}, ${p.time}, ${p.subtitle}`} accessibilityHint="Opens the visit" onPress={() => pick(p.id)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderColor: "rgba(20,28,40,0.06)", backgroundColor: pressed ? "rgba(20,28,40,0.04)" : "transparent" })}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: p.incomplete ? "rgba(196,120,20,0.16)" : "rgba(36,91,204,0.14)", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: p.incomplete ? palette.amber : palette.blue }}>{p.initials}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{p.name}</Text>
              <Text style={{ ...type.caption, color: started ? palette.blue : palette.muted }}>{p.time} · {started ? "In progress" : p.subtitle}</Text>
            </View>
            <Icon name="chevron.right" size={12} color={palette.muted} />
          </Pressable>
        </Animated.View>; })}
      </View>
    </ScrollView>
  </View>;
}

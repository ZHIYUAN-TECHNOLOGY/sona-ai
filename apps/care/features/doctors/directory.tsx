import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import { tFor, useLang, useT } from "@/lib/i18n";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { pillStyle, surfaceStyle } from "@/lib/ui";
import { DoctorAvatar } from "./avatar";
import { dayParts, nameLines, type Filter, type ListedDoctor } from "./data";

/** The hospital's directory parts, shared by Doctors (your care team) and Find a doctor (the whole directory). */
export const TABS: { id: Filter; label: string }[] = [
  { id: "all", label: "doc.all" }, { id: "care-team", label: "doc.careTeam" }, { id: "top-rated", label: "doc.top" }, { id: "for-you", label: "doc.forYou" },
];
/** The selected tab's ink capsule slides on the layout spring (380 ms, no bounce); the list itself doesn't move. */
const SLIDE = LinearTransition.springify().duration(380).dampingRatio(1);
/**
 * The filter: a row of white capsules; the selected one is an ink capsule (white label) that slides to
 * the tab picked, carrying its label. The capsules underneath stay put.
 */
export function Tabs({ tab, still, onPick }: { tab: Filter; still: boolean; onPick: (t: Filter) => void }) {
  const t = useT();
  const [frames, setFrames] = useState<Partial<Record<Filter, { x: number; width: number }>>>({});
  const at = frames[tab];
  // Two lines allowed: "Pasukan saya" or "Untuk anda" would shrink past legibility on one.
  const label = { fontSize: 14, lineHeight: 17, paddingHorizontal: 4, textAlign: "center" } as const;
  return <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 6 }}>
    {TABS.map(x => {
      const on = x.id === tab;
      return <Pressable key={x.id} accessibilityRole="tab" accessibilityLabel={t(x.label)} accessibilityState={{ selected: on }} onPress={() => onPick(x.id)}
        onLayout={e => { const { x: left, width } = e.nativeEvent.layout; setFrames(f => ({ ...f, [x.id]: { x: left, width } })); }}
        style={({ pressed }) => [pillStyle, { flex: 1, minHeight: 48, paddingVertical: 4, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
        <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85} style={{ ...label, fontWeight: "500", color: palette.muted }}>{t(x.label)}</Text>
      </Pressable>;
    })}
    {at && <Animated.View layout={still ? undefined : SLIDE} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", top: 0, bottom: 0, left: at.x, width: at.width, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: palette.dark }}>
      <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85} style={{ ...label, fontWeight: "600", color: palette.white }}>{t(TABS.find(x => x.id === tab)?.label ?? "")}</Text>
    </Animated.View>}
  </View>;
}

/** A doctor in the grid (kit card): the doctor's avatar, the name on two lines, the specialty, then rating and next clinic in a white capsule. `badge`: the Care team capsule (off under "Your care team"). */
export function DoctorCard({ doctor: d, badge = true }: { doctor: ListedDoctor; badge?: boolean }) {
  const lang = useLang(), t = tFor(lang);
  const [first, rest] = nameLines(d.name);
  const next = d.nextSlots[0];
  const day = next && dayParts(next.day, lang);
  return <Pressable accessibilityRole="button" accessibilityHint={t("doc.cardHint")}
    accessibilityLabel={[d.name, d.specialty, t("doc.rated", { rating: d.rating }), d.careTeam && t("doc.inTeam"), day && t("doc.nextClinic", { day: day.spoken })].filter(Boolean).join(", ")}
    onPress={() => router.push({ pathname: "/doctor", params: { id: d.id } })}
    style={({ pressed }) => [surfaceStyle, { minHeight: 200, padding: 16, gap: 10, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
      <DoctorAvatar doctor={d} size={56} />
      {badge && d.careTeam && <View style={{ flexShrink: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: palette.blueWash }}>
        <Text style={{ fontSize: 11, lineHeight: 14, fontWeight: "600", color: palette.blue, textAlign: "center" }}>{t("doc.careTeam")}</Text>
      </View>}
    </View>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ fontSize: 16, lineHeight: 21, fontWeight: "600", letterSpacing: -0.3, color: palette.ink }}>{first}{"\n"}{rest}</Text>
      <Text numberOfLines={1} style={{ ...type.footnote, color: palette.faint }}>{d.specialty}</Text>
    </View>
    <View style={[pillStyle, { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, minHeight: 28 }]}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: palette.ink, fontVariant: ["tabular-nums"] }}><Text style={{ color: palette.away }}>★</Text> {d.rating}{day ? ` · ${day.weekday} ${day.date}` : ""}</Text>
    </View>
  </Pressable>;
}


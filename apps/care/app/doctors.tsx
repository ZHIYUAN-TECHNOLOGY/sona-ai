import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, useReducedMotion } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { takeLine } from "@/features/discharge/lines";
import { useDischarge } from "@/features/discharge/row";
import { DoctorAvatar } from "@/features/doctors/avatar";
import { dayParts, listFor, nameLines, searchDoctors, type Filter, type ListedDoctor } from "@/features/doctors/data";
import { errorText } from "@/features/errors";
import { useMe } from "@/features/me";
import { dayLabel } from "@/features/follow-ups/lines";
import { DOCK_SPACE } from "@/lib/dock";
import { Text, TextInput } from "@/lib/text";
import { palette, space, type } from "@/lib/theme";
import { Card, CircleButton, field, ICON, pillStyle, Section, surfaceStyle, Title } from "@/lib/ui";
import { orpc } from "@/utils/orpc";

const TABS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" }, { id: "care-team", label: "Care team" }, { id: "top-rated", label: "Top rated" }, { id: "for-you", label: "For you" },
];
const SEARCH = "M11 19a8 8 0 1 0 0-16a8 8 0 0 0 0 16M21 21l-4.3-4.3";
const DOC = "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5";
const BOOK = "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20";
/** First appearance: a 40 ms ease-out stagger (60fps Vakitler); still under Reduce Motion, and never on a tab switch or search. */
const rise = (i: number) => FadeInDown.duration(360).easing(Easing.out(Easing.cubic)).delay(i * 40);
/** The selected tab's ink capsule slides on the layout spring (380 ms, no bounce); the list itself doesn't move. */
const SLIDE = LinearTransition.springify().duration(380).dampingRatio(1);

/**
 * Find a doctor (the AI Health Companion kit): "Find a / doctor" with a round glass search and an
 * honest line that these are sample doctors, a row of white filter capsules (All, Care team, Top
 * rated, For you from the patient's own plan) with the selected one in ink, a two-column grid of doctor
 * cards opening Doctor details, then "Your / records" as kit form rows (only what the discharge plan
 * really holds). SYNTHETIC doctors; see features/doctors/data.
 */
export default function Doctors() {
  const still = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const plan = useDischarge().data;
  // The hospital's directory with each doctor's free slots (SYNTHETIC doctors in the demo).
  const { state } = useMe();
  const doctors = useQuery({ ...orpc.care.doctors.list.queryOptions(), enabled: state === "joined" });
  const [tab, setTab] = useState<Filter>("all");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // Once the patient has switched a tab or searched, cards appear in place (no entrance per change).
  const [touched, setTouched] = useState(false);
  // "For you" reads the English leaflet (the doctors' tags are English words), e.g. "chest infection … breathing".
  const words = plan?.status === "discharged" ? plan.leaflets.find(l => l.language === "en")?.text ?? "" : "";
  const list = searchDoctors(listFor(doctors.data ?? [], tab, words), searching ? query : "");
  const enter = (i: number) => still || touched ? undefined : rise(i);

  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    contentContainerStyle={{ padding: space.edge, paddingTop: space.top, paddingBottom: DOCK_SPACE, gap: space.stack }}>
    <Animated.View entering={enter(0)} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <View style={{ flex: 1 }}><Title greeting="Find a" line="Sample doctors for this demo">Doctor</Title></View>
      <CircleButton d={searching ? ICON.close : SEARCH} label={searching ? "Close search" : "Search doctors"}
        onPress={() => { setSearching(s => !s); setQuery(""); setTouched(true); }} />
    </Animated.View>

    {searching && <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
      <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Name or specialty" placeholderTextColor={palette.muted} returnKeyType="search"
        clearButtonMode="while-editing" autoCorrect={false} accessibilityLabel="Search doctors by name or specialty" style={{ ...field, borderRadius: 999, backgroundColor: palette.white }} />
    </Animated.View>}

    <Animated.View entering={enter(1)}><Tabs tab={tab} still={still} onPick={t => { setTab(t); setTouched(true); }} /></Animated.View>
    {tab === "for-you" && words !== "" && <Text style={{ ...type.footnote, color: palette.muted, marginTop: -6 }}>Matched to words in your discharge leaflet</Text>}

    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 }}>
      {list.map((d, i) => <Animated.View key={d.id} entering={enter(2 + i)} style={{ width: fontScale > 1.3 ? "100%" : "48.2%" }}>
        <DoctorCard doctor={d} />
      </Animated.View>)}
    </View>
    {doctors.isLoading && <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start" }} />}
    {doctors.error && <Text selectable style={{ ...type.body, color: palette.red }}>{errorText(doctors.error)}</Text>}
    {doctors.data && !list.length && <Card>
      <Text style={{ ...type.body, color: palette.muted }}>
        {searching && query.trim() ? `No doctor matches “${query.trim()}”.` : tab === "for-you" ? "Nothing in your plan to match yet. Your care team can suggest who to see." : "No doctors here."}
      </Text>
    </Card>}

    <Animated.View entering={enter(2 + list.length)} style={{ gap: 10, marginTop: 8 }}>
      <Section light="Your" bold="records" />
      {plan?.status === "discharged" ? <>
        <RecordRow icon={DOC} title="Discharge plan" value={dayLabel(plan.dischargedAt)} spoken={`Discharge plan, ${dayLabel(plan.dischargedAt)}. ${takeLine(plan.medicines, "")}`} />
        {plan.leaflets[0] && <RecordRow icon={BOOK} title="Leaflet" value={plan.leaflets.map(l => l.name).join(", ")}
          spoken={`Leaflet in ${plan.leaflets.map(l => l.name).join(" and ")}`} />}
      </>
        : <Text style={{ ...type.body, color: palette.muted }}>{plan ? "Your discharge plan and leaflet show here once you go home." : "Your discharge papers show here."}</Text>}
    </Animated.View>
  </ScrollView>;
}

/**
 * The filter: a row of white capsules; the selected one is an ink capsule (white label) that slides to
 * the tab picked, carrying its label. The capsules underneath stay put.
 */
function Tabs({ tab, still, onPick }: { tab: Filter; still: boolean; onPick: (t: Filter) => void }) {
  const [frames, setFrames] = useState<Partial<Record<Filter, { x: number; width: number }>>>({});
  const at = frames[tab];
  const label = { fontSize: 14, paddingHorizontal: 4 } as const;
  return <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 6 }}>
    {TABS.map(t => {
      const on = t.id === tab;
      return <Pressable key={t.id} accessibilityRole="tab" accessibilityLabel={t.label} accessibilityState={{ selected: on }} onPress={() => onPick(t.id)}
        onLayout={e => { const { x, width } = e.nativeEvent.layout; setFrames(f => ({ ...f, [t.id]: { x, width } })); }}
        style={({ pressed }) => [pillStyle, { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ ...label, fontWeight: "500", color: palette.muted }}>{t.label}</Text>
      </Pressable>;
    })}
    {at && <Animated.View layout={still ? undefined : SLIDE} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", top: 0, bottom: 0, left: at.x, width: at.width, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: palette.dark }}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ ...label, fontWeight: "600", color: palette.white }}>{TABS.find(t => t.id === tab)?.label}</Text>
    </Animated.View>}
  </View>;
}

/** A doctor in the grid (kit card): the initials avatar, the name on two lines, the specialty, then rating and next clinic in a white capsule. */
function DoctorCard({ doctor: d }: { doctor: ListedDoctor }) {
  const [first, rest] = nameLines(d.name);
  const next = d.nextSlots[0];
  const day = next && dayParts(next.day);
  return <Pressable accessibilityRole="button" accessibilityHint="Opens the doctor's details and clinic times"
    accessibilityLabel={[d.name, d.specialty, `rated ${d.rating} of 5`, d.careTeam && "in your care team", day && `next clinic ${day.spoken}`].filter(Boolean).join(", ")}
    onPress={() => router.push({ pathname: "/doctor", params: { id: d.id } })}
    style={({ pressed }) => [surfaceStyle, { minHeight: 200, padding: 16, gap: 10, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
      <DoctorAvatar doctor={d} size={56} />
      {d.careTeam && <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: palette.blueWash }}>
        <Text style={{ fontSize: 11, lineHeight: 14, fontWeight: "600", color: palette.blue }}>Care team</Text>
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

/** A record as a kit form row (icon, label, value, chevron); opens the plan. */
function RecordRow({ icon, title, value, spoken }: { icon: string; title: string; value: string; spoken: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={spoken} accessibilityHint="Opens your discharge plan" onPress={() => router.push("/discharge")}
    style={({ pressed }) => [surfaceStyle, { borderRadius: 20, minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><Path d={icon} /></Svg>
    <Text style={{ ...type.body, fontWeight: "500", color: palette.ink }}>{title}</Text>
    <Text numberOfLines={1} style={{ flex: 1, ...type.footnote, color: palette.muted, textAlign: "right" }}>{value}</Text>
    <Text style={{ fontSize: 20, color: palette.faint }}>›</Text>
  </Pressable>;
}

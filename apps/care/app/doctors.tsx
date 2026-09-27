import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, useReducedMotion } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { takeLine } from "@/features/discharge/lines";
import { useDischarge } from "@/features/discharge/row";
import { DoctorAvatar } from "@/features/doctors/avatar";
import { listFor, nameLines, searchDoctors, type Doctor, type Filter } from "@/features/doctors/data";
import { dayLabel } from "@/features/follow-ups/lines";
import { useMessageNeeds } from "@/features/messages/row";
import { DOCK_SPACE } from "@/lib/dock";
import { Text, TextInput } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { Card, CircleButton, field, ICON, surfaceStyle } from "@/lib/ui";

const TABS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" }, { id: "care-team", label: "Care team" }, { id: "top-rated", label: "Top rated" }, { id: "for-you", label: "For you" },
];
const SEARCH = "M11 19a8 8 0 1 0 0-16a8 8 0 0 0 0 16M21 21l-4.3-4.3";
const DOC = "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5";
/** First appearance: a 40 ms ease-out stagger; still under Reduce Motion, and never on a tab switch or search. */
const rise = (i: number) => FadeInDown.duration(360).easing(Easing.out(Easing.cubic)).delay(i * 40);
/** The selected tab's pill slides on the layout spring (380 ms, no bounce); the list itself doesn't move. */
const SLIDE = LinearTransition.springify().duration(380).dampingRatio(1);

/**
 * All Doctors (Life OS): the title with search and the bell, an honest line that these are sample
 * doctors, a segmented track (All, Care team, Top rated, For you from the patient's own plan), a
 * two-column grid of doctor cards opening Doctor details, then the patient's own medical record
 * (only what the discharge plan really holds). SYNTHETIC doctors; see features/doctors/data.
 */
export default function Doctors() {
  const still = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const plan = useDischarge().data;
  const reply = useMessageNeeds() > 0;
  const [tab, setTab] = useState<Filter>("all");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // Once the patient has switched a tab or searched, cards appear in place (no entrance per change).
  const [touched, setTouched] = useState(false);
  // "For you" reads the English leaflet (the doctors' tags are English words), e.g. "chest infection … breathing".
  const words = plan?.status === "discharged" ? plan.leaflets.find(l => l.language === "en")?.text ?? "" : "";
  const list = searchDoctors(listFor(tab, words), searching ? query : "");
  const enter = (i: number) => still || touched ? undefined : rise(i);

  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    contentContainerStyle={{ padding: 20, paddingBottom: DOCK_SPACE, gap: 16 }}>
    <Animated.View entering={enter(0)} style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text accessibilityRole="header" style={{ flex: 1, fontSize: 34, lineHeight: 40, letterSpacing: -1, fontWeight: "300", color: palette.ink }}>All Doctors</Text>
        <CircleButton d={searching ? ICON.close : SEARCH} label={searching ? "Close search" : "Search doctors"}
          onPress={() => { setSearching(s => !s); setQuery(""); setTouched(true); }} />
        <CircleButton d={ICON.bell} dot={reply} label={reply ? "Messages. Your care team replied" : "Messages from my care team"} onPress={() => router.push("/messages")} />
      </View>
      <Text style={{ ...type.footnote, color: palette.faint }}>Sample doctors · Demo General Hospital (synthetic)</Text>
    </Animated.View>

    {searching && <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
      <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Name or specialty" placeholderTextColor={palette.muted} returnKeyType="search"
        clearButtonMode="while-editing" autoCorrect={false} accessibilityLabel="Search doctors by name or specialty" style={{ ...field, backgroundColor: palette.white, borderColor: palette.line }} />
    </Animated.View>}

    <Animated.View entering={enter(1)}><Tabs tab={tab} still={still} onPick={t => { setTab(t); setTouched(true); }} /></Animated.View>
    {tab === "for-you" && words !== "" && <Text style={{ ...type.footnote, color: palette.muted, marginTop: -6 }}>Matched to words in your discharge leaflet</Text>}

    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 }}>
      {list.map((d, i) => <Animated.View key={d.id} entering={enter(2 + i)} style={{ width: fontScale > 1.3 ? "100%" : "48.2%" }}>
        <DoctorCard doctor={d} />
      </Animated.View>)}
    </View>
    {!list.length && <Card>
      <Text style={{ ...type.body, color: palette.muted }}>
        {searching && query.trim() ? `No doctor matches “${query.trim()}”.` : tab === "for-you" ? "Nothing in your plan to match yet. Your care team can suggest who to see." : "No doctors here."}
      </Text>
    </Card>}

    <Animated.View entering={enter(2 + list.length)} style={{ gap: 10, marginTop: 4 }}>
      <Text accessibilityRole="header" style={{ fontSize: 20, lineHeight: 26, fontWeight: "500", letterSpacing: -0.4, color: palette.ink }}>Medical record</Text>
      {plan?.status === "discharged" ? <Card style={{ paddingVertical: 4, paddingHorizontal: 14, gap: 0 }}>
        <RecordRow first title="Discharge plan" line={`${dayLabel(plan.dischargedAt)} · ${takeLine(plan.medicines, "")}`} />
        {plan.leaflets[0] && <RecordRow title={`Leaflet (${plan.leaflets[0].name})`}
          line={plan.leaflets.length > 1 ? `Also in ${plan.leaflets.slice(1).map(l => l.name).join(" and ")}` : "Your language"} />}
      </Card>
        : <Text style={{ ...type.body, color: palette.muted }}>{plan ? "Your discharge plan and leaflet show here once you go home." : "Your discharge papers show here."}</Text>}
    </Animated.View>
  </ScrollView>;
}

/** The segmented track: a light grey capsule, the selected tab a white pill that slides between tabs. */
function Tabs({ tab, still, onPick }: { tab: Filter; still: boolean; onPick: (t: Filter) => void }) {
  const [frames, setFrames] = useState<Partial<Record<Filter, { x: number; width: number }>>>({});
  const at = frames[tab];
  return <View accessibilityRole="tablist" style={{ flexDirection: "row", padding: 4, borderRadius: 999, backgroundColor: palette.mutedWash }}>
    {at && <Animated.View layout={still ? undefined : SLIDE} pointerEvents="none"
      style={{ position: "absolute", top: 4, bottom: 4, left: at.x, width: at.width, borderRadius: 999, backgroundColor: palette.white, boxShadow: "0 1px 2px rgba(14,18,27,0.06), 0 6px 14px -8px rgba(14,18,27,0.2)" }} />}
    {TABS.map(t => {
      const on = t.id === tab;
      return <Pressable key={t.id} accessibilityRole="tab" accessibilityLabel={t.label} accessibilityState={{ selected: on }} onPress={() => onPick(t.id)}
        onLayout={e => { const { x, width } = e.nativeEvent.layout; setFrames(f => ({ ...f, [t.id]: { x, width } })); }}
        style={({ pressed }) => ({ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontSize: 14, fontWeight: on ? "600" : "400", color: on ? palette.ink : palette.muted }}>{t.label}</Text>
      </Pressable>;
    })}
  </View>;
}

/** A doctor in the grid (Life OS): specialty and ★ rating on top, years, the name on two lines, the initials avatar bottom right. */
function DoctorCard({ doctor: d }: { doctor: Doctor }) {
  const [first, rest] = nameLines(d.name);
  return <Pressable accessibilityRole="button" accessibilityHint="Opens the doctor's details and clinic times"
    accessibilityLabel={[d.name, d.specialty, `rated ${d.rating} of 5`, `${d.years} years`, d.careTeam && "in your care team"].filter(Boolean).join(", ")}
    onPress={() => router.push({ pathname: "/doctor", params: { id: d.id } })}
    style={({ pressed }) => [surfaceStyle, { minHeight: 176, padding: 14, gap: 3, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text numberOfLines={1} style={{ flex: 1, ...type.footnote, color: palette.muted }}>{d.specialty}</Text>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink }}><Text style={{ color: palette.away }}>★</Text> {d.rating}</Text>
    </View>
    <Text style={{ ...type.footnote, fontSize: 12, color: palette.faint }}>{d.years} years</Text>
    {d.careTeam && <View style={{ alignSelf: "flex-start", marginTop: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: palette.blueWash }}>
      <Text style={{ fontSize: 11, lineHeight: 14, fontWeight: "600", color: palette.blue }}>Care team</Text>
    </View>}
    <View style={{ flex: 1, minHeight: 8 }} />
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
      <Text style={{ flex: 1, fontSize: 17, lineHeight: 21, fontWeight: "600", letterSpacing: -0.3, color: palette.ink }}>{first}{"\n"}{rest}</Text>
      <DoctorAvatar doctor={d} size={44} />
    </View>
  </Pressable>;
}

/** A record row: a document tile, what it is, one line of detail, a chevron; opens the plan. */
function RecordRow({ title, line, first }: { title: string; line: string; first?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${line}`} accessibilityHint="Opens your discharge plan" onPress={() => router.push("/discharge")}
    style={({ pressed }) => ({ minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderColor: palette.line, opacity: pressed ? 0.6 : 1 })}>
    <View style={{ width: 40, height: 40, borderRadius: 12, borderCurve: "continuous", alignItems: "center", justifyContent: "center", backgroundColor: palette.blueWash }}>
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={palette.blue} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><Path d={DOC} /></Svg>
    </View>
    <View style={{ flex: 1, gap: 1 }}>
      <Text style={{ fontSize: 16, lineHeight: 21, fontWeight: "500", color: palette.ink }}>{title}</Text>
      <Text numberOfLines={2} style={{ ...type.footnote, color: palette.muted }}>{line}</Text>
    </View>
    <Text style={{ fontSize: 20, color: palette.faint }}>›</Text>
  </Pressable>;
}

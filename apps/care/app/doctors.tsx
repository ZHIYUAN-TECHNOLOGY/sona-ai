import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import Animated, { Easing, FadeInDown, FadeInUp, FadeOutUp, LinearTransition, useReducedMotion } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { listOf, takeLine } from "@/features/discharge/lines";
import { tFor, useLang, useT } from "@/lib/i18n";
import { useDischarge } from "@/features/discharge/row";
import { DoctorAvatar } from "@/features/doctors/avatar";
import { dayParts, listFor, nameLines, searchDoctors, type Filter, type ListedDoctor } from "@/features/doctors/data";
import { useMe } from "@/features/me";
import { dayLabel } from "@/features/follow-ups/lines";
import { DOCK_SPACE } from "@/lib/dock";
import { Text, TextInput } from "@/lib/text";
import { motion, palette, space, type } from "@/lib/theme";
import { Card, field, pillStyle, Section, surfaceStyle, Title, LoadError } from "@/lib/ui";
import { orpc } from "@/utils/orpc";

const TABS: { id: Filter; label: string }[] = [
  { id: "all", label: "doc.all" }, { id: "care-team", label: "doc.careTeam" }, { id: "top-rated", label: "doc.top" }, { id: "for-you", label: "doc.forYou" },
];
const SEARCH = "M11 19a8 8 0 1 0 0-16a8 8 0 0 0 0 16M21 21l-4.3-4.3";
const DOC = "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5";
const BOOK = "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20";
/** First appearance: a 40 ms ease-out stagger (60fps Vakitler); still under Reduce Motion, and never on a tab switch or search. */
const rise = (i: number) => FadeInDown.duration(360).easing(Easing.out(Easing.cubic)).delay(i * 40);
/** The selected tab's ink capsule slides on the layout spring (380 ms, no bounce); the list itself doesn't move. */
const SLIDE = LinearTransition.springify().duration(380).dampingRatio(1);
/**
 * The directory opens in place (60fps superlist-onboarding-invite-member-animation, calmer: no bounce,
 * short travel): search and filters unfold 8 pt down from the row, then the cards rise 12 pt, 40 ms apart (the
 * first 8; the rest arrive with the eighth). Closing fades it out on a short lift, folding it back up.
 */
const UNFOLD = FadeInUp.withInitialValues({ opacity: 0, transform: [{ translateY: -8 }] }).duration(240).easing(Easing.out(Easing.cubic));
const FOLD = FadeOutUp.duration(200).easing(Easing.out(Easing.cubic));
const cardIn = (i: number) => FadeInDown.withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] }).springify().duration(motion.spring.duration).dampingRatio(1).delay(120 + Math.min(i, 8) * motion.stagger);
// Your care team rises in once per launch, not on every return to the tab.
let seen = false;

/**
 * Doctors (the AI Health Companion kit): the patient's own first. "Your / care team" as the kit's doctor
 * cards opening Doctor details, then "Your / records" as kit form rows (only what the discharge plan
 * really holds), then one compact "Find another doctor" row that opens the hospital's directory in
 * place: a search field, a row of white filter capsules (All, Care team, Top rated, For you from the
 * patient's own plan) with the selected one in ink, and a two-column grid of doctor cards. The home pill
 * says the doctors are fictional. SYNTHETIC doctors; see features/doctors/data.
 */
export default function Doctors() {
  const still = useReducedMotion();
  const lang = useLang(), t = tFor(lang);
  const { fontScale } = useWindowDimensions();
  const plan = useDischarge().data;
  // The hospital's directory with each doctor's free slots (SYNTHETIC doctors in the demo).
  const { state } = useMe();
  const doctors = useQuery({ ...orpc.care.doctors.list.queryOptions(), enabled: state === "joined" });
  const [finding, setFinding] = useState(false);
  const [tab, setTab] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  // Once the patient has opened the directory, switched a tab or searched, cards appear in place (no entrance per change).
  const [touched, setTouched] = useState(() => seen);
  useEffect(() => { seen = true; }, []);
  // The directory's cards stagger in only as it opens; a tab switch or search swaps them in place.
  const [opening, setOpening] = useState(false);
  const pick = (to: Filter) => { setTab(to); setOpening(false); };
  const search = (q: string) => { setQuery(q); setOpening(false); };
  // "For you" reads the English leaflet (the doctors' tags are English words), e.g. "chest infection … breathing".
  const words = plan?.status === "discharged" ? plan.leaflets.find(l => l.language === "en")?.text ?? "" : "";
  const team = listFor(doctors.data ?? [], "care-team");
  const list = searchDoctors(listFor(doctors.data ?? [], tab, words), query);
  const enter = (i: number) => still || touched ? undefined : rise(i);
  const width = fontScale > 1.3 ? "100%" : "48.2%";

  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    contentContainerStyle={{ padding: space.edge, paddingTop: space.top, paddingBottom: DOCK_SPACE, gap: space.stack }}>
    <Animated.View entering={enter(0)}><Title greeting={t("doc.titleLight")}>{t("doc.titleBold")}</Title></Animated.View>

    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 }}>
      {team.map((d, i) => <Animated.View key={d.id} entering={enter(1 + i)} style={{ width }}>
        <DoctorCard doctor={d} badge={false} />
      </Animated.View>)}
    </View>
    {doctors.isLoading && <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start" }} />}
    {!doctors.data && doctors.error && <LoadError query={doctors} />}
    {doctors.data && !team.length && <Text style={{ ...type.body, color: palette.muted }}>{t("doc.noTeam")}</Text>}

    <Animated.View entering={enter(1 + team.length)} style={{ gap: 10, marginTop: 8 }}>
      <Section light={t("doc.recordsLight")} bold={t("doc.recordsBold")} />
      {plan?.status === "discharged" ? <>
        <RecordRow icon={DOC} title={t("doc.plan")} value={dayLabel(plan.dischargedAt, lang)} spoken={t("doc.planA11y", { day: dayLabel(plan.dischargedAt, lang), line: takeLine(plan.medicines, "", lang) })} />
        {plan.leaflets[0] && <RecordRow icon={BOOK} title={t("doc.leaflet")} value={plan.leaflets.map(l => l.name).join(", ")}
          spoken={t("doc.leafletA11y", { names: listOf(plan.leaflets.map(l => l.name), lang) })} />}
      </>
        : <Text style={{ ...type.body, color: palette.muted }}>{plan ? t("doc.papersLater") : t("doc.papers")}</Text>}
    </Animated.View>

    {/* The directory, one tap away: search and filters live with it. */}
    <Animated.View entering={enter(2 + team.length)} style={{ marginTop: 8 }}>
      <RecordRow icon={SEARCH} title={t("doc.find")} value="" spoken={t("doc.find")} hint={t("doc.findHint")}
        expanded={finding} onPress={() => { setOpening(!finding); setFinding(!finding); setTouched(true); }} />
    </Animated.View>
    {finding && <Animated.View exiting={still ? undefined : FOLD} style={{ gap: space.stack }}>
      <Animated.View entering={still ? undefined : UNFOLD} style={{ gap: space.stack }}>
      <TextInput value={query} onChangeText={search} placeholder={t("doc.searchPlaceholder")} placeholderTextColor={palette.muted} returnKeyType="search"
        clearButtonMode="while-editing" autoCorrect={false} accessibilityLabel={t("doc.searchLabel")} style={{ ...field, borderRadius: 999, backgroundColor: palette.white }} />
      <Tabs tab={tab} still={still} onPick={pick} />
      </Animated.View>
      {tab === "for-you" && words !== "" && <Text style={{ ...type.footnote, color: palette.muted, marginTop: -6 }}>{t("doc.matched")}</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 }}>
        {list.map((d, i) => <Animated.View key={d.id} entering={opening && !still ? cardIn(i) : undefined} style={{ width }}><DoctorCard doctor={d} /></Animated.View>)}
      </View>
      {doctors.data && !list.length && <Card>
        <Text style={{ ...type.body, color: palette.muted }}>
          {query.trim() ? t("doc.noMatch", { q: query.trim() }) : tab === "for-you" ? t("doc.nothingForYou") : t("doc.none")}
        </Text>
      </Card>}
    </Animated.View>}
  </ScrollView>;
}

/**
 * The filter: a row of white capsules; the selected one is an ink capsule (white label) that slides to
 * the tab picked, carrying its label. The capsules underneath stay put.
 */
function Tabs({ tab, still, onPick }: { tab: Filter; still: boolean; onPick: (t: Filter) => void }) {
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

/** A doctor in the grid (kit card): the initials avatar, the name on two lines, the specialty, then rating and next clinic in a white capsule. `badge`: the Care team capsule (off under "Your care team"). */
function DoctorCard({ doctor: d, badge = true }: { doctor: ListedDoctor; badge?: boolean }) {
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

/** A kit form row (icon, label, value, chevron): a record opening the plan, or (`onPress`, `expanded`) the directory's toggle. */
function RecordRow({ icon, title, value, spoken, hint, expanded, onPress }: { icon: string; title: string; value: string; spoken: string; hint?: string; expanded?: boolean; onPress?: () => void }) {
  const t = useT();
  const still = useReducedMotion();
  return <Pressable accessibilityRole="button" accessibilityLabel={spoken} accessibilityHint={hint ?? t("doc.recordHint")} accessibilityState={expanded === undefined ? undefined : { expanded }}
    onPress={onPress ?? (() => router.push("/discharge"))}
    style={({ pressed }) => [surfaceStyle, { borderRadius: 20, minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><Path d={icon} /></Svg>
    <Text style={{ ...type.body, fontWeight: "500", color: palette.ink }}>{title}</Text>
    <Text numberOfLines={1} style={{ flex: 1, ...type.footnote, color: palette.muted, textAlign: "right" }}>{value}</Text>
    <Animated.Text style={{ fontSize: 20, color: palette.faint, transform: [{ rotate: expanded ? "90deg" : "0deg" }], transitionProperty: "transform", transitionDuration: still ? 0 : 240, transitionTimingFunction: "ease-out" }}>›</Animated.Text>
  </Pressable>;
}

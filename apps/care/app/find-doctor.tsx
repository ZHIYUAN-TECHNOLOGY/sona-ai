import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, ScrollView, useWindowDimensions, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, useReducedMotion } from "react-native-reanimated";
import { useDischarge } from "@/features/discharge/row";
import { listFor, searchDoctors, type Filter } from "@/features/doctors/data";
import { DoctorCard, Tabs } from "@/features/doctors/directory";
import { useMe } from "@/features/me";
import { tFor, useLang } from "@/lib/i18n";
import { Text, TextInput } from "@/lib/text";
import { motion, palette, space, type } from "@/lib/theme";
import { BackButton, Card, field, LoadError, Title } from "@/lib/ui";
import { orpc } from "@/utils/orpc";

/**
 * Find a doctor: the hospital's whole directory as its own page, opened from Doctors' "Find another doctor" row.
 * Back, the title, a search field, the filter capsules (All, Care team, Top rated, For you from the patient's own
 * plan) and a two-column grid of doctor cards, each opening Doctor details. SYNTHETIC doctors (features/doctors/data).
 *
 * Motion after three 60fps shots: the page arrives as Google's search morph does (the search field rises first,
 * then the filters, fast and without bounce, so the row tapped reads as becoming the search); the cards follow
 * Swiggy's results (fade up 12 pt, 40 ms apart, the first eight); a filter press is Airbnb's tactile tab (the
 * capsule gives under the finger, the ink capsule springs across) with the cards crossfading in place. Reduce Motion:
 * nothing moves.
 */
const arrive = (i: number) => FadeInDown.withInitialValues({ opacity: 0, transform: [{ translateY: 10 }] }).duration(280).easing(Easing.out(Easing.cubic)).delay(i * 60);
const cardIn = (i: number) => FadeInDown.withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] }).springify().duration(motion.spring.duration).dampingRatio(1).delay(180 + Math.min(i, 8) * motion.stagger);

export default function FindDoctor() {
  const still = useReducedMotion();
  const lang = useLang(), t = tFor(lang);
  const { fontScale } = useWindowDimensions();
  const plan = useDischarge().data;
  const { state } = useMe();
  const doctors = useQuery({ ...orpc.care.doctors.list.queryOptions(), enabled: state === "joined" });
  const [tab, setTab] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  // The cards rise in only as the page opens; a filter or a search swaps them in place.
  const [first, setFirst] = useState(true);
  // "For you" reads the English leaflet (the doctors' tags are English words), e.g. "chest infection … breathing".
  const words = plan?.status === "discharged" ? plan.leaflets.find(l => l.language === "en")?.text ?? "" : "";
  const list = searchDoctors(listFor(doctors.data ?? [], tab, words), query);
  const width = fontScale > 1.3 ? "100%" : "48.2%";
  const enter = (i: number) => still ? undefined : arrive(i);

  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    contentContainerStyle={{ padding: space.edge, paddingTop: space.top, paddingBottom: 40, gap: space.stack }}>
    <BackButton />
    <Animated.View entering={enter(0)}><Title greeting={t("doc.findLight")}>{t("doc.findBold")}</Title></Animated.View>
    <Animated.View entering={enter(1)}>
      <TextInput value={query} onChangeText={q => { setQuery(q); setFirst(false); }} placeholder={t("doc.searchPlaceholder")} placeholderTextColor={palette.muted} returnKeyType="search"
        clearButtonMode="while-editing" autoCorrect={false} accessibilityLabel={t("doc.searchLabel")} style={{ ...field, borderRadius: 999, backgroundColor: palette.white }} />
    </Animated.View>
    <Animated.View entering={enter(2)}><Tabs tab={tab} still={still} onPick={to => { setTab(to); setFirst(false); }} /></Animated.View>
    {tab === "for-you" && words !== "" && <Text style={{ ...type.footnote, color: palette.muted, marginTop: -6 }}>{t("doc.matched")}</Text>}
    {doctors.isLoading && <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start" }} />}
    {!doctors.data && doctors.error && <LoadError query={doctors} />}
    {/* Keyed by the filter and search, so a change crossfades the grid rather than reshuffling cards. */}
    <View key={`${tab}:${query}`} style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 }}>
      {list.map((d, i) => <Animated.View key={d.id} entering={still ? undefined : first ? cardIn(i) : FadeIn.duration(200)} style={{ width }}><DoctorCard doctor={d} /></Animated.View>)}
    </View>
    {doctors.data && !list.length && <Card>
      <Text style={{ ...type.body, color: palette.muted }}>
        {query.trim() ? t("doc.noMatch", { q: query.trim() }) : tab === "for-you" ? t("doc.nothingForYou") : t("doc.none")}
      </Text>
    </Card>}
  </ScrollView>;
}

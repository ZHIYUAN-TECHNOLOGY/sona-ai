import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, ScrollView, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { useDischarge } from "@/features/discharge/row";
import { listFor, searchDoctors, type Filter } from "@/features/doctors/data";
import { DoctorCard, Tabs } from "@/features/doctors/directory";
import { useMe } from "@/features/me";
import { tFor, useLang } from "@/lib/i18n";
import { Text, TextInput } from "@/lib/text";
import { palette, space, type } from "@/lib/theme";
import { BackButton, Card, field, LoadError, Title } from "@/lib/ui";
import { orpc } from "@/utils/orpc";

/**
 * Find a doctor: the hospital's whole directory as its own page, opened from Doctors' "Find another doctor" row.
 * Back, the title, a search field, the filter capsules (All, Care team, Top rated, For you from the patient's own
 * plan) and a two-column grid of doctor cards, each opening Doctor details. SYNTHETIC doctors (features/doctors/data).
 *
 * Motion: the row tapped zooms into this page (iOS 18+ native zoom, after Google's search morph on 60fps: the row
 * becomes the search), so the page mounts whole and still under it; nothing of its own animates during the zoom.
 * A filter press is Airbnb's tactile tab (the capsule gives under the finger, the ink capsule springs across) with
 * the cards crossfading in place, as a search does. Reduce Motion: nothing moves.
 */

export default function FindDoctor() {
  const still = useReducedMotion();
  const lang = useLang(), t = tFor(lang);
  const { fontScale } = useWindowDimensions();
  const plan = useDischarge().data;
  const { state } = useMe();
  const doctors = useQuery({ ...orpc.care.doctors.list.queryOptions(), enabled: state === "joined" });
  const [tab, setTab] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  // "For you" reads the condition the English leaflet names ("You were treated for a chest infection"); see listFor.
  const words = plan?.status === "discharged" ? plan.leaflets.find(l => l.language === "en")?.text ?? "" : "";
  const list = searchDoctors(listFor(doctors.data ?? [], tab, words), query);
  const width = fontScale > 1.3 ? "100%" : "48.2%";

  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    contentContainerStyle={{ padding: space.edge, paddingTop: space.top, paddingBottom: 40, gap: space.stack }}>
    <BackButton />
    <Title greeting={t("doc.findLight")}>{t("doc.findBold")}</Title>
    <View>
      <TextInput value={query} onChangeText={setQuery} placeholder={t("doc.searchPlaceholder")} placeholderTextColor={palette.muted} returnKeyType="search"
        clearButtonMode="while-editing" autoCorrect={false} accessibilityLabel={t("doc.searchLabel")} style={{ ...field, borderRadius: 999, backgroundColor: palette.white }} />
    </View>
    <Tabs tab={tab} still={still} onPick={setTab} />
    {tab === "for-you" && words !== "" && <Text style={{ ...type.footnote, color: palette.muted, marginTop: -6 }}>{t("doc.matched")}</Text>}
    {doctors.isLoading && <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start" }} />}
    {!doctors.data && doctors.error && <LoadError query={doctors} />}
    {/* Keyed by the filter and search, so a change crossfades the grid rather than reshuffling cards; the first grid is just there. */}
    <View key={`${tab}:${query}`} style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 }}>
      {list.map(d => <Animated.View key={d.id} entering={still || (tab === "all" && !query) ? undefined : FadeIn.duration(200)} style={{ width }}><DoctorCard doctor={d} /></Animated.View>)}
    </View>
    {doctors.data && !list.length && <Card>
      <Text style={{ ...type.body, color: palette.muted }}>
        {query.trim() ? t("doc.noMatch", { q: query.trim() }) : tab === "for-you" ? t("doc.nothingForYou") : t("doc.none")}
      </Text>
    </Card>}
  </ScrollView>;
}

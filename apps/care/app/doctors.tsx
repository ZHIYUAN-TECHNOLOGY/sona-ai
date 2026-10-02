import { useQuery } from "@tanstack/react-query";
import { Link, router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import Animated, { Easing, FadeInDown, useReducedMotion } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { listOf, takeLine } from "@/features/discharge/lines";
import { tFor, useLang, useT } from "@/lib/i18n";
import { useDischarge } from "@/features/discharge/row";
import { listFor } from "@/features/doctors/data";
import { DoctorCard } from "@/features/doctors/directory";
import { useMe } from "@/features/me";
import { dayLabel } from "@/features/follow-ups/lines";
import { DOCK_SPACE } from "@/lib/dock";
import { Text } from "@/lib/text";
import { palette, space, type } from "@/lib/theme";
import { field, Section, surfaceStyle, Title, LoadError } from "@/lib/ui";
import { orpc } from "@/utils/orpc";

const SEARCH = "M11 19a8 8 0 1 0 0-16a8 8 0 0 0 0 16M21 21l-4.3-4.3";
const DOC = "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5";
const BOOK = "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20";
/** First appearance: a 40 ms ease-out stagger (60fps Vakitler); still under Reduce Motion, and never on a tab switch or search. */
const rise = (i: number) => FadeInDown.duration(360).easing(Easing.out(Easing.cubic)).delay(i * 40);
// Your care team rises in once per launch, not on every return to the tab.
let seen = false;

/**
 * Doctors (the AI Health Companion kit): the patient's own first. "Your / care team" as the kit's doctor
 * cards opening Doctor details, then "Your / records" as kit form rows (only what the discharge plan
 * really holds), then one compact "Find another doctor" row that opens the hospital's directory as its
 * own page (app/find-doctor). The home pill
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
  // Once the patient has seen their care team, it appears in place on later visits (no entrance each time).
  const [touched] = useState(() => seen);
  useEffect(() => { seen = true; }, []);
  const team = listFor(doctors.data ?? [], "care-team");
  const enter = (i: number) => still || touched ? undefined : rise(i);
  const width = fontScale > 1.3 ? "100%" : "48.2%";

  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    contentContainerStyle={{ padding: space.edge, paddingTop: space.top, paddingBottom: DOCK_SPACE, gap: space.stack }}>
    {/* Finding a doctor is the page's one action, so it comes first, at a glance, as the search it opens (it zooms into
        the directory page on iOS 18+; elsewhere the stack's crossfade); the patient's own care team follows. */}
    <Animated.View entering={enter(0)}><Link href="/find-doctor" asChild><FindBar /></Link></Animated.View>
    <Animated.View entering={enter(1)} style={{ marginTop: 4 }}><Title greeting={t("doc.titleLight")}>{t("doc.titleBold")}</Title></Animated.View>

    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 }}>
      {team.map((d, i) => <Animated.View key={d.id} entering={enter(2 + i)} style={{ width }}>
        <DoctorCard doctor={d} badge={false} />
      </Animated.View>)}
    </View>
    {doctors.isLoading && <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start" }} />}
    {!doctors.data && doctors.error && <LoadError query={doctors} />}
    {doctors.data && !team.length && <Text style={{ ...type.body, color: palette.muted }}>{t("doc.noTeam")}</Text>}

    <Animated.View entering={enter(2 + team.length)} style={{ gap: 10, marginTop: 8 }}>
      <Section light={t("doc.recordsLight")} bold={t("doc.recordsBold")} />
      {plan?.status === "discharged" ? <>
        <RecordRow icon={DOC} title={t("doc.plan")} value={dayLabel(plan.dischargedAt, lang)} spoken={t("doc.planA11y", { day: dayLabel(plan.dischargedAt, lang), line: takeLine(plan.medicines, "", lang) })} />
        {plan.leaflets[0] && <RecordRow icon={BOOK} title={t("doc.leaflet")} value={plan.leaflets.map(l => l.name).join(", ")}
          spoken={t("doc.leafletA11y", { names: listOf(plan.leaflets.map(l => l.name), lang) })} />}
      </>
        : <Text style={{ ...type.body, color: palette.muted }}>{plan ? t("doc.papersLater") : t("doc.papers")}</Text>}
    </Animated.View>
  </ScrollView>;
}

/**
 * Find a doctor, the page's call to action: a white search capsule in the field's own look (so it reads as the search it
 * opens), a blue search glyph, "Find a doctor" over "Name or specialty", and an ink arrow. Inside a Link (the press);
 * the zoom source sits inside the button in a plain unflattened wrapper, so VoiceOver keeps one labelled button.
 */
function FindBar({ onPress }: { onPress?: () => void }) {
  const t = useT();
  return <Pressable accessibilityRole="button" accessibilityLabel={t("doc.findCta")} accessibilityHint={t("doc.findHint")} onPress={onPress}
    style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}>
    <Link.AppleZoom><View collapsable={false}>
      <View style={{ ...field, borderRadius: 999, minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 18, paddingRight: 8, boxShadow: "0 12px 26px -16px rgba(51,92,255,0.45)" }}>
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={palette.blue} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d={SEARCH} /></Svg>
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.body, fontWeight: "600", color: palette.ink }}>{t("doc.findCta")}</Text>
          <Text numberOfLines={1} style={{ ...type.footnote, color: palette.muted }}>{t("doc.searchPlaceholder")}</Text>
        </View>
        <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: palette.dark }}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={palette.white} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 12h14M13 6l6 6-6 6" /></Svg>
        </View>
      </View>
    </View></Link.AppleZoom>
  </Pressable>;
}

/** A kit form row (icon, label, value, chevron): a record opening the plan. */
function RecordRow({ icon, title, value, spoken, hint, onPress }: { icon: string; title: string; value: string; spoken: string; hint?: string; onPress?: () => void }) {
  const t = useT();
  return <Pressable accessibilityRole="button" accessibilityLabel={spoken} accessibilityHint={hint ?? t("doc.recordHint")}
    onPress={onPress ?? (() => router.push("/discharge"))}
    style={({ pressed }) => [surfaceStyle, { borderRadius: 20, minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><Path d={icon} /></Svg>
    <Text style={{ ...type.body, fontWeight: "500", color: palette.ink }}>{title}</Text>
    <Text numberOfLines={1} style={{ flex: 1, ...type.footnote, color: palette.muted, textAlign: "right" }}>{value}</Text>
    <Text style={{ fontSize: 20, color: palette.faint }}>›</Text>
  </Pressable>;
}

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
import { Section, surfaceStyle, Title, LoadError } from "@/lib/ui";
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

    {/* The whole directory is its own page (search, filters, every doctor). */}
    <Animated.View entering={enter(2 + team.length)} style={{ marginTop: 8 }}>
      {/* The row zooms into the directory page (iOS 18+ native zoom; elsewhere the stack's crossfade). */}
      <Link href="/find-doctor" asChild><RecordRow icon={SEARCH} title={t("doc.find")} value="" spoken={t("doc.find")} hint={t("doc.findHint")} zoom /></Link>
    </Animated.View>
  </ScrollView>;
}

/** A kit form row (icon, label, value, chevron): a record opening the plan, or the directory (inside a Link; `zoom`: the row zooms into its page). */
function RecordRow({ icon, title, value, spoken, hint, onPress, zoom = false }: { icon: string; title: string; value: string; spoken: string; hint?: string; onPress?: () => void; zoom?: boolean }) {
  const t = useT();
  // The zoom source takes exactly one native view and restyles it, so the row's face sits in a plain unflattened wrapper.
  const face = <View style={[surfaceStyle, { borderRadius: 20, minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 }]}>
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><Path d={icon} /></Svg>
    <Text style={{ ...type.body, fontWeight: "500", color: palette.ink }}>{title}</Text>
    <Text numberOfLines={1} style={{ flex: 1, ...type.footnote, color: palette.muted, textAlign: "right" }}>{value}</Text>
    <Text style={{ fontSize: 20, color: palette.faint }}>›</Text>
  </View>;
  // The zoom source sits inside the button, so VoiceOver keeps the row as one labelled button.
  return <Pressable accessibilityRole="button" accessibilityLabel={spoken} accessibilityHint={hint ?? t("doc.recordHint")}
    onPress={onPress ?? (() => router.push("/discharge"))} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}>
    {zoom ? <Link.AppleZoom><View collapsable={false}>{face}</View></Link.AppleZoom> : face}
  </Pressable>;
}

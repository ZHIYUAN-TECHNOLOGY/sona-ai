import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { upcomingOf } from "@/features/check-ins/model";
import { useCheckIns } from "@/features/check-ins/today";
import { changeOf, homeLine, listOf, scheduleLine, takeLine, type Discharged, type Group, type Med } from "@/features/discharge/lines";
import "@/features/doses/strings";
import { tFor, useLang } from "@/lib/i18n";
import { Tag, useDischarge } from "@/features/discharge/row";
import { Pill, rise, tintOf, useNow } from "@/features/doses";
import { dayLabel } from "@/features/follow-ups/lines";
import { daysHome } from "@/features/home";
import { Text } from "@/lib/text";
import { motion, palette, type } from "@/lib/theme";
import { BackButton, Card, pillStyle, Row, Section, surfaceStyle, Title, LoadError, inkPill } from "@/lib/ui";

const GROUPS: Group[] = ["new", "changed", "continue", "stopped"];
const open = (name: string) => router.push({ pathname: "/medicine", params: { name } });

/**
 * My plan (the discharge plan in full, after the AI Health Companion kit): the insight line, then every
 * medicine with what the stay did to it (new, changed, stopped as capsules), each opening its sheet;
 * the leaflet in the patient's language, the warning signs, and what comes next. Sections rise on a
 * 40 ms ease-out stagger; still under Reduce Motion.
 */
export default function DischargeScreen() {
  const query = useDischarge(), { data, error, isLoading } = query;
  const reduced = useReducedMotion();
  const lang = useLang(), t = tFor(lang);
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 48, gap: 16 }}>
    <Animated.View entering={rise(reduced, 0)} style={{ gap: 16 }}>
      <BackButton />
      <Title greeting={t("dis.titleLight")} accent={t("dis.titleBold")} line={data?.status === "discharged" ? takeLine(data.medicines, homeLine(daysHome(data.dischargedAt), lang), lang) : undefined} />
    </Animated.View>
    {isLoading && <ActivityIndicator color={palette.muted} />}
    {!data && error && <LoadError query={query} />}
    {data?.status === "in-hospital" && <Card feature>
      <Text style={{ ...type.headline, color: palette.ink }}>{t("dis.inHospital")}</Text>
      <Text style={{ ...type.body, color: palette.muted }}>{t("dis.inHospitalLine")}</Text>
    </Card>}
    {data?.status === "discharged" && <Plan plan={data} reduced={reduced} />}
  </ScrollView>;
}

function Plan({ plan, reduced }: { plan: Discharged; reduced: boolean }) {
  const lang = useLang(), t = tFor(lang);
  const [picked, setPicked] = useState<string>();
  // The leaflet in the language Sona Care speaks, else the one chosen at discharge.
  const leaflet = plan.leaflets.find(l => l.language === (picked ?? lang)) ?? plan.leaflets.find(l => l.language === plan.language) ?? plan.leaflets[0]!;
  const meds = GROUPS.flatMap(group => plan.medicines[group].map(m => ({ ...m, group })));
  // The check-ins still to come, from the visit's rows: a day the follow-up agent added is there, a past one is not.
  const now = useNow(), rows = useCheckIns().data;
  const upcoming = rows && upcomingOf(rows, now);

  return <>
    <Animated.View entering={rise(reduced, 1)} style={{ gap: 12 }}>
      <Section light={t("dis.medsLight")} bold={t("dis.medsBold")} />
      {meds.length ? <View style={[surfaceStyle, { paddingHorizontal: 14 }]}>
        {meds.map((m, i) => <MedRow key={m.name} med={m} first={i === 0} />)}
      </View> : <Text style={{ ...type.body, color: palette.muted }}>{t("dose.nothingAtHome")}</Text>}
    </Animated.View>

    <Animated.View entering={rise(reduced, 2)} style={{ gap: 12 }}>
      <Section light={t("dis.leafletLight")} bold={t("dis.leafletBold")} />
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {plan.leaflets.map(l => {
            const on = l.language === leaflet.language;
            return <Pressable key={l.language} accessibilityRole="button" accessibilityLabel={l.name} accessibilityState={{ selected: on }} onPress={() => setPicked(l.language)}
              style={({ pressed }) => [pillStyle, { minHeight: 48, minWidth: 56, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? motion.press : 1 }] }, on && inkPill]}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: on ? palette.white : palette.ink }}>{l.label}</Text>
            </Pressable>;
          })}
        </View>
        <Text style={{ ...type.body, color: palette.ink }}>{leaflet.text}</Text>
      </Card>
    </Animated.View>

    <Animated.View entering={rise(reduced, 3)} style={{ gap: 12 }}>
      <Section light={t("dis.helpLight")} bold={t("dis.helpBold")} />
      <Card>
        <Text accessibilityRole="header" style={{ ...type.headline, color: palette.red }}>{t("dis.call999")}</Text>
        {plan.warningSigns.map(sign => <Text key={sign} style={{ ...type.body, color: palette.ink }}>•  {sign}</Text>)}
      </Card>
    </Animated.View>

    <Animated.View entering={rise(reduced, 4)} style={{ gap: 12 }}>
      <Section light={t("dis.nextLight")} bold={t("dis.nextBold")} />
      <Card style={{ paddingVertical: 6 }}>
        {plan.followUp && <Row first title={plan.followUp.title} line={dayLabel(plan.followUp.date, lang)} onPress={() => router.push("/follow-ups")} />}
        {upcoming && <Row first={!plan.followUp} title={t("dis.checkIns")} onPress={() => router.push("/check-ins")}
          line={upcoming.length ? t("dis.weMessage", { dates: listOf(upcoming.map(c => dayLabel(c.dueAt, lang)), lang) }) : t("ci.allDone")} />}
      </Card>
    </Animated.View>
  </>;
}

/** One medicine: its pill on its tint, the name (struck through when stopped), its schedule, and a capsule for what the stay changed. */
function MedRow({ med, first }: { med: Med & { group: Group }; first: boolean }) {
  const lang = useLang(), t = tFor(lang);
  const stopped = med.group === "stopped", line = stopped ? med.line : scheduleLine(med, lang);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${med.name}. ${changeOf(med.group, lang)}. ${line}`} accessibilityHint={t("dose.openHint")} onPress={() => open(med.name)}
    style={({ pressed }) => ({ minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderColor: palette.line, opacity: pressed ? 0.6 : 1 })}>
    <View style={{ width: 48, height: 48, borderRadius: 16, borderCurve: "continuous", backgroundColor: tintOf(med.name), alignItems: "center", justifyContent: "center", opacity: stopped ? 0.55 : 1 }}>
      <Pill name={med.name} size={44} />
    </View>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ ...type.headline, color: stopped ? palette.muted : palette.ink, textDecorationLine: stopped ? "line-through" : "none" }}>{med.name}</Text>
      <Text style={{ ...type.footnote, color: palette.faint }}>{line}</Text>
    </View>
    {med.group !== "continue" && <Tag group={med.group} />}
    <Text style={{ fontSize: 20, color: palette.pale }}>›</Text>
  </Pressable>;
}

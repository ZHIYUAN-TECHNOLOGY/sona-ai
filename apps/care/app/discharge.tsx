import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View, type ViewStyle } from "react-native";
import Animated, { Easing, FadeInDown, useReducedMotion } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { errorText } from "@/features/errors";
import { changeSummary, homeLine, scheduleLine, takeLine, type Discharged, type Group, type Med } from "@/features/discharge/lines";
import { useDischarge } from "@/features/discharge/row";
import { Pill } from "@/features/doses";
import { dayLabel } from "@/features/follow-ups/lines";
import { daysHome } from "@/features/home";
import { useMe } from "@/features/me";
import { DOCK_SPACE } from "@/lib/dock";
import { accent, palette, type } from "@/lib/theme";
import { Card, Chip, CircleButton, ICON, Row, surfaceStyle, Title } from "@/lib/ui";

/** Sections and cards rise in on a 40 ms ease-out stagger the first time; still under Reduce Motion. */
const rise = (reduced: boolean, i: number) => reduced ? undefined : FadeInDown.duration(360).easing(Easing.out(Easing.cubic)).delay(i * 40);

const TAGS = {
  new: { label: "New", bg: palette.blueWash, fg: palette.blue },
  changed: { label: "Changed", bg: palette.amberWash, fg: palette.amber },
  stopped: { label: "Stopped", bg: palette.mutedWash, fg: palette.muted },
} as const;

const open = (name: string) => router.push({ pathname: "/medicine", params: { name } });

/**
 * My medicines (Lumi kit, "Your Medicines"): the insight line, the care team one tap away, what the
 * stay changed as chips, then a grid of the medicines to take, each opening its sheet; stopped ones as
 * one quiet line. Then the leaflet in their language, the warning signs, and what comes next.
 */
export default function DischargeScreen() {
  const { data, error, isLoading } = useDischarge();
  const reduced = useReducedMotion();
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: DOCK_SPACE, gap: 16 }}>
    <Animated.View entering={rise(reduced, 0)}>
      <Title greeting="Your" accent="Medicines" line={data?.status === "discharged" ? takeLine(data.medicines, homeLine(daysHome(data.dischargedAt))) : undefined} />
    </Animated.View>
    {isLoading && <ActivityIndicator color={palette.muted} />}
    {error && <Text style={{ ...type.body, color: palette.red }}>{errorText(error)}</Text>}
    {data?.status === "in-hospital" && <Card feature>
      <Text style={{ ...type.headline, color: palette.ink }}>You're still in hospital</Text>
      <Text style={{ ...type.body, color: palette.muted }}>Your medicines, leaflet and warning signs show here once you go home.</Text>
    </Card>}
    {data?.status === "discharged" && <Plan plan={data} reduced={reduced} />}
  </ScrollView>;
}

function Plan({ plan, reduced }: { plan: Discharged; reduced: boolean }) {
  const { fontScale } = useWindowDimensions();
  const [picked, setPicked] = useState<string>();
  const leaflet = plan.leaflets.find(l => l.language === (picked ?? plan.language)) ?? plan.leaflets[0]!;
  const meds = (["new", "changed", "continue"] as const).flatMap(group => plan.medicines[group].map(m => ({ ...m, group })));
  const { stopped } = plan.medicines, changes = changeSummary(plan.medicines);
  let i = 1; // stagger order

  return <>
    <Animated.View entering={rise(reduced, i++)}><CareTeam /></Animated.View>

    {changes.length > 0 && <Animated.View entering={rise(reduced, i++)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {changes.map(s => <Chip key={s.group} label={s.label} tone={TAGS[s.group]} onPress={() => open(s.first)}
        accessibilityLabel={`${s.label}: ${plan.medicines[s.group].map(m => m.name).join(", ")}. Opens ${s.first}`} />)}
    </Animated.View>}

    {/* Two columns; at large Dynamic Type, one card per row so names never squeeze. */}
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 }}>
      {meds.map(m => <Animated.View key={m.name} entering={rise(reduced, i++)} style={{ width: fontScale > 1.3 ? "100%" : "48.2%" }}>
        <MedCard med={m} />
      </Animated.View>)}
    </View>
    {!meds.length && <Text style={{ ...type.body, color: palette.muted }}>Nothing to take at home.</Text>}
    {stopped.length > 0 && <Animated.View entering={rise(reduced, i++)} accessible accessibilityLabel={`Stopped: ${stopped.map(m => `${m.name}. ${m.line}`).join(". ")}`} style={{ paddingHorizontal: 6 }}>
      <Text style={{ ...type.footnote, color: palette.muted }}>
        <Text style={{ fontWeight: "700", color: palette.ink }}>Stopped: </Text>
        {stopped.map((m, n) => <Text key={m.name}>{n ? " · " : ""}<Text style={{ textDecorationLine: "line-through" }}>{m.name}</Text> · {m.line}</Text>)}
      </Text>
    </Animated.View>}

    <Animated.View entering={rise(reduced, i++)}>
      <Card>
        <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>Your leaflet</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {plan.leaflets.map(l => {
            const on = l.language === leaflet.language;
            return <Pressable key={l.language} accessibilityRole="button" accessibilityLabel={l.name} accessibilityState={{ selected: on }} onPress={() => setPicked(l.language)}
              style={({ pressed }) => ({ minHeight: 44, minWidth: 56, paddingHorizontal: 16, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: on ? palette.dark : "rgba(255,255,255,0.86)", transform: [{ scale: pressed ? 0.96 : 1 }] })}>
              <Text style={{ ...type.footnote, fontWeight: "600", color: on ? palette.white : palette.ink }}>{l.label}</Text>
            </Pressable>;
          })}
        </View>
        <Text style={{ ...type.body, color: palette.ink }}>{leaflet.text}</Text>
      </Card>
    </Animated.View>

    <Animated.View entering={rise(reduced, i++)}>
      <Card>
        <Text accessibilityRole="header" style={{ ...type.headline, color: palette.red }}>Call 999 or go to the emergency department if</Text>
        {plan.warningSigns.map(sign => <Text key={sign} style={{ ...type.body, color: palette.ink }}>•  {sign}</Text>)}
      </Card>
    </Animated.View>

    <Animated.View entering={rise(reduced, i++)}>
      <Card style={{ paddingVertical: 6 }}>
        {plan.followUp && <Row first title={plan.followUp.title} line={dayLabel(plan.followUp.date)} onPress={() => router.push("/follow-ups")} />}
        <Row first={!plan.followUp} title="Check-ins" line={`We'll message you ${plan.checkIns.map(c => dayLabel(c.date)).join(" and ")}`} onPress={() => router.push("/check-ins")} />
      </Card>
    </Animated.View>
  </>;
}

/** The kit's contact row: the care team (a heart on the accent) and a round chat button, the quick way to ask about a medicine. */
function CareTeam() {
  const { me } = useMe();
  return <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 12 }}>
    <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", experimental_backgroundImage: `linear-gradient(135deg, ${accent[0]}, ${accent[2]})` } as ViewStyle}>
      <Svg width={22} height={22} viewBox="0 0 24 24"><Path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" fill={palette.white} /></Svg>
    </View>
    <View accessible style={{ flex: 1, gap: 1 }}>
      <Text style={{ ...type.headline, color: palette.ink }}>Your care team</Text>
      {me?.hospital && <Text numberOfLines={2} style={{ ...type.footnote, color: palette.muted }}>{me.hospital}</Text>}
    </View>
    <CircleButton d={ICON.chat} label="Message your care team" onPress={() => router.push("/messages")} />
  </Card>;
}

/** One medicine in the grid (Lumi kit): a tall grey card, the medicine drawn big, its name and plain schedule centred, and a tag for what the stay did (same needs none). */
function MedCard({ med }: { med: Med & { group: Exclude<Group, "stopped"> } }) {
  const tag = med.group === "continue" ? undefined : TAGS[med.group], schedule = scheduleLine(med);
  return <Pressable accessibilityRole="button" accessibilityLabel={[med.name, schedule, tag?.label].filter(Boolean).join(". ")} accessibilityHint="Opens how to take it" onPress={() => open(med.name)}
    style={({ pressed }) => [surfaceStyle, { flexGrow: 1, minHeight: 220, padding: 14, paddingBottom: 18, alignItems: "center", gap: 4, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
    <Pill name={med.name} size={110} />
    <Text style={{ fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.3, color: palette.ink, textAlign: "center" }}>{med.name}</Text>
    <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>{schedule}</Text>
    {tag && <View style={{ marginTop: 6, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: tag.bg }}>
      <Text style={{ fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", color: tag.fg }}>{tag.label}</Text>
    </View>}
  </Pressable>;
}

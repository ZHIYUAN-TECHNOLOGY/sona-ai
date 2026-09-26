import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { errorText } from "@/features/errors";
import type { Discharged } from "@/features/discharge/lines";
import { useDischarge } from "@/features/discharge/row";
import { dayLabel } from "@/features/follow-ups/lines";
import { palette, type } from "@/lib/theme";
import { Card, Row, Title } from "@/lib/ui";

/**
 * The discharge plan for the patient: what to take today first (the feature card), then the leaflet in
 * their language, when to come back, and what happens next. Each part is short; the leaflet holds the detail.
 */
export default function DischargeScreen() {
  const { data, error, isLoading } = useDischarge();
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }}>
    <Title line={data?.status === "discharged" ? `Home since ${dayLabel(data.dischargedAt)}` : undefined}>My discharge</Title>
    {isLoading && <ActivityIndicator color={palette.muted} />}
    {error && <Text style={{ ...type.body, color: palette.red }}>{errorText(error)}</Text>}
    {data?.status === "in-hospital" && <Card feature>
      <Text style={{ ...type.headline, color: palette.ink }}>You're still in hospital</Text>
      <Text style={{ ...type.body, color: palette.muted }}>Your medicines, leaflet and warning signs show here once you go home.</Text>
    </Card>}
    {data?.status === "discharged" && <Plan plan={data} />}
  </ScrollView>;
}

const TAGS = { new: { label: "New", color: palette.blue }, changed: { label: "Changed", color: palette.amber }, continue: { label: "Same", color: palette.muted }, stopped: { label: "Stopped", color: palette.muted } } as const;

function Plan({ plan }: { plan: Discharged }) {
  const [picked, setPicked] = useState<string>();
  const leaflet = plan.leaflets.find(l => l.language === (picked ?? plan.language)) ?? plan.leaflets[0]!;
  const meds = (["new", "changed", "continue", "stopped"] as const).flatMap(group => plan.medicines[group].map(m => ({ ...m, group })));
  return <>
    <Card feature>
      <Text style={{ ...type.overline, color: palette.blue }}>Today</Text>
      <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>Your medicines</Text>
      {meds.map(m => {
        const stopped = m.group === "stopped";
        return <View key={m.name} accessible accessibilityLabel={`${TAGS[m.group].label}: ${m.name}. ${m.line}`} style={{ flexDirection: "row", gap: 10, alignItems: "baseline" }}>
          <Text style={{ ...type.footnote, minWidth: 64, fontWeight: "700", color: TAGS[m.group].color }}>{TAGS[m.group].label}</Text>
          <Text style={{ ...type.body, flex: 1, color: stopped ? palette.muted : palette.ink }}>
            <Text style={{ fontWeight: "600", textDecorationLine: stopped ? "line-through" : "none" }}>{m.name}</Text> · {m.line}
          </Text>
        </View>;
      })}
    </Card>

    <Card>
      <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>Your leaflet</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {plan.leaflets.map(l => {
          const on = l.language === leaflet.language;
          return <Pressable key={l.language} accessibilityRole="button" accessibilityLabel={l.name} accessibilityState={{ selected: on }} onPress={() => setPicked(l.language)}
            style={({ pressed }) => ({ minHeight: 44, minWidth: 56, paddingHorizontal: 16, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: on ? palette.blueWash : "rgba(20,28,40,0.05)", opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ ...type.footnote, fontWeight: "600", color: on ? palette.blue : palette.ink }}>{l.label}</Text>
          </Pressable>;
        })}
      </View>
      <Text style={{ ...type.body, color: palette.ink }}>{leaflet.text}</Text>
    </Card>

    <Card>
      <Text accessibilityRole="header" style={{ ...type.headline, color: palette.red }}>Call 999 or go to the emergency department if</Text>
      {plan.warningSigns.map(sign => <Text key={sign} style={{ ...type.body, color: palette.ink }}>•  {sign}</Text>)}
    </Card>

    <Card style={{ paddingVertical: 6 }}>
      {plan.followUp && <Row first title={plan.followUp.title} line={dayLabel(plan.followUp.date)} onPress={() => router.push("/follow-ups")} />}
      <Row first={!plan.followUp} title="Check-ins" line={`We'll message you ${plan.checkIns.map(c => dayLabel(c.date)).join(" and ")}`} onPress={() => router.push("/check-ins")} />
    </Card>
  </>;
}

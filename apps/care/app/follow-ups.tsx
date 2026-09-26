import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text } from "react-native";
import { errorText } from "@/features/errors";
import { whenLine } from "@/features/follow-ups/lines";
import { useFollowUps } from "@/features/follow-ups/row";
import { palette, type } from "@/lib/theme";
import { Button, Card, Row, Title } from "@/lib/ui";

const STATUS = { upcoming: { label: "Next", color: palette.blue }, "due-soon": { label: "Due soon", color: palette.amber }, overdue: { label: "Overdue", color: palette.red } } as const;
const TONE = { upcoming: "muted", "due-soon": "amber", overdue: "red" } as const;

/**
 * Follow-ups: the next one (or the one tapped) as the feature card with what, when and why; the rest
 * as compact rows. An overdue one offers a message to the care team, since missed or already done
 * cannot be told apart here.
 */
export default function FollowUpsScreen() {
  const { data, error, isLoading } = useFollowUps();
  const [picked, setPicked] = useState<string>();
  const shown = data?.find(f => f.id === picked) ?? data?.[0];
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }}>
    <Title line="Visits and tests your care team has booked, and why.">My follow-ups</Title>
    {isLoading && <ActivityIndicator color={palette.muted} />}
    {error && <Text style={{ ...type.body, color: palette.red }}>{errorText(error)}</Text>}
    {data && !shown && <Card feature>
      <Text style={{ ...type.headline, color: palette.ink }}>Nothing booked yet</Text>
      <Text style={{ ...type.body, color: palette.muted }}>When your doctor books a visit or a test, it shows here.</Text>
    </Card>}
    {shown && <Card feature>
      <Text style={{ ...type.overline, color: STATUS[shown.status].color }}>{STATUS[shown.status].label}</Text>
      <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{shown.title}</Text>
      <Text style={{ ...type.headline, color: palette.ink }}>{whenLine(shown)}</Text>
      <Text style={{ ...type.body, color: palette.muted }}>{shown.why}</Text>
      {shown.status === "overdue" && <>
        <Text style={{ ...type.body, color: palette.muted }}>Missed it, or already been? Let your care team know.</Text>
        <Button label="Message my care team" onPress={() => router.push("/messages")} />
      </>}
    </Card>}
    {data && data.length > 1 && <Card style={{ paddingVertical: 6 }}>
      {data.filter(f => f.id !== shown?.id).map((f, i) =>
        <Row key={f.id} first={i === 0} title={f.title} line={whenLine(f)} tone={TONE[f.status]} onPress={() => setPicked(f.id)} />)}
    </Card>}
  </ScrollView>;
}

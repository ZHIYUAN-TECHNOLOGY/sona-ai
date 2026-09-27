import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SignIn } from "@/components/sign-in";
import { TodayCard, useCheckInNeeds } from "@/features/check-ins/today";
import { DischargeRow } from "@/features/discharge/row";
import { DoseTile, useDoseNeeds } from "@/features/doses";
import { useFollowUpNeeds, VisitTile } from "@/features/follow-ups/row";
import { daysHome, needsLine, whereWords } from "@/features/home";
import { useMe } from "@/features/me";
import { CareTeamRow, useMessageNeeds } from "@/features/messages/row";
import { authClient } from "@/lib/auth-client";
import { palette, type } from "@/lib/theme";
import { Button, Card, Title } from "@/lib/ui";
import { orpc } from "@/utils/orpc";

/**
 * Sona Care's home answers three questions in order: where am I and does anything need me (the title
 * and its line), what's next (two glance tiles: the next dose and the next visit), and what needs me
 * now (one feature card, acted on in place), then the plan and the care team as rows.
 */
export default function Home() {
  const { state, me } = useMe();
  const needs = useCheckInNeeds() + useDoseNeeds() + useFollowUpNeeds() + useMessageNeeds();
  const health = useQuery(orpc.healthCheck.queryOptions());
  const offline = health.isError || (health.data !== undefined && health.data !== "OK");
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingTop: 72, paddingBottom: 48, gap: 16 }}>
    {state === "joined" && me
      ? <Title greeting={`Hi, ${me.firstName}`} accent={whereWords(daysHome(me.dischargedAt))[0]} line={needsLine(needs)} lineTone={needs ? "amber" : "muted"}>{whereWords(daysHome(me.dischargedAt))[1]}</Title>
      : <Title overline="Sona Care" line="Check-ins, your discharge plan and follow-ups, from your hospital.">Your care, between visits</Title>}
    {offline && <Text style={{ ...type.footnote, color: palette.amber }}>Offline · showing what was last saved</Text>}
    {state === "loading" && <ActivityIndicator color={palette.muted} />}
    {state === "signed-out" && <>
      <Card feature>
        <Text style={{ ...type.headline, color: palette.ink }}>New here?</Text>
        <Text style={{ ...type.body, color: palette.muted }}>Scan the QR code on your discharge paper, or type the code under it.</Text>
        <Button label="Join with my discharge code" onPress={() => router.push("/join")} />
      </Card>
      <SignIn />
    </>}
    {state === "not-joined" && <Card feature>
      <Text style={{ ...type.headline, color: palette.ink }}>Link your hospital record</Text>
      <Text style={{ ...type.body, color: palette.muted }}>Use the code on your discharge paper so Sona Care shows your own care.</Text>
      <Button label="Enter my discharge code" onPress={() => router.push("/join")} />
    </Card>}
    {state === "joined" && <>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <DoseTile />
        <VisitTile />
      </View>
      <TodayCard />
      <Card style={{ paddingVertical: 6 }}>
        <DischargeRow first />
        <CareTeamRow />
      </Card>
    </>}
    {state !== "signed-out" && state !== "loading" && <Pressable accessibilityRole="button" onPress={() => { void authClient.signOut(); }} style={{ alignSelf: "center", minHeight: 44, justifyContent: "center" }}>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>Sign out</Text>
    </Pressable>}
  </ScrollView>;
}

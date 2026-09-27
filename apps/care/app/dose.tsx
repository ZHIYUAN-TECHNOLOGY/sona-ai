import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, useReducedMotion, withSpring, withTiming } from "react-native-reanimated";
import { markTaken, Pill, tintOf, useNextDose, useNow } from "@/features/doses";
import { clock, dueNow, early, untilLine, whenWords } from "@/features/doses/model";
import { dayLabel } from "@/features/follow-ups/lines";
import { palette, type } from "@/lib/theme";
import { Button, Card, pillStyle, Title } from "@/lib/ui";

/**
 * One dose, one decision (after the Lumi medicine card): when, what it looks like, how to take it and
 * one "Mark as taken". Once taken, the card says so and suggests the next dose, so the patient knows
 * what comes after without looking.
 */
export default function DoseScreen() {
  const now = useNow();
  const { plan, dose } = useNextDose(now);
  const reduced = useReducedMotion();
  const [took, setTook] = useState<{ name: string; at: Date }>();
  const soon = dose && dueNow(dose.dueAt, now);

  const take = () => {
    if (!dose) return;
    markTaken(dose.key);
    setTook({ name: dose.name, at: new Date() });
    if (process.env.EXPO_OS === "ios") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    AccessibilityInfo.announceForAccessibility(`${dose.name} marked as taken`);
  };

  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }}>
    <Title overline={dayLabel(now)} accent={took ? "Taken" : soon ? "Time" : "Next"}>{took ? ", thank you" : soon ? " to take your medicine" : " medicine"}</Title>
    {!plan && <ActivityIndicator color={palette.muted} />}

    {took ? <Card feature style={{ alignItems: "center", gap: 10, paddingVertical: 24 }}>
      <Art name={took.name} done reduced={reduced} />
      <Text style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{took.name}</Text>
      <Text style={{ ...type.body, color: palette.green, fontWeight: "600" }}>Taken at {clock(took.at)}</Text>
      <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>{dose ? `Next: ${dose.name}, ${whenWords(dose.dueAt, now)}` : "Nothing else on a timer for now."}</Text>
      <View style={{ alignSelf: "stretch", paddingTop: 6 }}><Button quiet label="Back to home" onPress={() => router.back()} /></View>
    </Card>

    : dose ? <Card feature style={{ alignItems: "center", gap: 10, paddingVertical: 24 }}>
      <View style={[pillStyle, { paddingHorizontal: 14, minHeight: 32, justifyContent: "center" }]}>
        <Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink, fontVariant: ["tabular-nums"] }}>{clock(dose.dueAt)}</Text>
      </View>
      <Art name={dose.name} reduced={reduced} />
      <Text style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{dose.name}</Text>
      <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>{dose.line}</Text>
      <Text style={{ ...type.footnote, fontWeight: soon ? "600" : "400", color: soon ? palette.amber : palette.muted }}>{untilLine(dose.dueAt, now) === "now" ? "Due now" : `Due ${untilLine(dose.dueAt, now)}`}</Text>
      <View style={{ alignSelf: "stretch", paddingTop: 6 }}>{early(dose.dueAt, now) ? <Button quiet label="I took it early" onPress={take} /> : <Button label="Mark as taken" onPress={take} />}</View>
    </Card>

    : plan && <Card feature>
      <Text style={{ ...type.headline, color: palette.ink }}>Nothing on a timer</Text>
      <Text style={{ ...type.body, color: palette.muted }}>{plan.status === "discharged" ? "Your other medicines are taken when you need them. Your discharge plan says how." : "Your medicines show here once you go home."}</Text>
      {plan.status === "discharged" && <Button quiet label="See my discharge plan" onPress={() => router.replace("/discharge")} />}
    </Card>}

    {!took && <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>Missed one? Don't take two at once. Take the next one at its usual time.</Text>}
  </ScrollView>;
}

/** The check badge springs in from 0.6 with a slight overshoot (the clinician app's confirm spring), never from nothing. */
const badgeIn = () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ scale: 0.6 }] }, animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ scale: withSpring(1, { duration: 380, dampingRatio: 0.72 }) }] } };
};

/** The medicine drawn large on its tint; once taken, a check badge springs in. */
function Art({ name, done, reduced }: { name: string; done?: boolean; reduced: boolean }) {
  return <View style={{ width: 148, height: 148, borderRadius: 40, borderCurve: "continuous", backgroundColor: tintOf(name), alignItems: "center", justifyContent: "center" }}>
    <Pill name={name} size={112} />
    {done && <Animated.View entering={reduced ? FadeIn.duration(160) : badgeIn}
      style={{ position: "absolute", right: 8, bottom: 8, width: 36, height: 36, borderRadius: 18, borderWidth: 3, borderColor: palette.white, backgroundColor: palette.green, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: palette.white, fontSize: 17, fontWeight: "700" }}>✓</Text>
    </Animated.View>}
  </View>;
}

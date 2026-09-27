import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View, type ViewStyle } from "react-native";
import Animated, { Easing, FadeIn, useReducedMotion, withSpring, withTiming } from "react-native-reanimated";
import { markTaken, Pill, useNextDose, useNow } from "@/features/doses";
import { clock, dosesToday, dueNow, early, untilLine, whenWords, type Dose } from "@/features/doses/model";
import { foodOf, strip } from "@/features/doses/strip";
import { dayLabel } from "@/features/follow-ups/lines";
import { Sunbeam } from "@/lib/halftone";
import { palette, type } from "@/lib/theme";
import { BackButton, Button, Card, HoldButton, pillStyle, Title } from "@/lib/ui";

/**
 * One dose, one decision (care-v2 prototype): today's doses at a glance, the medicine drawn big, how
 * to take it and one hold to mark it taken. Once taken, the card keeps the dose with a check, the strip
 * ticks it off and the next dose is suggested, so the patient knows what comes after without looking.
 */
export default function DoseScreen() {
  const now = useNow();
  const { plan, dose, taken = [] } = useNextDose(now);
  const reduced = useReducedMotion();
  const [took, setTook] = useState<{ dose: Dose; at: Date }>();
  const shown = took?.dose ?? dose;
  const meds = plan?.status === "discharged" ? [...plan.medicines.new, ...plan.medicines.changed, ...plan.medicines.continue] : [];
  const today = strip(dosesToday(meds, plan?.status === "discharged" ? plan.dischargedAt : undefined, taken, now), took ? undefined : dose?.key);
  const soon = !!dose && dueNow(dose.dueAt, now);
  const plain = shown && meds.find(m => m.name === shown.name)?.line; // what it is for, under how to take it

  const take = () => {
    if (!dose) return;
    markTaken(dose.key); // HoldButton already gave the success haptic (and the VoiceOver announcement)
    setTook({ dose, at: new Date() });
  };

  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }}>
      <BackButton />
    {took ? <Title overline={dayLabel(now)} accent="Taken">, thank you</Title>
      : <Title overline={dayLabel(now)} greeting={soon ? "Time to take" : "Next"} accent="your medicine" />}
    {!plan && <ActivityIndicator color={palette.muted} />}

    {today.length > 0 && <View accessible accessibilityLabel={`Today: ${today.map(c => `${c.label.replace("✓ ", "")}, ${c.state === "did" ? "taken" : c.state === "now" ? "now" : "later"}`).join("; ")}`}
      style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6 }}>
      {today.map(c => <View key={c.key} style={[pillStyle, { paddingHorizontal: 10, paddingVertical: 6 }, c.state === "now" && { backgroundColor: palette.dark, borderColor: palette.dark }]}>
        <Text style={{ fontSize: 11.5, fontWeight: "700", color: c.state === "did" ? palette.green : c.state === "now" ? palette.white : palette.muted, fontVariant: ["tabular-nums"] }}>{c.label}</Text>
      </View>)}
    </View>}

    {shown ? <Card feature style={{ alignItems: "center", gap: 12, paddingVertical: 24 }}>
      <Art name={shown.name} done={!!took} reduced={reduced} />
      <View style={{ alignItems: "center", gap: 4 }}>
        <Text style={{ ...type.title, fontWeight: "600", color: palette.ink, textAlign: "center" }}>{shown.name}</Text>
        <Text style={{ ...type.body, color: palette.ink, textAlign: "center" }}>{shown.line}</Text>
        {plain && plain !== shown.line && <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>{plain}</Text>}
        {/* Once taken, the settled button says when; the line would repeat it. */}
        {!took && <Text style={{ ...type.footnote, fontWeight: soon ? "600" : "400", color: soon ? palette.amber : palette.muted }}>{dueLine(shown.dueAt, now)}</Text>}
      </View>
      {!took && <Food line={shown.line} />}
      <View style={{ alignSelf: "stretch", paddingTop: 4 }}>
        <HoldButton key={shown.key} done={!!took} onDone={take}
          label={!took && early(shown.dueAt, now) ? "Hold if you took it early" : "Hold to mark as taken"}
          doneLabel={took ? `Taken at ${clock(took.at)}` : `${shown.name} marked as taken`} />
      </View>
      {took && <Animated.View entering={FadeIn.duration(240).easing(Easing.out(Easing.cubic))} style={{ alignSelf: "stretch", alignItems: "center", gap: 10 }}>
        <Text accessibilityLiveRegion="polite" style={{ ...type.body, color: palette.muted, textAlign: "center" }}>{dose ? `Next: ${dose.name}, ${whenWords(dose.dueAt, now)}` : "Nothing else on a timer for now."}</Text>
        <View style={{ alignSelf: "stretch" }}><Button quiet label="Back to home" onPress={() => router.canGoBack() ? router.back() : router.replace("/")} /></View>
      </Animated.View>}
      <Sunbeam play={took?.at} radius={28} />
    </Card>

    : plan && <Card feature>
      <Text style={{ ...type.headline, color: palette.ink }}>Nothing on a timer</Text>
      <Text style={{ ...type.body, color: palette.muted }}>{plan.status === "discharged" ? "Your other medicines are taken when you need them. Your discharge plan says how." : "Your medicines show here once you go home."}</Text>
      {plan.status === "discharged" && <Button quiet label="See my discharge plan" onPress={() => router.replace("/discharge")} />}
    </Card>}

    {!took && <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>Missed one? Don't take two at once. Take the next one at its usual time.</Text>}
  </ScrollView>;
}

/** "Due now", "Due in 2 h 10 min" close by, "Due tomorrow 8:00 AM" further off, "1 h 30 min late". */
function dueLine(dueAt: Date, now: Date) {
  const until = untilLine(dueAt, now);
  return until === "now" ? "Due now" : until.endsWith("late") ? until : dueAt.getTime() - now.getTime() > 3 * 3600_000 ? `Due ${whenWords(dueAt, now)}` : `Due ${until}`;
}

/** Read-only before/after food, as a glass segmented pill with the right side lit; nothing when the plan doesn't say. */
function Food({ line }: { line: string }) {
  const when = foodOf(line);
  if (!when) return null;
  return <View accessible accessibilityLabel={`Take ${when} food`} style={[pillStyle, { flexDirection: "row", padding: 4 }]}>
    {(["before", "after"] as const).map(side => <View key={side} style={[{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 }, side === when && { backgroundColor: palette.white, boxShadow: "0 4px 10px -4px rgba(80,60,140,0.35)" } as ViewStyle]}>
      <Text style={{ fontSize: 13, fontWeight: "700", color: side === when ? palette.ink : palette.muted }}>{side === "before" ? "Before food" : "After food"}</Text>
    </View>)}
  </View>;
}

/** The check badge springs in from 0.6 with a slight overshoot (the confirm spring), never from nothing. */
const badgeIn = () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ scale: 0.6 }] }, animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ scale: withSpring(1, { duration: 380, dampingRatio: 0.72 }) }] } };
};

/** The medicine drawn large on a soft blue disc; once taken, a check badge springs on. */
function Art({ name, done, reduced }: { name: string; done: boolean; reduced: boolean }) {
  return <View style={{ width: 210, height: 210, borderRadius: 105, alignItems: "center", justifyContent: "center",
    experimental_backgroundImage: "radial-gradient(circle at 40% 35%, #FFFFFF, #EEF1FF 55%, #DCE2FB 100%)", boxShadow: "0 30px 50px -26px rgba(61,90,241,0.4), inset -8px -14px 30px rgba(61,90,241,0.12)" } as ViewStyle}>
    <Pill name={name} size={120} />
    {done && <Animated.View entering={reduced ? FadeIn.duration(160) : badgeIn}
      style={{ position: "absolute", right: 16, bottom: 18, width: 44, height: 44, borderRadius: 22, borderWidth: 4, borderColor: palette.white, backgroundColor: palette.green, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: palette.white, fontSize: 18, fontWeight: "800" }}>✓</Text>
    </Animated.View>}
  </View>;
}

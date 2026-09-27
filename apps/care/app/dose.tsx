import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View, type ViewStyle } from "react-native";
import Animated, { Easing, FadeIn, useReducedMotion, withSpring, withTiming } from "react-native-reanimated";
import { markTaken, useNextDose, useNow } from "@/features/doses";
import { clock, dosesToday, dueNow, early, untilLine, whenWords, type Dose } from "@/features/doses/model";
import { Pill } from "@/features/doses/pill";
import { foodOf, strip } from "@/features/doses/strip";
import { dayLabel } from "@/features/follow-ups/lines";
import { useMe } from "@/features/me";
import { Sunbeam } from "@/lib/halftone";
import { palette, type } from "@/lib/theme";
import { AccentText, Button, Card, CircleButton, HoldButton, ICON, pillStyle } from "@/lib/ui";

const home = () => router.canGoBack() ? router.back() : router.replace("/");

/**
 * One dose, one decision (Lumi kit, "Time to take"): who and how to take it along the top, the date and
 * the ask, today's doses at a glance, then one grey card with the time, the medicine drawn big, how to
 * take it and one hold to mark it taken. Once taken, a check springs onto the pill, the strip ticks it
 * off and the next dose is suggested, so the patient knows what comes after without looking.
 */
export default function DoseScreen() {
  const now = useNow();
  const { me } = useMe();
  const { plan, dose, taken = [] } = useNextDose(now);
  const reduced = useReducedMotion();
  const [took, setTook] = useState<{ dose: Dose; at: Date }>();
  const shown = took?.dose ?? dose;
  const meds = plan?.status === "discharged" ? [...plan.medicines.new, ...plan.medicines.changed, ...plan.medicines.continue] : [];
  const today = strip(dosesToday(meds, plan?.status === "discharged" ? plan.dischargedAt : undefined, taken, now), took ? undefined : dose?.key);
  const soon = !!dose && dueNow(dose.dueAt, now);
  const quiet = !took && !!shown && early(shown.dueAt, now);
  const plain = shown && meds.find(m => m.name === shown.name)?.line; // what it is for, under how to take it
  const [lead, lit] = took ? ["Taken,", "thank you"] : [soon ? "Time to take" : "Next", "your medicine"];
  const big = { fontSize: 30, lineHeight: 36, letterSpacing: -0.8, fontWeight: "700" as const, textAlign: "center" as const };

  const take = () => {
    if (!dose) return;
    markTaken(dose.key); // HoldButton already gave the success haptic and the VoiceOver announcement
    setTook({ dose, at: new Date() });
  };

  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 18 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Initials name={me?.name} />
      <View style={{ flex: 1, alignItems: "center" }}>{shown && <Food line={shown.line} />}</View>
      <CircleButton d={ICON.close} label="Close" onPress={home} />
    </View>

    <View accessible accessibilityRole="header" accessibilityLabel={`${dayLabel(now)}. ${lead} ${lit}`} style={{ alignItems: "center", gap: 6 }}>
      <Text style={{ ...type.footnote, color: palette.faint }}>{dayLabel(now)}</Text>
      <View style={{ alignItems: "center" }}>
        <Text style={{ ...big, fontWeight: "600", color: palette.ink }}>{lead}</Text>
        <AccentText style={big}>{lit}</AccentText>
      </View>
    </View>
    {!plan && <ActivityIndicator color={palette.muted} />}

    {today.length > 0 && <View accessible accessibilityLabel={`Today: ${today.map(c => `${c.label.replace("✓ ", "")}, ${c.state === "did" ? "taken" : c.state === "now" ? "now" : "later"}`).join("; ")}`}
      style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6 }}>
      {today.map(c => <View key={c.key} style={[pillStyle, { paddingHorizontal: 10, paddingVertical: 5 }, c.state === "now" && { backgroundColor: palette.dark, borderColor: palette.dark }]}>
        <Text style={{ fontSize: 11.5, fontWeight: "700", color: c.state === "did" ? palette.green : c.state === "now" ? palette.white : palette.muted, fontVariant: ["tabular-nums"] }}>{c.label}</Text>
      </View>)}
    </View>}

    {shown ? <Card style={{ borderRadius: 36, alignItems: "center", gap: 14, paddingVertical: 24, paddingHorizontal: 20 }}>
      <View style={[pillStyle, { backgroundColor: palette.white, paddingHorizontal: 16, paddingVertical: 7 }]}>
        <Text accessibilityLabel={`Due at ${clock(shown.dueAt)}`} style={{ fontSize: 15, fontWeight: "600", color: palette.ink, fontVariant: ["tabular-nums"] }}>{clock(shown.dueAt)}</Text>
      </View>
      <Art name={shown.name} done={!!took} reduced={reduced} />
      <View style={{ alignItems: "center", gap: 4 }}>
        <Text style={{ fontSize: 26, lineHeight: 32, letterSpacing: -0.6, fontWeight: "600", color: palette.ink, textAlign: "center" }}>{shown.name}</Text>
        <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>{shown.line}</Text>
        {plain && plain !== shown.line && <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>{plain}</Text>}
        {/* Once taken, the settled button says when; the line would repeat it. */}
        {!took && <Text style={{ ...type.footnote, marginTop: 2, fontWeight: soon ? "600" : "400", color: soon ? palette.amber : palette.muted }}>{dueLine(shown.dueAt, now)}</Text>}
      </View>
      <View style={{ alignSelf: "stretch", paddingTop: 4 }}>
        <HoldButton key={shown.key} done={!!took} onDone={take} quiet={quiet}
          label={quiet ? "Hold if you took it early" : "Hold to mark as taken"}
          doneLabel={took ? `Taken at ${clock(took.at)}` : `${shown.name} marked as taken`} />
      </View>
      {took && <Animated.View entering={reduced ? undefined : FadeIn.duration(240).easing(Easing.out(Easing.cubic))} style={{ alignSelf: "stretch", alignItems: "center", gap: 10 }}>
        <Text accessibilityLiveRegion="polite" style={{ ...type.body, color: palette.muted, textAlign: "center" }}>{dose ? `Next: ${dose.name}, ${whenWords(dose.dueAt, now)}` : "Nothing else on a timer for now."}</Text>
        <View style={{ alignSelf: "stretch" }}><Button quiet label="Back to home" onPress={home} /></View>
      </Animated.View>}
      <Sunbeam play={took?.at} radius={36} />
    </Card>

    : plan && <Card style={{ borderRadius: 36 }}>
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

/** The patient's initials on a round glass disc (the kit's avatar; we hold no photo). Nothing to tap. */
function Initials({ name }: { name?: string }) {
  const letters = (name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("");
  return <View accessible={!!name} accessibilityLabel={name} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.white, borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", boxShadow: "0 6px 16px -10px rgba(40,50,110,0.35)" } as ViewStyle}>
    <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 15, fontWeight: "700", color: palette.ink }}>{letters}</Text>
  </View>;
}

/** Read-only before/after food, as a glass segmented pill with the plan's side in ink; nothing when the plan doesn't say. */
function Food({ line }: { line: string }) {
  const when = foodOf(line);
  if (!when) return null;
  return <View accessible accessibilityLabel={`Take ${when} food`} style={[pillStyle, { flexDirection: "row", padding: 3 }]}>
    {(["before", "after"] as const).map(side => <View key={side} style={[{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 }, side === when && { backgroundColor: palette.dark }]}>
      <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 13, fontWeight: "600", color: side === when ? palette.white : palette.muted }}>{side === "before" ? "Before food" : "After food"}</Text>
    </View>)}
  </View>;
}

/** The check badge springs in from 0.6 with a slight overshoot (the confirm spring), never from nothing. */
const badgeIn = () => {
  "worklet";
  return { initialValues: { opacity: 0, transform: [{ scale: 0.6 }] }, animations: { opacity: withTiming(1, { duration: 160 }), transform: [{ scale: withSpring(1, { duration: 380, dampingRatio: 0.72 }) }] } };
};

/** The medicine drawn large, straight on the card as in the kit; once taken, a check badge springs on. */
function Art({ name, done, reduced }: { name: string; done: boolean; reduced: boolean }) {
  return <View style={{ width: 170, height: 170 }}>
    <Pill name={name} size={170} />
    {done && <Animated.View entering={reduced ? undefined : badgeIn}
      style={{ position: "absolute", right: 6, bottom: 14, width: 44, height: 44, borderRadius: 22, borderWidth: 4, borderColor: palette.white, backgroundColor: palette.green, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: palette.white, fontSize: 18, fontWeight: "800" }}>✓</Text>
    </Animated.View>}
  </View>;
}

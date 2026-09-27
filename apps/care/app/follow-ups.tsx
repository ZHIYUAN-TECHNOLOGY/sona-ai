import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, LinearTransition, useReducedMotion } from "react-native-reanimated";
import { errorText } from "@/features/errors";
import { away, bringLine, pillLine, type FollowUp } from "@/features/follow-ups/lines";
import { useFollowUps } from "@/features/follow-ups/row";
import { removeQuestion, saveQuestion, useQuestions } from "@/features/questions";
import { DOCK_SPACE } from "@/lib/dock";
import { palette, type } from "@/lib/theme";
import { Button, Card, field, pillStyle, Section, surfaceStyle, Title } from "@/lib/ui";

const TONE = { upcoming: palette.faint, "due-soon": palette.amber, overdue: palette.red } as const;
const LABEL = { upcoming: "Later", "due-soon": "Due soon", overdue: "Overdue" } as const;
// Motion tokens: a 40 ms staggered ease-out rise on first appearance (after Vakitler), a no-bounce 380 ms
// layout spring when a card opens (after Timepage's day view); both still under Reduce Motion.
const rise = (i: number) => FadeInDown.duration(360).easing(Easing.out(Easing.cubic)).delay(i * 40);
const spring = LinearTransition.springify().duration(380).dampingRatio(1);

/**
 * My visits: the title says when the next one is; the feature card is that visit, with a quick review
 * before going (what to bring, the questions saved for the doctor, one field to add another). The rest
 * are compact glass cards that open in place, one at a time. An overdue one offers a message to the
 * care team, since missed or already done cannot be told apart here.
 * ponytail: no Directions or Call clinic; follow-ups carry no place, doctor or phone yet. Add them when the API does.
 */
export default function FollowUpsScreen() {
  const { data, error, isLoading } = useFollowUps();
  const still = useReducedMotion();
  const [open, setOpen] = useState<string>();
  const [next, ...rest] = data ?? [];
  const enter = (i: number) => still ? undefined : rise(i);
  const layout = still ? undefined : spring;
  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
    contentContainerStyle={{ padding: 20, paddingBottom: DOCK_SPACE, gap: 16 }}>
    {isLoading && <ActivityIndicator color={palette.muted} />}
    {error && <Text style={{ ...type.body, color: palette.red }}>{errorText(error)}</Text>}
    {data && <Animated.View entering={enter(0)}>
      {!next ? <Title greeting="Your next visit" line="When your doctor books a visit or a test, it shows here.">Nothing booked yet</Title>
        : next.status === "overdue"
          // Overdue reads in red, not the accent gradient: red keeps its meaning.
          ? <View accessible accessibilityRole="header" accessibilityLabel="Your next visit. Overdue" style={{ gap: 4 }}>
            <Text style={{ ...type.greeting, color: palette.faint }}>Your next visit</Text>
            <Text style={{ ...type.display, fontWeight: "700", color: palette.red }}>overdue</Text>
          </View>
          : <Title greeting="Your next visit" accent={away(next.inDays)} />}
    </Animated.View>}
    {next && <Animated.View entering={enter(1)} layout={layout}><Visit f={next} /></Animated.View>}
    {rest.length > 0 && <Animated.View entering={enter(2)} layout={layout}><Section light="Also" bold="booked" /></Animated.View>}
    {rest.map((f, i) => <Booked key={f.id} f={f} open={open === f.id} onToggle={() => setOpen(open === f.id ? undefined : f.id)} entering={enter(3 + i)} layout={layout} />)}
  </ScrollView>;
}

/** The next visit: when, what and why, then the quick review before going. */
function Visit({ f }: { f: FollowUp }) {
  const questions = useQuestions();
  const [draft, setDraft] = useState("");
  const still = useReducedMotion();
  return <Card feature>
    <View style={[pillStyle, { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6 }]}>
      <Text style={{ ...type.footnote, fontWeight: "700", color: f.status === "upcoming" ? palette.ink : TONE[f.status] }}>{pillLine(f)}</Text>
    </View>
    <Text accessibilityRole="header" style={{ ...type.title, fontSize: 24, lineHeight: 30, fontWeight: "700", color: palette.ink }}>{f.title}</Text>
    <Text style={{ ...type.body, color: palette.muted }}>{f.why}</Text>
    {f.status === "overdue" && <Missed />}
    <View style={{ gap: 8, padding: 12, borderRadius: 18, borderCurve: "continuous", backgroundColor: "rgba(255,255,255,0.75)", borderWidth: 1, borderColor: "rgba(255,255,255,0.95)" }}>
      <Text style={{ ...type.overline, color: palette.faint }}>Before you go</Text>
      <Text style={{ ...type.body, color: palette.ink }}>{bringLine(f)}</Text>
      <Text style={{ ...type.body, fontWeight: "700", color: palette.ink, marginTop: 4 }}>Questions for your doctor{questions.length ? ` · ${questions.length} saved` : ""}</Text>
      {questions.map(q => <Animated.View key={q} entering={still ? undefined : FadeIn.duration(200)} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text style={{ ...type.body, flex: 1, color: palette.muted }}>“{q}”</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove question: ${q}`} onPress={() => removeQuestion(q)}
          style={({ pressed }) => ({ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}>
          <Text style={{ fontSize: 15, color: palette.faint }}>✕</Text>
        </Pressable>
      </Animated.View>)}
      <TextInput value={draft} onChangeText={setDraft} onSubmitEditing={() => { saveQuestion(draft); setDraft(""); }}
        placeholder="Add a question" placeholderTextColor={palette.faint} returnKeyType="done" submitBehavior="blurAndSubmit"
        accessibilityLabel="Add a question for your doctor" accessibilityHint="Saved on this phone for your visit" style={field} />
    </View>
  </Card>;
}

/** Another booked visit or test, compact until opened: then why, and what to bring. */
function Booked({ f, open, onToggle, entering, layout }: { f: FollowUp; open: boolean; onToggle: () => void; entering?: ReturnType<typeof rise>; layout?: typeof spring }) {
  const still = useReducedMotion();
  const tone = TONE[f.status], when = `${pillLine(f)} · ${away(f.inDays)}`;
  return <Animated.View entering={entering} layout={layout} style={[surfaceStyle, { paddingHorizontal: 16, paddingVertical: 4 }]}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${f.title}. ${LABEL[f.status]}, ${when}`} onPress={onToggle}
      style={({ pressed }) => ({ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.overline, color: tone }}>{LABEL[f.status]}</Text>
        <Text style={{ ...type.headline, color: palette.ink }}>{f.title}</Text>
        <Text style={{ ...type.footnote, fontWeight: f.status === "upcoming" ? "400" : "600", color: f.status === "upcoming" ? palette.muted : tone }}>{when}</Text>
      </View>
      <Animated.Text style={{ fontSize: 20, color: palette.muted, transform: [{ rotate: open ? "90deg" : "0deg" }], transitionProperty: "transform", transitionDuration: still ? 0 : 380, transitionTimingFunction: "ease-out" }}>›</Animated.Text>
    </Pressable>
    {open && <Animated.View entering={still ? undefined : FadeIn.duration(260).delay(120)} style={{ gap: 8, paddingBottom: 14 }}>
      <Text style={{ ...type.body, color: palette.ink }}>{f.why}</Text>
      <Text style={{ ...type.body, color: palette.muted }}>{bringLine(f)}</Text>
      {f.status === "overdue" && <Missed quiet />}
    </Animated.View>}
  </Animated.View>;
}

function Missed({ quiet }: { quiet?: boolean }) {
  return <>
    <Text style={{ ...type.body, color: palette.muted }}>Missed it, or already been? Let your care team know.</Text>
    <Button quiet={quiet} label="Message my care team" onPress={() => router.push("/messages")} />
  </>;
}

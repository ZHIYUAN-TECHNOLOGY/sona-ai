import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, LinearTransition, useReducedMotion } from "react-native-reanimated";
import { errorText } from "@/features/errors";
import { away, bringLine, dotTone, pillLine, visitsLine, type FollowUp } from "@/features/follow-ups/lines";
import { useFollowUps } from "@/features/follow-ups/row";
import { removeQuestion, saveQuestion, useQuestions } from "@/features/questions";
import { DOCK_SPACE } from "@/lib/dock";
import { palette, type } from "@/lib/theme";
import { Button, Card, field, pillStyle, Title } from "@/lib/ui";

const TONE = { upcoming: palette.muted, "due-soon": palette.amber, overdue: palette.red } as const;
const STATUS = { upcoming: "", "due-soon": "Due soon", overdue: "Overdue" } as const;
// Motion tokens: a 40 ms staggered ease-out rise on first appearance, a no-bounce 380 ms layout spring
// when a stop opens; both still under Reduce Motion.
const rise = (i: number) => FadeInDown.duration(360).easing(Easing.out(Easing.cubic)).delay(i * 40);
const spring = LinearTransition.springify().duration(380).dampingRatio(1);
const GAP = 12, DOT = 14, DOT_TOP = 27; // DOT_TOP centres the dot on the time pill (card padding 18 + half the 32 pt pill - half the dot).

/**
 * My visits (the Lumi kit's Schedules): "Visits" in the accent and one line on what is next, then a
 * timeline, a dot per stop on a thin line (blue for the next, grey for later, red once overdue). The
 * next stop is the feature card, open by default, with the quick review before going (what to bring,
 * the questions saved for the doctor, one field to add another). The rest are grey cards that open in
 * place, one at a time. An overdue one offers a message to the care team, since missed or already done
 * cannot be told apart here.
 * ponytail: no Directions or Call clinic; follow-ups carry no place, doctor or phone yet. Add them when the API does.
 */
export default function FollowUpsScreen() {
  const { data, error, isLoading } = useFollowUps();
  const still = useReducedMotion();
  // undefined: nothing chosen yet, so the next stop is open; null: the patient closed everything.
  const [chosen, setChosen] = useState<string | null>();
  const open = chosen === undefined ? data?.[0]?.id : chosen;
  const insight = data && visitsLine(data);
  const enter = (i: number) => still ? undefined : rise(i);
  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
    contentContainerStyle={{ padding: 20, paddingBottom: DOCK_SPACE, gap: 16 }}>
    <Animated.View entering={enter(0)} style={{ gap: 2 }}>
      <Title accent="Visits" />
      {insight && <Text style={{ ...type.body, fontWeight: insight.tone === "muted" ? "400" : "600", color: palette[insight.tone] }}>{insight.line}</Text>}
    </Animated.View>
    {isLoading && <ActivityIndicator color={palette.muted} />}
    {error && <Text style={{ ...type.body, color: palette.red }}>{errorText(error)}</Text>}
    {data?.length === 0 && <Animated.View entering={enter(1)}><Card>
      <Text style={{ ...type.headline, color: palette.ink }}>Nothing booked yet</Text>
      <Text style={{ ...type.body, color: palette.muted }}>When your doctor books a visit or a test, it shows here.</Text>
    </Card></Animated.View>}
    {data && data.length > 0 && <View style={{ gap: GAP }}>
      {data.map((f, i) => <Stop key={f.id} f={f} next={i === 0} last={i === data.length - 1} open={open === f.id}
        onToggle={() => setChosen(open === f.id ? null : f.id)} entering={enter(1 + i)} still={still} />)}
    </View>}
  </ScrollView>;
}


/** One stop on the timeline: its dot and line segment, then a card that opens in place. */
function Stop({ f, next, last, open, onToggle, entering, still }: { f: FollowUp; next: boolean; last: boolean; open: boolean; onToggle: () => void; entering?: ReturnType<typeof rise>; still: boolean }) {
  const tone = TONE[f.status], when = f.status === "overdue" ? `due ${away(f.inDays)}` : away(f.inDays);
  const label = [next ? "Next visit" : "", f.title, `${pillLine(f)}, ${when}`, STATUS[f.status]].filter(Boolean).join(". ");
  return <Animated.View entering={entering} layout={still ? undefined : spring} style={{ flexDirection: "row", gap: 12 }}>
    <View style={{ width: DOT, alignItems: "center" }}>
      {/* The segment above reaches up through the gap to the stop before; the one below runs to the next. */}
      <View style={{ width: 2, height: DOT_TOP + GAP, marginTop: -GAP, backgroundColor: next ? "transparent" : palette.line }} />
      <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 3, borderColor: palette.white, backgroundColor: palette[dotTone(f, next)],
        boxShadow: next ? `0 0 0 3px ${palette.blueWash}` : "0 1px 3px rgba(20,26,46,0.12)" }} />
      {!last && <View style={{ width: 2, flex: 1, marginBottom: -GAP, backgroundColor: palette.line }} />}
    </View>
    <Card feature={next} style={{ flex: 1 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={label} onPress={onToggle}
        style={({ pressed }) => ({ minHeight: 44, gap: 8, opacity: pressed ? 0.6 : 1 })}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={[pillStyle, { minHeight: 32, paddingHorizontal: 12, justifyContent: "center", flexShrink: 1 }]}>
            <Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink, fontVariant: ["tabular-nums"] }}>{pillLine(f)}</Text>
          </View>
          <Text style={{ ...type.footnote, flex: 1, fontWeight: f.status === "upcoming" ? "400" : "600", color: tone }}>{f.status === "overdue" ? "Overdue" : away(f.inDays)}</Text>
          <Animated.Text style={{ fontSize: 20, color: palette.faint, transform: [{ rotate: open ? "90deg" : "0deg" }], transitionProperty: "transform", transitionDuration: still ? 0 : 380, transitionTimingFunction: "ease-out" }}>›</Animated.Text>
        </View>
        <Text style={next ? { ...type.title, fontWeight: "700", color: palette.ink } : { ...type.headline, color: palette.ink }}>{f.title}</Text>
        <Text numberOfLines={open ? undefined : 1} style={{ ...type.body, color: palette.muted }}>{f.why}</Text>
      </Pressable>
      {open && <Animated.View entering={still ? undefined : FadeIn.duration(260).delay(120)} style={{ gap: 12 }}>
        {f.status === "overdue" && <Missed quiet={!next} />}
        {next ? <Review f={f} still={still} /> : <Text style={{ ...type.body, color: palette.ink }}>{bringLine(f)}</Text>}
      </Animated.View>}
    </Card>
  </Animated.View>;
}

/** The quick review before the next visit: what to bring, and the questions saved for the doctor. */
function Review({ f, still }: { f: FollowUp; still: boolean }) {
  const questions = useQuestions();
  const [draft, setDraft] = useState("");
  return <View style={{ gap: 8, padding: 14, borderRadius: 20, borderCurve: "continuous", backgroundColor: palette.mutedWash }}>
    <Text style={{ ...type.overline, color: palette.muted }}>Before you go</Text>
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
  </View>;
}

function Missed({ quiet }: { quiet?: boolean }) {
  return <>
    <Text style={{ ...type.body, color: palette.muted }}>Missed it, or already been? Let your care team know.</Text>
    <Button quiet={quiet} label="Message my care team" onPress={() => router.push("/messages")} />
  </>;
}

import { useState } from "react";
import { ScrollView, View } from "react-native";
import { SAMPLE_ANSWERS } from "@/features/assistant/answer-fixtures";
import { AnswerCards, type Run } from "@/features/assistant/answer-cards";
import { Marked } from "@/features/assistant/marked";
import { Icon } from "@/lib/icons";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { BackButton, Chip, useBelowStatusBar } from "@/lib/ui";

/** Confirming on the preview only waits a moment: nothing is booked, logged or sent. */
const dry: Run = () => new Promise(done => setTimeout(done, 700));

/**
 * Every mark and card an answer can carry, drawn as Ask draws them, from SYNTHETIC answers (features/assistant/
 * answer-fixtures) with no server, so they can be checked and screenshotted (sona-care://answer-preview), in the
 * production bundles Expo Go runs too. A chip per sample shows that one alone, so each fits one screenshot. Nothing
 * links here, and its buttons do nothing (`dry`).
 */
export default function AnswerPreview() {
  const below = useBelowStatusBar();
  const [only, setOnly] = useState<number>();
  const shown = only === undefined ? SAMPLE_ANSWERS : [SAMPLE_ANSWERS[only]!];
  return <ScrollView style={below} contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 64, gap: 28 }}>
    <BackButton />
    <Text accessibilityRole="header" style={{ ...type.overline, color: palette.faint }}>Preview · sample answers, nothing is sent</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {[undefined, ...SAMPLE_ANSWERS.keys()].map(i => <Chip key={i ?? "all"} label={i === undefined ? "All" : `Sample ${i + 1}`} onPress={() => setOnly(i)}
        tone={only === i ? { bg: palette.dark, fg: palette.white } : undefined} />)}
    </View>
    {shown.map(s => <View key={s.question} style={{ gap: 12 }}>
      <View style={{ alignSelf: "flex-end", maxWidth: "86%", backgroundColor: palette.white, borderRadius: 22, borderCurve: "continuous", borderWidth: 1, borderColor: palette.line, paddingHorizontal: 16, paddingVertical: 11 }}>
        <Text style={{ ...type.body, color: palette.ink }}>{s.question}</Text>
      </View>
      <Text selectable style={{ fontSize: 17, lineHeight: 26, letterSpacing: -0.3, color: palette.ink }}><Marked text={s.answer} chosen={s.marks} /></Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="doc" color={palette.faint} size={14} />
        <Text style={{ ...type.footnote, color: palette.faint, flexShrink: 1 }}>{s.source}</Text>
      </View>
      <AnswerCards cards={s.cards} run={dry} />
    </View>)}
  </ScrollView>;
}

import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Insight, Screen } from "@/components/sona/ui";
import { AnswerView, useRunOp } from ".";
import { isSaved, removeView, saveView, useSaved } from "./saved";
import { useTodayAnswers } from "./today";

/**
 * A Sona answer as its own page ("Open as page", or a saved view from the sidebar). It is rebuilt
 * from current data every time, so a saved view is live: the rows and counts follow the day.
 */
export function SavedViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const answer = useTodayAnswers().find(a => a.id === id);
  const saved = useSaved();
  const run = useRunOp(() => {});
  if (!answer) return <Screen><Insight eyebrow="Sona view">This view isn’t available</Insight><Action label="Back" secondary onPress={() => router.back()} /></Screen>;
  const kept = isSaved(saved, answer.id);
  return <Screen>
    {/* The answer's lead is the page's heading; the question sits above it, like an insight's eyebrow. */}
    <Text style={{ ...type.footnote, fontWeight: "500", color: palette.muted }}>✦ {answer.question} · updates live</Text>
    <AnswerView answer={answer} run={run} question={false} />
    <View style={{ gap: 8 }}>
      <Action label={kept ? "Remove from sidebar" : "Save to sidebar"} icon={kept ? "pin.slash" : "pin"} secondary onPress={() => kept ? removeView(answer.id) : saveView({ id: answer.id, question: answer.question })} />
      <Text style={{ ...type.caption, color: palette.muted, textAlign: "center" }}>Saved views stay in the sidebar for this session, three at most.</Text>
    </View>
  </Screen>;
}

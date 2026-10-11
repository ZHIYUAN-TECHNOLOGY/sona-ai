import { partsOf } from "@sona-ai/domain/answer-parts";
import { Redirect, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { TermLegend } from "@/components/sona/marked-text";
import { Caption } from "@/components/sona/parts";
import { Chip, Screen } from "@/components/sona/ui";
import { AnswerView } from "@/features/ask";
import { column } from "@/features/ask/answers";
import { RICH_ANSWERS } from "@/features/ask/rich-fixture";
import { StreamedLead } from "@/features/encounter/conversation";
import { Bubble } from "@/features/encounter/sona-live";

// Developer preview only (dev builds, or a bundle built with EXPO_PUBLIC_ANSWER_PREVIEW=true): two fixture answers as a new
// server sends them, a mark of every kind in the leads and a card of every kind under them, laid out as Today's thread
// lays out an answer. Confirming saves nothing.
const ON = __DEV__ || process.env.EXPO_PUBLIC_ANSWER_PREVIEW === "true";

export default function AnswerPreview() {
  const [fails, setFails] = useState(false);
  const [plain, setPlain] = useState(false);
  if (!ON) return <Redirect href="/" />;
  const run = () => new Promise<void>((done, fail) => setTimeout(() => fails ? fail(new Error("The server refused it (preview).")) : done(), 600));
  return <Screen>
    <Stack.Screen options={{ title: "Rich answers" }} />
    <Caption icon={null}>Developer preview · fixture answers; confirming a task saves nothing</Caption>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Chip label={fails ? "Confirm fails" : "Confirm succeeds"} selected={fails} onPress={() => setFails(f => !f)} />
      <Chip label={plain ? "Model marked nothing" : "Model's marks"} selected={plain} onPress={() => setPlain(p => !p)} />
    </View>
    <TermLegend />
    {RICH_ANSWERS.map(a => {
      const { marks, cards } = partsOf(a);
      return <View key={`${a.question}${plain}${fails}`} style={{ gap: 16, paddingTop: 12 }}>
        <Bubble text={a.question} />
        <StreamedLead text={a.lead} terms={plain ? [] : marks} animate />
        <AnswerView answer={{ id: "free", question: a.question, worth: true, spec: column("preview", []), cards }} run={run} question={false} model="Sona Med (preview)" />
      </View>;
    })}
  </Screen>;
}

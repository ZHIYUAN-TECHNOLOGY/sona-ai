import type { Language } from "@sona-ai/domain/discharge";
import { View } from "react-native";
import { Button } from "@/lib/ui";
import { answersFor, type Feeling } from "./model";

/**
 * How the patient answers a check-in: three large answers in the check-in's language, each sending
 * its own words. Isolated behind `onAnswer` so a feeling slider can replace it without touching the card.
 */
export function Answer({ language, disabled, onAnswer }: { language: Language; disabled?: boolean; onAnswer: (text: string, label: Feeling) => void }) {
  return <View style={{ gap: 10 }}>
    {answersFor(language).answers.map(([text, label]) => <Button key={label} quiet label={text} disabled={disabled} onPress={() => onAnswer(text, label)} />)}
  </View>;
}

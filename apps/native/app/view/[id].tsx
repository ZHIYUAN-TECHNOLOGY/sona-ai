import { Stack, useLocalSearchParams } from "expo-router";
import { SavedViewScreen } from "@/features/ask/view";
import { useTodayAnswers } from "@/features/ask/today";

/** A saved view is titled by its question ("Who needs me now?"), which follows the day like the view itself. */
export default function SavedView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const question = useTodayAnswers().find(a => a.id === id)?.question ?? "";
  return <><Stack.Screen options={{ title: question }} /><SavedViewScreen /></>;
}

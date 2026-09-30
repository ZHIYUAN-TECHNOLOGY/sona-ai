import { Stack, router } from "expo-router";
import { Action, Insight, Screen } from "@/components/sona/ui";

/** A link to a page that doesn't exist: say so plainly and offer the way back. */
export default function NotFoundScreen() {
  return <Screen>
    <Stack.Screen options={{ title: "Page not found" }} />
    <Insight eyebrow="Nothing at this link">This page isn’t here</Insight>
    <Action label="Back to Today" icon="arrow.left" onPress={() => router.dismissTo("/")} />
  </Screen>;
}

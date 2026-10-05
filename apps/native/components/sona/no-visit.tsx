import { router } from "expo-router";
import { Action, Insight, Screen } from "./ui";

/**
 * A visit page opened without a visit (from a link, or after the visit closed): what it needs and the one way
 * on, the patient picker, which reopens this page (`view`) once a patient is chosen.
 */
export function NoVisit({ view, what }: { view: string; what: string }) {
  return <Screen>
    <Insight eyebrow="No visit open">Choose a patient to open {what}</Insight>
    <Action label="Choose a patient" icon="person.crop.circle" onPress={() => router.replace({ pathname: "/patients", params: { view } })} />
  </Screen>;
}

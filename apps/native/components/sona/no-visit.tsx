import { useNavigation } from "expo-router";
import { openPatients } from "@/features/encounter/navigation";
import { Action, Insight, Screen } from "./ui";

/**
 * A visit page opened without a visit (from a link, or after the visit closed): what it needs and the one way
 * on, the patient picker, which reopens this page (`view`) once a patient is chosen. It takes this page's place,
 * or returns to the Patients page already under it.
 */
export function NoVisit({ view, what }: { view: string; what: string }) {
  const navigation = useNavigation();
  return <Screen>
    <Insight eyebrow="No visit open">Choose a patient to open {what}</Insight>
    <Action label="Choose a patient" icon="person.crop.circle" onPress={() => openPatients(navigation, { view }, true)} />
  </Screen>;
}

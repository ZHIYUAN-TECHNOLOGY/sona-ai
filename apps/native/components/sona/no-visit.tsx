import { router } from "expo-router";
import { View } from "react-native";
import { Text } from "./text";
import { palette, type } from "./theme";
import { Action, CloseButton, Insight, Screen } from "./ui";

/**
 * A visit page opened without a visit (from a link, or after the visit closed): what it needs and the one way
 * on, the patient picker, which reopens this page (`view`) once a patient is chosen. `title` draws the header
 * row for modals that hide the native header, so Close is always there.
 */
export function NoVisit({ view, what, title }: { view: string; what: string; title?: string }) {
  return <Screen>
    {title ? <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
      <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>{title}</Text>
      <CloseButton />
    </View> : null}
    <Insight eyebrow="No visit open">Choose a patient to open {what}</Insight>
    <Action label="Choose a patient" icon="person.crop.circle" onPress={() => router.replace({ pathname: "/patients", params: { view } })} />
  </Screen>;
}

import { ScrollView, Text } from "react-native";
import { palette, type } from "@/lib/theme";
import { Card, Title } from "@/lib/ui";

/** Placeholder until its Phase 1 lane lands. */
export default function Screen() {
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 20 }}>
    <Title>My follow-ups</Title>
    <Card><Text style={{ ...type.body, color: palette.muted }}>Coming soon.</Text></Card>
  </ScrollView>;
}

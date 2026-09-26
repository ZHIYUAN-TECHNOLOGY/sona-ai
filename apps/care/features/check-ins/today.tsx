import { Text } from "react-native";
import { palette, type } from "@/lib/theme";
import { Card } from "@/lib/ui";

/**
 * Home's feature card: the one thing that needs the patient now (a due check-in, answered in place).
 * Lane A fills this in; until then it reassures. `useCheckInNeeds` counts toward the home's insight line.
 */
export function useCheckInNeeds() { return 0; }
export function TodayCard() {
  return <Card feature>
    <Text style={{ ...type.overline, color: palette.blue }}>Today</Text>
    <Text style={{ ...type.headline, color: palette.ink }}>You're all set</Text>
    <Text style={{ ...type.body, color: palette.muted }}>We'll ask how you're feeling on day 2 and day 7 after you go home.</Text>
  </Card>;
}

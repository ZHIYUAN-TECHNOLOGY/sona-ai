import { router } from "expo-router";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { Text } from "@/lib/text";
import { historyLine, shortDate, statusOf, type CheckIn } from "@/features/check-ins/model";
import { useCheckIns } from "@/features/check-ins/today";
import { palette, type } from "@/lib/theme";
import { BackButton, Button, Card, Section, Title } from "@/lib/ui";

/**
 * Past check-ins to review: the insight line (how many answered, what's next), then what we asked,
 * what they said and what happened, with the ones still to come apart. Answering stays on the home card.
 */
export default function Screen() {
  const { data } = useCheckIns();
  const now = new Date();
  const asked = data?.filter(c => c.replies.length || c.sentAt || c.dueAt <= now) ?? [];
  const coming = data?.filter(c => !asked.includes(c)) ?? [];
  const list = (items: CheckIn[]) => <Card style={{ paddingVertical: 6, gap: 0 }}>
    {items.map((c, i) => {
      const status = statusOf(c, now), reply = c.replies.at(-1);
      return <View key={c.id} accessible style={{ paddingVertical: 14, gap: 4, borderTopWidth: i ? 1 : 0, borderColor: "rgba(40,24,70,0.06)" }}>
        <Text style={{ ...type.headline, color: palette.ink }}>Day {c.day} · {shortDate(c.dueAt)}</Text>
        {(c.sentAt || reply) && <Text numberOfLines={2} style={{ ...type.footnote, color: palette.muted }}>{c.message}</Text>}
        {reply && <Text style={{ ...type.body, color: palette.ink }}>You said “{reply.text}”</Text>}
        <Text style={{ ...type.footnote, fontWeight: status.tone === "muted" ? "400" : "600", color: palette[status.tone] }}>{status.line}</Text>
      </View>;
    })}
  </Card>;
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }}>
      <BackButton />
    <Title accent="Check-ins" line={data ? historyLine(data, now) : undefined} />
    {!data ? <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start" }} /> : <>
      {asked.length > 0 && <><Section light="Asked" bold="so far" />{list(asked)}</>}
      {coming.length > 0 && <><Section light="Coming" bold="up" />{list(coming)}</>}
      <Button quiet label="Message your care team" onPress={() => router.push("/messages")} />
    </>}
  </ScrollView>;
}

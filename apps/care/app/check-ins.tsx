import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { shortDate, statusOf } from "@/features/check-ins/model";
import { useCheckIns } from "@/features/check-ins/today";
import { palette, type } from "@/lib/theme";
import { Card, Title } from "@/lib/ui";

/** Past check-ins to review: what we asked, what they said, and what happened next. Answering stays on the home card. */
export default function Screen() {
  const { data } = useCheckIns();
  const now = new Date();
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 20 }}>
    <Title line="Day 2 and day 7 after you went home.">Check-ins</Title>
    {!data ? <ActivityIndicator color={palette.muted} /> : <Card style={{ paddingVertical: 6, gap: 0 }}>
      {data.length ? data.map((c, i) => {
        const status = statusOf(c, now), reply = c.replies.at(-1);
        return <View key={c.id} accessible style={{ paddingVertical: 14, gap: 4, borderTopWidth: i ? 1 : 0, borderColor: "rgba(20,28,40,0.06)" }}>
          <Text style={{ ...type.headline, color: palette.ink }}>Day {c.day} · {shortDate(c.dueAt)}</Text>
          {(c.sentAt || reply) && <Text numberOfLines={2} style={{ ...type.footnote, color: palette.muted }}>{c.message}</Text>}
          {reply && <Text style={{ ...type.body, color: palette.ink }}>You said “{reply.text}”</Text>}
          <Text style={{ ...type.footnote, fontWeight: status.tone === "muted" ? "400" : "600", color: palette[status.tone] }}>{status.line}</Text>
        </View>;
      }) : <Text style={{ ...type.body, color: palette.muted, paddingVertical: 12 }}>No check-ins yet. They start after you go home.</Text>}
    </Card>}
  </ScrollView>;
}

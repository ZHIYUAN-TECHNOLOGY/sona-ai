import { router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { historyLine, shortDate, statusOf } from "@/features/check-ins/model";
import { useCheckIns } from "@/features/check-ins/today";
import { Capsule, Stop, STOP_TITLE, Timeline } from "@/features/follow-ups/timeline";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { BackButton, Button, surfaceStyle, Title } from "@/lib/ui";

const TONE = { muted: palette.muted, blue: palette.blue, amber: palette.amber, green: palette.green } as const;

/**
 * Past check-ins to review: the insight line (how many answered, what's next), then every check-in on the
 * kit's timeline in date order (a green check once answered, blue for the next open one): what we asked,
 * what they said and what happened. The one waiting links to the home card, where it is answered.
 */
export default function Screen() {
  const { data } = useCheckIns();
  const still = useReducedMotion();
  const now = new Date();
  const items = [...data ?? []].sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const lead = items.findIndex(c => !c.replies.length);
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 18 }}>
    <BackButton />
    <Title accent="Check-ins" line={data ? historyLine(data, now) : undefined} />
    {!data ? <ActivityIndicator color={palette.muted} style={{ alignSelf: "flex-start" }} /> : <>
      {items.length > 0 && <Timeline line={items.length > 1}>
        {items.map((c, i) => {
          const status = statusOf(c, now), reply = c.replies.at(-1), waiting = !reply && status.tone === "blue";
          return <Stop key={c.id} index={i} still={still} done={!!reply} lead={i === lead}>
            <View style={[surfaceStyle, { padding: 18, gap: 8 }]}>
              <View accessible style={{ gap: 8 }}>
                <Capsule>{shortDate(c.dueAt)}</Capsule>
                <Text style={STOP_TITLE}>Day {c.day} check-in</Text>
                {(c.sentAt || reply) && <Text numberOfLines={2} style={{ ...type.body, color: palette.muted }}>{c.message}</Text>}
                {reply && <Text style={{ ...type.body, color: palette.ink }}>You said “{reply.text}”</Text>}
                <Text style={{ ...type.body, fontWeight: status.tone === "muted" ? "400" : "600", color: TONE[status.tone] }}>{status.line}</Text>
              </View>
              {waiting && <Pressable accessibilityRole="button" onPress={() => router.navigate("/")}
                style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", alignSelf: "flex-start", marginBottom: -10, opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ ...type.body, fontWeight: "600", color: palette.blue }}>Answer now</Text>
              </Pressable>}
            </View>
          </Stop>;
        })}
      </Timeline>}
      <Button quiet label="Message your care team" onPress={() => router.push("/messages")} />
    </>}
  </ScrollView>;
}

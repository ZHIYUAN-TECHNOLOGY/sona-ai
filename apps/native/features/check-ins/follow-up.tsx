import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "@/components/sona/text";
import { palette, radius, type } from "@/components/sona/theme";
import { Chip, Icon } from "@/components/sona/ui";
import { haptic } from "@/features/clinical/medication-parts";
import { useEncounter } from "@/features/encounter/store";
import { api, errorText, useLive } from "@/features/live";
import { useLiveChanges } from "@/features/live/channel";

/*
 * Sona's follow-up under a patient's check-ins (live mode, where the visit's check-in agent runs): what
 * it did and why, newest last, then what it does next. Colour follows the reading (red urgent, amber
 * worse, green fine) and the next step is blue; routine sends stay ink. The latest three show, the rest
 * on a tap. With demo controls on, one tap moves the demo clock to just after that next step.
 */
type FollowUp = NonNullable<Awaited<ReturnType<typeof api.checkIns.followUp>>>;
const INK = { neutral: palette.ink, green: palette.green, amber: palette.amber, red: palette.red } as const;
const SHOWN = 3;
/** "Mon 28 Sep, 10:01" in the hospital's time zone, like the demo clock. */
const when = (at: string) => new Date(at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });

export function FollowUpTimeline({ encounterId }: { encounterId: string }) {
  const { on: live } = useLive();
  const { showDemoControls } = useEncounter();
  const [followUp, setFollowUp] = useState<FollowUp | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const read = useCallback(() => { if (live) void api.checkIns.followUp({ encounterId }).then(setFollowUp, () => {}); }, [live, encounterId]);
  useEffect(read, [read]);
  // Every check-in change (a send, a reply, the agent's own step) and every demo jump re-reads it.
  useLiveChanges(["checkIns"], read);
  if (!live || !followUp?.timeline.length) return null;
  const { timeline, next } = followUp;
  const earlier = timeline.length - SHOWN;
  const skip = () => {
    haptic("select"); setBusy(true); setError(undefined);
    api.demo.jump({ to: "next", encounterId }).then(read, e => setError(errorText(e))).finally(() => setBusy(false));
  };

  return <View style={{ gap: 8 }}>
    <Text style={{ ...type.overline, color: palette.muted }}>Sona's follow-up</Text>
    <View style={{ borderRadius: radius.group, borderCurve: "continuous", backgroundColor: palette.white, padding: 14, gap: 10 }}>
      {earlier > 0 && <Pressable accessibilityRole="button" accessibilityState={{ expanded: all }} onPress={() => setAll(a => !a)} hitSlop={8} style={{ alignSelf: "flex-start", minHeight: 28, justifyContent: "center" }}>
        <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{all ? "Show the latest only" : `Show ${earlier} earlier`}</Text>
      </Pressable>}
      {(all ? timeline : timeline.slice(-SHOWN)).map(e => <View key={`${e.at}·${e.text}`} accessible accessibilityLabel={`${when(e.at)}. ${e.text}`} style={{ flexDirection: "row", gap: 9 }}>
        <View style={{ width: 7, height: 7, borderRadius: 3.5, marginTop: 6, backgroundColor: e.tone === "neutral" ? palette.line : INK[e.tone] }} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text selectable style={{ ...type.footnote, fontWeight: e.tone === "neutral" ? "400" : "600", color: INK[e.tone] }}>{e.text}</Text>
          <Text style={{ ...type.caption, color: palette.muted, fontVariant: ["tabular-nums"] }}>{when(e.at)}</Text>
        </View>
      </View>)}
      {next ? <View accessible accessibilityLabel={`Next: ${next.text}, ${when(next.at)}`} style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        <Icon name="arrow.forward.circle.fill" size={14} color={palette.blue} />
        <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue, flexShrink: 1 }}>Next: {next.text} · {when(next.at)}</Text>
      </View> : <Text style={{ ...type.footnote, color: palette.muted }}>Nothing more planned</Text>}
    </View>
    {showDemoControls && next && <Chip label={busy ? "Moving…" : "Skip to next step"} icon={<Icon name="forward.end.fill" size={13} color={palette.ink} />}
      accessibilityLabel={`Demo clock: skip to ${when(next.at)}`} onPress={busy ? () => {} : skip} />}
    {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
  </View>;
}

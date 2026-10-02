import { useMemo, useState } from "react";
import { View } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { BarChart } from "@/components/charts/bar-chart";
import { useLang } from "@/lib/i18n";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { dayLine, weekSaid, type StripDay } from "./strip";

// A missed or empty day still shows a stub, so no day reads as absent.
const STUB = 0.1, NEUTRAL = "rgba(31,31,31,0.12)";

/** A day's bar: green all taken, amber some, red a stub when none were; today still going in blue; free days and days ahead a grey stub. */
function barOf(d: StripDay) {
  const done = d.done ?? 0, due = d.due ?? 0;
  if (!due) return { value: STUB, color: NEUTRAL };
  if (done === due) return { value: 1, color: palette.success };
  if (d.today && d.state !== "none") return { value: Math.max(done / due, STUB), color: done ? palette.info : NEUTRAL };
  // Missed is the darker orange, not red: red stays for "call the hospital now" (lib/theme.ts).
  return done ? { value: done / due, color: palette.warning } : { value: STUB, color: palette.amber };
}

/**
 * Doses taken per day as bars (0 to 1 of what was due), one-letter days under them, today's in bold ink.
 * Home's tile shows it still (the tile is the button); the Medicine tab lets a tap or sideways scrub pick a
 * day and says it in one line underneath. Read out as one line either way.
 */
export function WeekChart({ days, height, interactive }: { days: StripDay[]; height: number; interactive?: boolean }) {
  const lang = useLang();
  const reduced = useReducedMotion();
  const [picked, setPicked] = useState<number>();
  // The clock ticks every 30 s; only a changed count should re-draw (and re-morph) the bars.
  const sig = days.map(d => `${d.key}:${d.done}/${d.due}:${d.state}`).join();
  const data = useMemo(() => days.map(d => ({ label: d.narrow, ...barOf(d) })), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = picked !== undefined ? days[picked] : undefined;
  return <View style={{ gap: 6 }}>
    <View accessible accessibilityRole="image" accessibilityLabel={weekSaid(days, lang)} pointerEvents={interactive ? "auto" : "none"}>
      <BarChart.Root data={data} maxY={1} leftInset={0} topInset={4} bottomInset={22} animate={!reduced} enablePan={!!interactive}
        onBarChange={(_, i) => setPicked(i)} style={{ height }}>
        <BarChart.Bars />
        <BarChart.XAxis style={{ fontSize: 12, lineHeight: 16, fontWeight: "500", color: palette.faint }}
          styleFor={(_, i) => days[i]?.today ? { fontWeight: "700", color: palette.ink } : undefined} />
      </BarChart.Root>
    </View>
    {pick && <Animated.View key={pick.key} entering={reduced ? undefined : FadeIn.duration(160)}>
      <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>{dayLine(pick, lang)}</Text>
    </Animated.View>}
  </View>;
}

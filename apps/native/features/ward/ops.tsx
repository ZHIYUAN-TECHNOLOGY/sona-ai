import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { BarChart } from "@/components/charts/bar-chart";
import { SampleLabel } from "@/components/sona/model-answer";
import { LAYOUT, LAYOUT_SPRING, riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, Expand, Icon, Surface, Tone, pillStyle, useAccessibleEffects } from "@/components/sona/ui";
import { haptic } from "@/features/clinical/medication-parts";
import { useWard } from "@/features/day/use-counts";
import { api, useLive } from "@/features/live";
import { useLiveChanges } from "@/features/live/channel";
import { useFindings } from "@/features/live/findings-sync";
import { useServerForecast } from "@/features/live/ward-sync";
import { bedBar, bedKind, clockLabel, filterSegments, forecastBeds, forecastLine, freeingWindows, wardSummary, type Bed, type BedForecast, type BedKind, type Owner, type WardFilter } from "./model";

/*
 * Ward summary, minimal (after 60fps "Ultrahuman Positive Recovery Text Animation",
 * https://60fps.design/shots/ultrahuman-positive-recovery-text-animation): one headline, one range
 * bar of the beds, and the week's detail revealed on demand with a staggered fade/slide-up.
 *
 * The ops counter (live mode): this week's numbers for ward and hospital management, counted by the
 * server from the loops' own rows (ops.get), and re-read whenever a discharge, check-in, finding or
 * dose changes, so they tick up during the demo. Lost follow-ups turn amber above zero.
 */
type Ops = Awaited<ReturnType<typeof api.ops.get>>;
const TEAL = palette.green;
// One colour mapping (components/sona/tone.ts): blocked is amber (soon or blocked), fit green, watch a paler amber, the rest neutral.
export const KIND: Record<BedKind, string> = { blocked: palette.amber, fit: TEAL, watch: "#D9AE72", other: "#CDD2D9" };

export const hoursMinutes = (mins: number) => {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h ? `${h} h${m ? ` ${m} m` : ""}` : `${m} m`;
};

/**
 * One segment per bed, coloured by what it needs; the segments grow in on mount (static under Reduce Motion).
 * With `onFilter` (the ward screen) only the filter shows, carrying the same colours; elsewhere each legend count opens the ward filtered to it.
 */
export function BedBar({ beds, filter, onFilter }: { beds: Bed[]; filter?: WardFilter; onFilter?: (f: WardFilter) => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const { segments, legend, label } = bedBar(beds);
  return <View style={{ gap: 10 }}>
    {/* On the ward screen the filter carries the colours, so the bar is left out there. */}
    {!onFilter && <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ flexDirection: "row", gap: 3, height: 11 }}>
      {segments.map((k, i) => <Animated.View key={i} entering={reducedMotion ? undefined : riseIn({ delay: i * 35, distance: 4, scale: 0.5, duration: 320 })} style={{ flex: 1 }}>
        {/* A picked status dims the others, so the bar and the filter read as one control. */}
        <Animated.View style={{ flex: 1, borderRadius: 5.5, borderCurve: "continuous", backgroundColor: KIND[k], opacity: filter && filter !== "all" && k !== filter ? 0.25 : 1, transitionProperty: "opacity", transitionDuration: 240 } as never} />
      </Animated.View>)}
    </View>}
    {onFilter && filter ? <Segmented beds={beds} value={filter} onChange={onFilter} /> : <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14 }}>
      {legend.map(l => <Pressable key={l.kind} accessibilityRole="button" accessibilityLabel={`Show ${l.count} ${l.label} bed${l.count === 1 ? "" : "s"}`}
        onPress={() => router.push({ pathname: "/ward", params: { filter: l.kind } })} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: KIND[l.kind] }} />
        <Text style={{ ...type.footnote, color: palette.muted }}><Text style={{ fontWeight: "700", color: palette.ink, fontVariant: ["tabular-nums"] }}>{l.count}</Text> {l.label}</Text>
      </Pressable>)}
    </View>}
  </View>;
}

/*
 * The legend as a segmented filter (after 60fps "Revolut Number of Transactions Interaction",
 * https://60fps.design/shots/revolut-number-of-transactions-interaction): a glass track, one pill that
 * slides to the picked status on the layout spring, and the ward's list springs its rows in and out in place.
 * At large text the track scrolls sideways, with a fade on the edge while more is off it.
 */
function Segmented({ beds, value, onChange }: { beds: Bed[]; value: WardFilter; onChange: (f: WardFilter) => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const spots = useRef<Partial<Record<WardFilter, { x: number; w: number }>>>({});
  const x = useSharedValue(0), w = useSharedValue(0);
  const place = (animate: boolean) => {
    const s = spots.current[value];
    if (!s) return;
    const to = (v: number) => animate && !reducedMotion ? withSpring(v, LAYOUT_SPRING) : v;
    x.set(to(s.x)); w.set(to(s.w));
  };
  useEffect(() => place(true), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const pill = useAnimatedStyle(() => ({ left: x.value, width: w.value, opacity: w.value ? 1 : 0 }));
  const [edge, setEdge] = useState({ view: 0, content: 0, at: 0 });
  const more = edge.content - edge.view - edge.at > 4;
  return <View style={{ ...pillStyle, borderRadius: radius.group, borderCurve: "continuous" }}>
    <ScrollView horizontal accessibilityRole="tablist" showsHorizontalScrollIndicator={false} scrollEventThrottle={32} style={{ borderRadius: radius.group, borderCurve: "continuous" }} contentContainerStyle={{ flexGrow: 1, padding: 3 }}
      onLayout={e => { const view = e.nativeEvent.layout.width; setEdge(s => ({ ...s, view })); }} onContentSizeChange={content => setEdge(s => ({ ...s, content }))}
      onScroll={e => { const at = e.nativeEvent.contentOffset.x; setEdge(s => Math.abs(s.at - at) > 2 ? { ...s, at } : s); }}>
    <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 3, bottom: 3, borderRadius: radius.group, borderCurve: "continuous", backgroundColor: palette.white, boxShadow: "0 0 0 0.5px rgba(20,28,40,0.06), 0 2px 8px rgba(40,70,140,0.14)" }, pill]} />
    {filterSegments(beds, value).map(s => { const on = s.key === value; return <Pressable key={s.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${s.label}, ${s.count} bed${s.count === 1 ? "" : "s"}`}
      hitSlop={{ top: 4, bottom: 4 }} onPress={() => { if (!on) { haptic("select"); onChange(s.key); } }}
      onLayout={e => { const first = !spots.current[s.key]; spots.current[s.key] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width }; if (on) place(!first); }}
      style={{ flexGrow: 1, minHeight: 40, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 }}>
      {s.key !== "all" && <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: KIND[s.key] }} />}
      <Text numberOfLines={1} style={{ ...type.footnote, fontWeight: on ? "600" : "500", color: on ? palette.ink : palette.muted }}>{s.label} <Text style={{ fontWeight: "700", fontVariant: ["tabular-nums"], color: on ? palette.ink : palette.muted }}>{s.count}</Text></Text>
    </Pressable>; })}
    </ScrollView>
    {more && <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 32, borderTopRightRadius: radius.group, borderBottomRightRadius: radius.group, experimental_backgroundImage: "linear-gradient(to right, rgba(245,246,248,0) 0%, rgba(245,246,248,0.96) 100%)" }} />}
  </View>;
}

/** This week, collapsed to its one number (bed time saved); the six ops stats open as a quiet list. */
export function ThisWeek({ divider }: { divider?: boolean } = {}) {
  const { on } = useLive();
  const { reducedMotion } = useAccessibleEffects();
  const [ops, setOps] = useState<Ops>();
  const [open, setOpen] = useState(false);
  const read = useCallback(() => { void api.ops.get().then(setOps, () => {}); }, []);
  useEffect(() => { if (on) read(); }, [on, read]);
  useLiveChanges(["ward", "day", "checkIns", "findings"], read);
  if (!on || !ops) return null;
  const rows: { value: string; label: string; tone?: "good" | "warn" }[] = [
    { value: hoursMinutes(ops.bedMinutesSaved), label: `Bed time saved · ${ops.discharges} discharge${ops.discharges === 1 ? "" : "s"}`, tone: ops.bedMinutesSaved ? "good" : undefined },
    { value: `${ops.redFlagsActedOn} of ${ops.redFlags}`, label: "Red flags acted on", tone: ops.redFlags && ops.redFlagsActedOn < ops.redFlags ? "warn" : ops.redFlags ? "good" : undefined },
    { value: ops.medianMinutesToBook === null ? "–" : hoursMinutes(ops.medianMinutesToBook), label: "Flag → booked (median)" },
    { value: `${ops.checkInsAnswered} of ${ops.checkInsSent}`, label: "Check-ins answered" },
    { value: `${ops.lostFollowUps}`, label: `Lost X-ray follow-ups · ${ops.trackedFollowUps} tracked`, tone: ops.lostFollowUps ? "warn" : "good" },
    { value: ops.dosesDue ? `${Math.round((ops.dosesTaken / ops.dosesDue) * 100)}%` : "–", label: "Doses taken (Sona Care)" },
  ];
  const saved = rows[0];
  return <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={divider ? { borderTopWidth: 1, borderColor: "rgba(20,28,40,0.06)" } : undefined}>
    <Pressable accessibilityRole="button" accessibilityLabel={`This week: ${saved.value} bed time saved`} accessibilityHint={open ? "Hides this week's numbers" : "Shows this week's numbers"}
      accessibilityState={{ expanded: open }} onPress={() => setOpen(v => !v)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text style={{ ...type.subhead, flex: 1, color: palette.muted }}><Text style={{ fontWeight: "700", color: saved.tone ? TEAL : palette.ink, fontVariant: ["tabular-nums"] }}>{saved.value}</Text> bed time saved</Text>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>This week</Text>
      <Icon name={open ? "chevron.up" : "chevron.right"} size={11} color={palette.blue} />
    </Pressable>
    {open && <Expand>
      <View accessible accessibilityLabel={`This week, counted from records. ${rows.map(r => `${r.label}: ${r.value}`).join(". ")}.`} style={{ paddingBottom: 2 }}>
        {rows.map((r, i) => <Animated.View key={r.label} entering={reducedMotion ? undefined : riseIn({ delay: 60 + i * 45, distance: 8, duration: 300 })}
          style={{ flexDirection: "row", alignItems: "baseline", gap: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: "rgba(20,28,40,0.06)" }}>
          <Text numberOfLines={2} style={{ ...type.footnote, flex: 1, color: palette.muted }}>{r.label}</Text>
          <Text style={{ ...type.subhead, fontWeight: "600", fontVariant: ["tabular-nums"], color: r.tone === "warn" ? palette.amber : r.tone === "good" ? TEAL : palette.ink }}>{r.value}</Text>
        </Animated.View>)}
        <Text style={{ ...type.caption, color: palette.muted, paddingTop: 4 }}>Counted from records</Text>
      </View>
    </Expand>}
  </Animated.View>;
}

/** Where the ward stands, in one line. The ward page opens with it and management's My Day leads with it, so the two never disagree. */
export function wardLine(beds: Bed[]) {
  const { blocked, bedHours, fit } = wardSummary(beds);
  return blocked ? <><Tone of="soon">{blocked} discharge{blocked === 1 ? "" : "s"} blocked</Tone> · {`~${bedHours}\u00A0bed‑hours\u00A0waiting`}</>
    : <><Tone of="good">Nothing is holding a bed</Tone>{fit ? ` · ${fit} fit to go` : ""}</>;
}

/**
 * Management's My Day lead (instead of clinical tasks): one line on where the ward stands, the bed
 * bar, this week's number (the rest on demand), and one quiet way into the ward to act on it.
 */
export function WardGlance() {
  const { findings } = useFindings();
  const { reducedMotion } = useAccessibleEffects();
  const { beds, loading } = useWard();
  const forecast = useForecast(beds, findings);
  const blocked = wardSummary(beds).blocked;
  return <Surface feature layout={reducedMotion ? undefined : LAYOUT} style={{ padding: 16, gap: 14 }}>
    <View style={{ gap: 4 }}>
      <Text style={{ ...type.overline, color: blocked ? palette.amber : palette.blue }}>Ward now</Text>
      <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{loading ? "Reading the ward…" : wardLine(beds)}</Text>
    </View>
    <View>
      <BedBar beds={beds} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Forecast: ${forecast.label}`} accessibilityHint="Opens the ward's forecast"
        onPress={() => router.push({ pathname: "/ward", params: { at: "forecast" } })} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="clock" size={12} color={TEAL} />
        <Text numberOfLines={1} style={{ ...type.footnote, flex: 1, fontWeight: "600", color: TEAL }}>{forecastLine(forecast)}</Text>
        <Icon name="chevron.right" size={11} color={TEAL} />
      </Pressable>
    </View>
    <ThisWeek />
    <Action label="Open the ward" icon="bed.double" onPress={() => router.push("/ward")} />
  </Surface>;
}

/** The bed forecast: the server's in live mode (demo clock, saved owners), else the same rule over the fixture ward on the device clock. */
export function useForecast(beds: Bed[], key?: unknown, owners: Record<string, Owner | undefined> = {}): BedForecast {
  return useServerForecast(key) ?? forecastBeds(beds, new Date(), owners);
}

/*
 * "Next 24 h" (glance-to-decision): the headline count, then one bar per 3-hour window of the beds that free in it
 * (reacticx bar chart, components/charts/bar-chart), coloured by the window's most urgent bed: amber means a blocker
 * still holds one there, so chasing it moves that bar left. Drag across to scrub, tap a bar for its beds; each bed
 * opens its card. Reduce Motion: the bars stand still. What to chase lives in the No owner card above, not here.
 */
export function ForecastTimeline({ beds, forecast, onOpen }: { beds: Bed[]; forecast: BedForecast; onOpen: (bed: string) => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const windows = useMemo(() => freeingWindows(forecast, beds), [forecast, beds]);
  const [picked, setPicked] = useState<number>();
  // A picked window stays marked: the other bars fade back (hex colours take an alpha suffix).
  const data = useMemo(() => windows.map((w, i) => {
    const c = w.entries.length ? KIND[w.kind] : "rgba(20,28,40,0.06)";
    return { label: w.label, value: w.entries.length, color: picked !== undefined && i !== picked && c.length === 7 ? `${c}59` : c };
  }), [windows, picked]);
  const top = Math.max(2, ...data.map(d => d.value));
  const now = new Date(forecast.now).getTime();
  const count = forecast.today.count;
  const w = picked === undefined ? undefined : windows[picked];
  // Part of the page's glance under the headline: on the canvas, not a card.
  return <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ gap: 10 }}>
    <View>
      <Text style={{ ...type.subhead, color: palette.muted }}>
        <Text style={{ fontWeight: "700", color: palette.ink, fontVariant: ["tabular-nums"] }}>{count}</Text> bed{count === 1 ? "" : "s"} free {count ? forecast.today.byTime : "today"} · <Text style={{ fontWeight: "700", color: palette.ink, fontVariant: ["tabular-nums"] }}>{forecast.tomorrow.count}</Text> tomorrow · next 24 h
      </Text>
    </View>
    {/* The chart reads as one image (the spoken forecast); the beds of a picked window are their own stops below. */}
    <View accessible accessibilityRole="image" accessibilityLabel={`Beds freeing in the next 24 hours. ${forecast.label}`}>
      <BarChart data={data} maxY={top} tickCount={top + 1 <= 5 ? top + 1 : 3} barRatio={0.56} leftInset={18} bottomInset={22} topInset={6} animate={!reducedMotion} style={{ height: 96 }}
        onBarChange={(_, i) => { haptic("select"); setPicked(p => p === i && !windows[i]!.entries.length ? undefined : i); }}>
        <BarChart.Grid color="rgba(20,28,40,0.05)" />
        <BarChart.Highlight color="rgba(20,28,40,0.05)" radius={8} inset={4} />
        <BarChart.Bars radius={5} activeColor={palette.ink} />
        <BarChart.YAxis format={v => (Number.isInteger(v) && v ? String(v) : "")} style={{ ...type.caption, color: palette.placeholder }} />
        <BarChart.XAxis format={p => p.label.replace(" ", "")} style={{ fontSize: 11, color: palette.muted }} activeStyle={{ color: palette.ink }} />
      </BarChart>
    </View>
    {w ? <Expand key={picked} style={{ gap: 6 }}>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink }}>{picked ? `${clockLabel(w.from)} – ${clockLabel(w.to)}` : `Now – ${clockLabel(w.to)}`}{w.entries.length ? "" : " · no beds free"}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {w.entries.map(e => { const b = beds.find(x => x.bed === e.bed); const t = new Date(e.at).getTime() <= now ? "now" : clockLabel(new Date(e.at));
          return <Pressable key={e.bed} accessibilityRole="button" accessibilityLabel={`${e.bed}${e.name ? `, ${e.name.split(" ")[0]}` : ""}, free ${t === "now" ? "now" : `at ${t}`}, ${e.confidence} confidence. ${e.reasons.join(", ")}`} accessibilityHint={b?.name ? "Opens the bed" : undefined}
            disabled={!b?.name} onPress={() => onOpen(e.bed)} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(244,246,250,0.9)", borderWidth: 1, borderColor: "rgba(20,28,40,0.06)" }}>
            <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: KIND[b ? bedKind(b) : "other"] }} />
            <Text style={{ ...type.footnote, color: palette.ink }}><Text style={{ fontWeight: "600" }}>{e.bed}</Text> · {t}</Text>
          </Pressable>; })}
      </View>
    </Expand>
    : null}
    {/* The key and the honesty label share one line. */}
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 4 }}>
      <Text style={{ ...type.caption, flex: 1, minWidth: 180, color: palette.muted }}>{w ? "Tap a bed to open it" : "Amber: a blocker holds a bed · tap a bar"}</Text>
      <SampleLabel source="fixture" rule />
    </View>
  </Animated.View>;
}

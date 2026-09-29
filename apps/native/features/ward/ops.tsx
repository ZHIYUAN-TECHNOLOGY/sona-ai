import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { SampleLabel } from "@/components/sona/model-answer";
import { LAYOUT, LAYOUT_SPRING, riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Expand, Icon, Surface, Tone, pillStyle, useAccessibleEffects } from "@/components/sona/ui";
import { haptic } from "@/features/clinical/medication-parts";
import { useEncounter } from "@/features/encounter/store";
import { api, useLive } from "@/features/live";
import { useLiveChanges } from "@/features/live/channel";
import { useFindings } from "@/features/live/findings-sync";
import { useServerBeds, useServerForecast } from "@/features/live/ward-sync";
import { bedBar, bedKind, clockLabel, filterSegments, forecastBeds, forecastLine, wardBeds, wardSummary, type Bed, type BedForecast, type BedKind, type Owner, type WardFilter } from "./model";

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
const TEAL = "#0F6E66";
// Blocked is the one to act on, so it alone reads red; watch stays a quiet amber.
export const KIND: Record<BedKind, string> = { blocked: palette.red, fit: TEAL, watch: "#D9AE72", other: "#CDD2D9" };

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
  return <View accessibilityRole="tablist" style={{ ...pillStyle, flexDirection: "row", padding: 3, borderRadius: 22, borderCurve: "continuous" }}>
    <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 3, bottom: 3, borderRadius: 19, borderCurve: "continuous", backgroundColor: palette.white, boxShadow: "0 0 0 0.5px rgba(20,28,40,0.06), 0 2px 8px rgba(40,70,140,0.14)" }, pill]} />
    {filterSegments(beds, value).map(s => { const on = s.key === value; return <Pressable key={s.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${s.label}, ${s.count} bed${s.count === 1 ? "" : "s"}`}
      hitSlop={{ top: 4, bottom: 4 }} onPress={() => { if (!on) { haptic("select"); onChange(s.key); } }}
      onLayout={e => { const first = !spots.current[s.key]; spots.current[s.key] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width }; if (on) place(!first); }}
      style={{ flexGrow: 1, minHeight: 40, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 }}>
      {s.key !== "all" && <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: KIND[s.key] }} />}
      <Text numberOfLines={1} style={{ ...type.footnote, fontWeight: on ? "600" : "500", color: on ? palette.ink : palette.muted }}>{s.label} <Text style={{ fontWeight: "700", fontVariant: ["tabular-nums"], color: on ? palette.ink : palette.muted }}>{s.count}</Text></Text>
    </Pressable>; })}
  </View>;
}

/** This week, collapsed to its one number (bed time saved); the six ops stats open as a quiet list. */
export function ThisWeek() {
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
  return <Animated.View layout={reducedMotion ? undefined : LAYOUT}>
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
  return blocked ? <><Tone of="urgent">{blocked} discharge{blocked === 1 ? "" : "s"} blocked</Tone> · ~{bedHours} bed‑hours waiting</>
    : <><Tone of="good">Nothing is holding a bed</Tone>{fit ? ` · ${fit} fit to go` : ""}</>;
}

/**
 * Management's My Day lead (instead of clinical tasks): one line on where the ward stands, the bed
 * bar, this week's number (the rest on demand), and one quiet way into the ward to act on it.
 */
export function WardGlance() {
  const { patients, encounters } = useEncounter();
  const { findings } = useFindings();
  const { reducedMotion } = useAccessibleEffects();
  const beds = useServerBeds(findings) ?? wardBeds(patients, encounters);
  const forecast = useForecast(beds, findings);
  const blocked = wardSummary(beds).blocked;
  return <Surface feature layout={reducedMotion ? undefined : LAYOUT} style={{ padding: 16, gap: 14 }}>
    <View style={{ gap: 4 }}>
      <Text style={{ ...type.overline, color: blocked ? palette.red : palette.blue }}>Ward now</Text>
      <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{wardLine(beds)}</Text>
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

const WINDOW = 24 * 3_600_000, DOT = 12;

/*
 * "Next 24 h": one axis from now to +24 h, a dot per bed at its forecast free time (bed-kind colour;
 * filled high confidence, ringed medium, hollow low), rising in on a short stagger (still under
 * Reduce Motion). Tap or hold a dot for its bed, time and reasons. Below, the blocker that frees the
 * most bed-hours, with its owner and one tap into that bed's card.
 */
export function ForecastTimeline({ beds, forecast, onOpen }: { beds: Bed[]; forecast: BedForecast; onOpen: (bed: string, blockerId: string) => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<string>();
  // The axis runs on the forecast's own clock (the server's demo clock in live mode).
  const now = new Date(forecast.now).getTime();
  const dots = forecast.timeline.filter(e => new Date(e.at).getTime() - now <= WINDOW);
  const x = (at: Date) => Math.max(0, Math.min(1, (new Date(at).getTime() - now) / WINDOW)) * (width - DOT);
  // Beds at the same moment stack upward rather than hide each other.
  const lift = dots.map((e, i) => dots.slice(0, i).filter(o => Math.abs(x(o.at) - x(e.at)) < DOT).length);
  const mid = x(forecast.midnight);
  const selected = dots.find(e => e.bed === picked);
  const bedOf = (id: string) => beds.find(b => b.bed === id);
  const u = forecast.unlock;
  const count = forecast.today.count;
  return <Surface layout={reducedMotion ? undefined : LAYOUT} style={{ padding: 16, gap: 12 }}>
    <View style={{ gap: 2 }}>
      <Text style={{ ...type.overline, color: TEAL }}>Next 24 h</Text>
      <Text style={{ ...type.subhead, color: palette.muted }}>
        <Text style={{ fontWeight: "700", color: palette.ink, fontVariant: ["tabular-nums"] }}>{count}</Text> bed{count === 1 ? "" : "s"} free {count ? forecast.today.byTime : "today"} · <Text style={{ fontWeight: "700", color: palette.ink, fontVariant: ["tabular-nums"] }}>{forecast.tomorrow.count}</Text> tomorrow
      </Text>
    </View>

    <View accessible accessibilityRole="image" accessibilityLabel={forecast.label} onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ height: 64 }}>
      <View style={{ position: "absolute", left: DOT / 2, right: DOT / 2, bottom: 20, height: 2, borderRadius: 1, backgroundColor: "rgba(20,28,40,0.08)" }} />
      {width > 0 && <View style={{ position: "absolute", left: mid + DOT / 2, bottom: 14, width: 1, height: 14, backgroundColor: "rgba(20,28,40,0.18)" }} />}
      {width > 0 && dots.map((e, i) => {
        const color = KIND[bedOf(e.bed) ? bedKind(bedOf(e.bed)!) : "other"];
        const on = e.bed === picked;
        return <Animated.View key={e.bed} entering={reducedMotion ? undefined : riseIn({ delay: i * 45, distance: 8, scale: 0.4, duration: 300 })}
          style={{ position: "absolute", left: x(e.at) + DOT / 2 - 22, bottom: 21 - 22 + lift[i]! * (DOT + 2) }}>
          <Pressable onPress={() => { haptic("select"); setPicked(on ? undefined : e.bed); }} onLongPress={() => { haptic("select"); setPicked(e.bed); }}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2, borderColor: color, transform: [{ scale: on ? 1.35 : 1 }],
              backgroundColor: e.confidence === "high" ? color : e.confidence === "medium" ? `${color}66` : palette.white }} />
          </Pressable>
        </Animated.View>;
      })}
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 16 }}>
        <Text style={{ ...type.caption, position: "absolute", left: 0, color: palette.muted }}>Now</Text>
        {/* Midnight splits today from tomorrow; its label hides when it would crowd "Now" or "+24 h". */}
        {width > 0 && mid > 44 && mid < width - 72 && <Text style={{ ...type.caption, position: "absolute", left: mid - 12, color: palette.muted }}>12 am</Text>}
        <Text style={{ ...type.caption, position: "absolute", right: 0, color: palette.muted }}>+24 h</Text>
      </View>
    </View>

    {selected && <Expand>
      <Text style={{ ...type.footnote, color: palette.muted }}>
        <Text style={{ fontWeight: "700", color: palette.ink }}>{selected.bed}{selected.name ? ` · ${selected.name.split(" ")[0]}` : ""} · {new Date(selected.at).getTime() <= now ? "now" : clockLabel(new Date(selected.at))}</Text> · {selected.reasons.join(", ")}
      </Text>
    </Expand>}

    {u && <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 10, borderTopWidth: 1, borderColor: "rgba(20,28,40,0.06)" }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.overline, color: palette.blue }}>Frees fastest</Text>
        <Text style={{ ...type.subhead, color: palette.ink }}>{u.line}</Text>
        <Text style={{ ...type.caption, color: palette.muted }}>{u.owned ? `Owner · ${u.owner}` : `No owner yet · ${u.owner} suggested`}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${u.line}. ${u.owned ? `Owner ${u.owner}` : `No owner yet, ${u.owner} suggested`}. Open ${u.bed}`} hitSlop={7}
        onPress={() => { haptic("select"); onOpen(u.bed, u.blockerId); }}
        style={{ minHeight: 30, paddingHorizontal: 12, borderRadius: 15, justifyContent: "center", backgroundColor: palette.blue }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: palette.white }}>Open {u.bed}</Text>
      </Pressable>
    </View>}

    <Text style={{ ...type.caption, color: palette.muted }}>Forecast from today's blockers and planned times</Text>
    <SampleLabel source="fixture" rule />
  </Surface>;
}

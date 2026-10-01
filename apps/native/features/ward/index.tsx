import { router, useLocalSearchParams } from "expo-router";
import { MarkedText } from "@/components/sona/marked-text";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeOutUp, ZoomIn, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, Expand, Icon, Insight, Surface, canvasImage, glass, tone as INK, useAccessibleEffects } from "@/components/sona/ui";
import { mostUrgent } from "@/components/sona/tone";
import { ASK_SPACE, WithSona } from "@/features/ask";
import { soonest } from "@/features/ask/answers";
import { haptic } from "@/features/clinical/medication-parts";
import { useEncounter } from "@/features/encounter/store";
import { ErrorLine, PressScale } from "@/components/sona/parts";
import { api, errorText, useLive } from "@/features/live";
import { useRole } from "@/features/live/roles";
import { FollowUpList } from "@/features/findings";
import { useFindings } from "@/features/live/findings-sync";
import { useServerEncounter } from "@/features/live/sync";
import { Drafting, SampleLabel } from "@/components/sona/model-answer";
import { useLiveHuddle } from "@/features/live/model-sync";
import { useLiveChanges } from "@/features/live/channel";
import { BedBar, ForecastTimeline, KIND, ThisWeek, useForecast, wardLine } from "./ops";
import { useWard } from "@/features/day/use-counts";
import { DEMO_PATIENT, OWNERS, SUGGESTED, asFilter, bedKind, bedRow, defaultFilter, emptyLine, filterBeds, huddle, ownerReceipt, type Bed, type Owner, type WardFilter } from "./model";
import { useWardOwners } from "./owners";

/*
 * Ward command view: one insight line on where the ward stands, the huddle brief as the page's one
 * feature card, the legend as the filter (Blocked first when anything is), and one glass list of the filtered beds; rows spring in and out in place on a filter change (after 60fps
 * "Revolut Number of Transactions Interaction", https://60fps.design/shots/revolut-number-of-transactions-interaction).
 * Tapping a row grows it into the bed's card (after Trackables' card-to-screen morph; spring 0.48 s at
 * damping 0.82) while the list fades back, the row's face crossfades out and the detail fades in
 * 120 ms later. Closing shrinks it back into the row (0.46 s at 0.84). Each blocker takes an owner in
 * one tap; the owner's badge pops onto the row. The forecast and the week sit below.
 */
const TEAL = palette.green;
// Screen's canvas. The ward keeps its own ScrollView because Screen takes no ref and the forecast link scrolls to its section.
const OPEN = { duration: 480, dampingRatio: 0.82 }, CLOSE = { duration: 460, dampingRatio: 0.84 };
type Rect = { x: number; y: number; w: number; h: number };
const TONE: Record<Bed["status"], { label: string; tone: "good" | "soon" | "calm" }> = {
  fit: { label: "Fit to go", tone: "good" },
  watch: { label: "Watch", tone: "soon" },
  stable: { label: "Stable", tone: "calm" },
  empty: { label: "Empty", tone: "calm" },
  free: { label: "Freed", tone: "good" },
};
/**
 * A bed's state in one label and colour, the most urgent of its status and what holds it: a fit bed
 * with a blocker is amber "Blocked · fit to go clinically", never green above its blockers.
 */
function bedTone(bed: Bed) {
  const blocked = bedKind(bed) === "blocked";
  const t = mostUrgent([TONE[bed.status].tone, ...bed.blockers.map(() => "soon" as const)]);
  return { label: blocked ? "Blocked · fit to go clinically" : TONE[bed.status].label, ink: t === "calm" ? palette.muted : INK[t] };
}

export function WardScreen() {
  const { patients, selectPatient } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Live mode: every bed comes from the server, and nothing shows until it arrives (useWard). Amelia's
  // encounter is pulled too, so the discharge screen opened from bed 6 starts from the server's record.
  useServerEncounter(patients.find(p => p.id === DEMO_PATIENT));
  const { findings } = useFindings();
  const { beds, loading } = useWard();
  const [briefed, setBriefed] = useState(false);
  const [open, setOpen] = useState<{ bed: string; from: Rect; focus?: string }>();
  const root = useRef<View>(null);
  const scroll = useRef<ScrollView>(null);
  const scrolledToForecast = useRef(false);
  const tiles = useRef<Record<string, View | null>>({});
  const p = useSharedValue(0);
  // Opened from My Day's legend the ward starts on that status; otherwise on Blocked when anything is.
  const params = useLocalSearchParams<{ filter?: string; at?: string; bed?: string }>();
  const [picked, setPicked] = useState<WardFilter>();
  const filter = picked ?? asFilter(params.filter) ?? defaultFilter(beds);
  const shown = filterBeds(beds, filter);
  const motion = reducedMotion ? undefined : LAYOUT;
  // The page draws under the translucent header, so the open card starts below it.

  const openBed = (bed: Bed, focus?: string) => {
    const tile = tiles.current[bed.bed];
    if (!tile || !root.current) return;
    haptic("select");
    root.current.measureInWindow((rx, ry) => tile.measureInWindow((x, y, w, h) => {
      setOpen({ bed: bed.bed, from: { x: x - rx, y: y - ry, w, h }, focus });
      p.set(0);
      p.set(reducedMotion ? withTiming(1, { duration: 200 }) : withSpring(1, OPEN));
    }));
  };
  const close = () => {
    const done = () => setOpen(undefined);
    p.set(reducedMotion ? withTiming(0, { duration: 160 }, fin => { if (fin) scheduleOnRN(done); }) : withSpring(0, CLOSE, fin => { if (fin) scheduleOnRN(done); }));
  };
  const { on: live } = useLive();
  const { can } = useRole();
  // Owners outlive the screen (a shared store), so leaving the Ward and coming back keeps them.
  const { owners, told, setOwners, setTold } = useWardOwners(live);
  const [assignError, setAssignError] = useState<{ id: string; owner: Owner; text: string }>();
  // Live: server beds carry the server's blocker IDs, so each owner is a real task on the server;
  // tapping the chosen owner again clears it there too. A refusal puts the previous owner back and
  // says why under the blocker, with Retry. The receipt says who was told once the write lands.
  const assign = (id: string, owner: Owner) => {
    const before = owners[id], next = before === owner ? undefined : owner;
    haptic("select"); setAssignError(undefined); setOwners(o => ({ ...o, [id]: next })); setTold(id, undefined);
    if (!live) { setTold(id, ownerReceipt(next, new Date(), true)); return; }
    (next ? api.ward.assignOwner({ blockerId: id, owner: next }) : api.ward.unassignOwner({ blockerId: id })).then(
      () => setTold(id, ownerReceipt(next, new Date(), false)),
      e => { setOwners(o => ({ ...o, [id]: before })); setAssignError({ id, owner, text: `${next ? "Not assigned" : "Not cleared"}: ${errorText(e)}` }); });
  };
  // Live: owners on the server (they are blocker-owner tasks) show on open, so a reload keeps them and a clear elsewhere shows.
  useEffect(() => {
    if (!live) return;
    api.tasks.list().then(tasks => {
      const saved = tasks.filter(t => t.kind === "blocker-owner" && t.sourceId);
      setOwners(() => Object.fromEntries(saved.map(t => [t.sourceId!, t.owner as Owner])));
    }).catch(() => {});
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps

  const gridStyle = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 1], [1, 0.2]), transform: [{ scale: interpolate(p.value, [0, 1], [1, 0.97]) }] }));
  // Live mode: once opened, the brief is the server's over its own ward and owners; the local rule stays the fallback (and the collapsed preview).
  const [wardVersion, setWardVersion] = useState(0);
  useLiveChanges(["ward"], () => setWardVersion(v => v + 1));
  // Keyed on the beds and on the server's own ward announcements (an owner saved there), so it never briefs before a write lands.
  const server = useLiveHuddle(briefed && live && !loading, `${beds.map(b => `${b.bed}:${b.blockers.map(x => x.id).join(",")}`).join("|")}#${wardVersion}`);
  const local = huddle(beds, owners);
  const lines = server.data?.lines ?? local;
  const current = open && beds.find(b => b.bed === open.bed);
  const forecast = useForecast(beds, findings, owners);
  // "Frees fastest" opens the bed's card at the blocker; a row the filter hides shows under All first, then opens once mounted.
  const openAt = (id: string, blockerId?: string) => {
    const bed = beds.find(b => b.bed === id);
    if (!bed) return;
    if (tiles.current[id]) return openBed(bed, blockerId);
    setPicked("all");
    setTimeout(() => openBed(bed, blockerId), 80);
  };
  // Opened from Today's "Open Bed N" (`bed`: "Bed 6" or "6"): that bed's card opens on arrival, once;
  // remembered rather than cleared from the route, since navigating during the first render (a cold link) throws.
  const openedFor = useRef<string>(undefined);
  useEffect(() => {
    const bed = params.bed && openedFor.current !== params.bed && beds.find(b => b.bed === params.bed || b.bed === `Bed ${params.bed}`);
    if (!bed) return;
    openedFor.current = params.bed;
    setTimeout(() => openAt(bed.bed), 120); // after the rows have laid out, so the card grows from its row
  }, [params.bed, beds]); // eslint-disable-line react-hooks/exhaustive-deps

  return <WithSona scope="ward" hidden={Boolean(open)} answers={[soonest(beds)]} onTab={t => { const f = asFilter(t); if (f) setPicked(f); }}>
  <View ref={root} collapsable={false} style={{ flex: 1, backgroundColor: palette.canvas, experimental_backgroundImage: canvasImage }}>
    <Animated.View style={[{ flex: 1 }, gridStyle]} pointerEvents={open ? "none" : "auto"} accessibilityElementsHidden={Boolean(open)} importantForAccessibility={open ? "no-hide-descendants" : "auto"}>
      <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 44 + ASK_SPACE, gap: 18 }}>
        {/* Live mode says it is reading the ward rather than counting or listing beds it doesn't have yet. */}
        <Insight eyebrow={loading ? "Now" : `Now · ${beds.length} beds`}>{loading ? "Reading the ward…" : wardLine(beds)}</Insight>

        {!loading && <>
        {/* Huddle brief, the page's one feature card: one line and a small pill; the brief opens under it and the page below moves with it. */}
        <Surface feature layout={motion} style={{ padding: 16, gap: 4 }}>
          {/* The pill wraps below the title when large text leaves no room beside it. */}
          <View style={{ minHeight: 44, flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 8 }}>
            <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 200, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(36,91,204,0.1)" }}>
                <Icon name="waveform" size={12} color={palette.blue} />
              </View>
              <Text numberOfLines={2} style={{ ...type.subhead, flex: 1, color: palette.muted }}><Text style={{ fontWeight: "600", color: palette.ink }}>Huddle</Text> · {briefed ? "30 seconds for the team" : local[1]}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={briefed ? "Hide the huddle brief" : "Brief me for the huddle"} accessibilityState={{ expanded: briefed }} hitSlop={7} onPress={() => { haptic("select"); setBriefed(v => !v); }}
              style={{ minHeight: 30, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 15, justifyContent: "center", backgroundColor: briefed ? "rgba(20,28,40,0.06)" : palette.blue }}>
              <Text style={{ ...type.footnote, fontWeight: "600", color: briefed ? palette.ink : palette.white }}>{briefed ? "Hide" : "Brief me"}</Text>
            </Pressable>
          </View>
          {briefed && <Expand style={{ gap: 10, paddingLeft: 38, paddingTop: 4 }}>
            {server.loading && <Drafting label="Briefing the ward…" />}
            {!server.loading && lines.map((line, i) => <Animated.View key={i} entering={reducedMotion ? undefined : riseIn({ delay: i * 60, distance: 8, duration: 300 })} style={{ flexDirection: "row", gap: 10 }}>
              <Text style={{ ...type.footnote, fontWeight: "700", color: palette.blue, width: 14 }}>{i + 1}</Text>
              <MarkedText text={line} style={{ ...type.subhead, flex: 1, color: palette.ink }} />
            </Animated.View>)}
            <SampleLabel answer={server} rule what="briefing" />
            {server.error && <Text style={{ ...type.caption, color: palette.red }}>{server.error} · showing the ward's own count</Text>}
          </Expand>}
        </Surface>

        <Animated.View layout={motion}><BedBar beds={beds} filter={filter} onFilter={setPicked} /></Animated.View>

        {/* One glass list of the filtered beds; rows fade and slide in and out, the list re-lays on the layout spring. */}
        <Surface layout={motion} style={{ paddingHorizontal: 4, paddingVertical: 4 }}>
          {shown.length ? shown.map((bed, i) => { const row = bedRow(bed); return <Animated.View key={bed.bed} layout={motion}
            entering={reducedMotion ? undefined : riseIn({ delay: i * 30, distance: 8, duration: 260 })} exiting={reducedMotion ? undefined : FadeOutUp.duration(150)}
            style={{ borderTopWidth: i ? 1 : 0, borderColor: glass.hairline }}>
            <Pressable ref={v => { tiles.current[bed.bed] = v; }} collapsable={false} accessibilityRole="button" accessibilityState={{ disabled: !bed.name }}
              accessibilityLabel={`${bed.bed}, ${bed.name ?? "no patient"}, ${bedTone(bed).label}, ${row.when}${row.flag ? `, ${row.flag}` : ""}`} accessibilityHint={bed.name ? "Opens the bed" : undefined}
              onPress={() => bed.name && openBed(bed)}>{({ pressed }) => <PressScale pressed={pressed && !!bed.name} scale={0.98} style={{ opacity: open?.bed === bed.bed ? 0 : 1 }}>
              <RowFace bed={bed} />
            </PressScale>}</Pressable>
          </Animated.View>; })
          : <Animated.View key={`empty-${filter}`} entering={reducedMotion ? undefined : FadeIn.duration(200)} style={{ minHeight: 56, justifyContent: "center", paddingHorizontal: 12 }}>
            <Text style={{ ...type.subhead, color: palette.muted }}>{emptyLine(beds, filter)}</Text>
          </Animated.View>}
        </Surface>

        {/* When beds free up, after the list; opened from My Day's forecast line, the ward scrolls here once. */}
        <Animated.View layout={motion} onLayout={e => {
          if (params.at !== "forecast" || scrolledToForecast.current) return;
          scrolledToForecast.current = true;
          scroll.current?.scrollTo({ y: e.nativeEvent.layout.y - insets.top - 52, animated: !reducedMotion });
        }}>
          <ForecastTimeline beds={beds} forecast={forecast} onOpen={openAt} />
        </Animated.View>
        </>}

        {/* The week's proof sits below the beds and moves with the list as it re-lays. */}
        <Animated.View layout={motion} style={{ gap: 12 }}>
          <ThisWeek />
          <FollowUpList findings={findings} />
        </Animated.View>
      </ScrollView>
    </Animated.View>

    {open && current && <BedCard bed={current} focus={open.focus} from={open.from} to={{ x: 12, y: insets.top + 52, w: width - 24, h: height - insets.top - 52 - insets.bottom - 12 }} p={p} owners={owners} told={told} onAssign={can("ward.assignOwner") ? assign : undefined} assignError={assignError} onClose={close}
      // The card closes behind the discharge screen, so coming back shows the ward (and the bed it freed), not a stale card.
      // Only a patient the app holds a visit for (Amelia) has a discharge screen to open.
      onDischarge={patients.some(x => x.id === current.patientId) ? () => { selectPatient(current.patientId!); router.push("/discharge"); p.set(0); setOpen(undefined); } : undefined} />}
  </View>
  </WithSona>;
}

/** A bed's list row (and the face the open card starts from): status dot, "Bed 2 · Nurul", when it frees up and what holds it. */
function RowFace({ bed }: { bed: Bed }) {
  const row = bedRow(bed);
  return <View style={{ minHeight: 56, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 12, opacity: bed.name ? 1 : 0.7 }}>
    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: KIND[row.kind] }} />
    <View style={{ flex: 1, gap: 1 }}>
      <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{row.title}</Text>
      <Text numberOfLines={1} style={{ ...type.caption, color: palette.muted }}>{row.when}{row.flag && <>{row.when ? " · " : ""}<Text style={{ fontWeight: "700", color: row.kind === "blocked" ? palette.amber : TEAL }}>{row.flag}</Text></>}</Text>
    </View>
    {bed.name && <Icon name="chevron.right" size={12} color={palette.muted} />}
  </View>;
}

function BedCard({ bed, focus, from, to, p, owners, told, onAssign, assignError, onClose, onDischarge }: {
  // `focus`: the blocker it was opened for (the forecast's "Frees fastest"), tinted so the eye lands on it.
  bed: Bed; focus?: string; from: Rect; to: Rect; p: ReturnType<typeof useSharedValue<number>>; owners: Record<string, Owner | undefined>; told: Record<string, string | undefined>;
  // Without onAssign (a role the server refuses) the owners read only.
  onAssign?: (id: string, owner: Owner) => void; assignError?: { id: string; owner: Owner; text: string }; onClose: () => void; onDischarge?: () => void;
}) {
  const { reducedMotion } = useAccessibleEffects();
  const frame = useAnimatedStyle(() => {
    const t = p.value;
    return { left: from.x + (to.x - from.x) * t, top: from.y + (to.y - from.y) * t, width: from.w + (to.w - from.w) * t, height: from.h + (to.h - from.h) * t, borderRadius: 14 + 14 * t };
  });
  const face = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.3], [1, 0], "clamp") }));
  const detail = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.35, 1], [0, 1], "clamp"), transform: [{ translateY: interpolate(p.value, [0.35, 1], [12, 0], "clamp") }] }));
  const tone = bedTone(bed);
  const sbar: [string, string][] = bed.sbar ? [["Situation", bed.sbar.s], ["Background", bed.sbar.b], ["Assessment", bed.sbar.a], ["Plan", bed.sbar.r]] : [];

  // Modal for VoiceOver: the ward behind it is hidden while it is open.
  return <Animated.View accessibilityViewIsModal style={[{ position: "absolute", overflow: "hidden", borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", backgroundColor: "rgba(250,251,253,0.98)", boxShadow: "0 18px 48px rgba(40,70,140,0.16)" }, frame]}>
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, width: from.w }, face]}><RowFace bed={bed} /></Animated.View>
    <Animated.View style={[{ position: "absolute", left: 0, top: 0, width: to.w, height: to.h }, detail]}>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 18 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.overline, color: tone.ink }}>{bed.bed} · {tone.label}</Text>
            <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{bed.name}</Text>
            <Text style={{ ...type.caption, color: palette.muted }}>{bed.meta} · {bed.status === "fit" ? `out ${bed.predicted.toLowerCase()}` : bed.predicted}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={onClose} style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(20,28,40,0.06)" }}>
            <Icon name="xmark" size={13} color={palette.ink} />
          </Pressable>
        </View>

        <View style={{ gap: 8 }}>
          {sbar.map(([label, value]) => <View key={label} style={{ flexDirection: "row", gap: 12 }}>
            <Text style={{ ...type.overline, width: 104, paddingTop: 3, color: palette.muted }}>{label}</Text>
            <MarkedText text={value} style={{ ...type.subhead, flex: 1, color: palette.ink }} />
          </View>)}
        </View>

        <View style={{ gap: 4 }}>
          <Text style={{ ...type.overline, color: bed.blockers.length ? palette.amber : TEAL }}>{bed.blockers.length ? `${bed.blockers.length} holding the discharge` : "Nothing holding the discharge"}</Text>
          {bed.blockers.map(b => { const owner = owners[b.id]; return <View key={b.id} style={{ gap: 10, paddingVertical: 12, borderTopWidth: 1, borderColor: "rgba(20,28,40,0.06)", ...(b.id === focus ? { marginHorizontal: -10, paddingHorizontal: 10, borderRadius: radius.control, backgroundColor: "rgba(36,91,204,0.07)" } : {}) }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{b.label}</Text>
                <Text style={{ ...type.caption, color: palette.muted }}>{b.detail}</Text>
              </View>
              {owner && <Animated.View key={owner} entering={reducedMotion ? undefined : ZoomIn.springify().duration(320).dampingRatio(0.6)} style={{ height: 26, paddingHorizontal: 10, borderRadius: 13, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: palette.ink }}>
                <Icon name="person.fill" size={10} color={palette.white} />
                <Text style={{ ...type.caption, fontWeight: "700", color: palette.white }}>{owner}</Text>
              </Animated.View>}
            </View>
            {onAssign && <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 6, rowGap: 8 }}>
              {OWNERS.map(o => { const on = owner === o, suggested = !owner && SUGGESTED[b.kind] === o; return <Pressable key={o} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={on ? `${b.label}, owned by ${o}. Clear owner` : `Assign ${b.label} to ${o}`} onPress={() => onAssign(b.id, o)} hitSlop={{ top: 4, bottom: 4 }}
                style={{ minHeight: 36, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 18, justifyContent: "center", borderWidth: 1, borderColor: suggested ? "rgba(36,91,204,0.35)" : "transparent", backgroundColor: on ? palette.blue : "rgba(20,28,40,0.05)" }}>
                <Text style={{ ...type.footnote, fontWeight: "600", color: on ? palette.white : suggested ? palette.blue : palette.ink }}>{o}</Text>
              </Pressable>; })}
            </View>}
            {told[b.id] && assignError?.id !== b.id && <Animated.Text key={told[b.id]} entering={reducedMotion ? undefined : FadeIn.duration(180)} accessibilityLiveRegion="polite" style={{ ...type.caption, color: owner ? TEAL : palette.muted }}>{told[b.id]}</Animated.Text>}
            {onAssign && assignError?.id === b.id && <ErrorLine text={assignError.text} onRetry={() => onAssign(b.id, assignError.owner)} />}
          </View>; })}
        </View>

        {onDischarge && <Action label="Open discharge" icon="bed.double" onPress={onDischarge} />}
      </ScrollView>
    </Animated.View>
  </Animated.View>;
}

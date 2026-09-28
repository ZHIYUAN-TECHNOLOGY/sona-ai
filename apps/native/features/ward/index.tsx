import { router, useLocalSearchParams } from "expo-router";
import { MarkedText } from "@/components/sona/marked-text";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeOutUp, ZoomIn, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Expand, Icon, Surface, glass, surfaceStyle, useAccessibleEffects } from "@/components/sona/ui";
import { haptic } from "@/features/clinical/medication-parts";
import { useEncounter } from "@/features/encounter/store";
import { ErrorLine } from "@/components/sona/parts";
import { api, errorText, useLive } from "@/features/live";
import { useRole } from "@/features/live/roles";
import { openItems, shortRM, totalRisk, useSent } from "@/features/audit/model";
import { FollowUpList } from "@/features/findings";
import { useFindings } from "@/features/live/findings-sync";
import { useServerEncounter } from "@/features/live/sync";
import { useServerBeds } from "@/features/live/ward-sync";
import { Drafting, SampleLabel } from "@/components/sona/model-answer";
import { useLiveHuddle } from "@/features/live/model-sync";
import { useLiveChanges } from "@/features/live/channel";
import { useTrainingStatus } from "@/features/training";
import { trainingLine } from "@/features/training/model";
import { BedBar, KIND, ThisWeek } from "./ops";
import { DEMO_PATIENT, OWNERS, SUGGESTED, asFilter, bedRow, defaultFilter, emptyLine, filterBeds, huddle, wardBeds, type Bed, type Owner, type WardFilter } from "./model";

/*
 * Ward command view: the bed bar, its legend as the filter (Blocked first when anything is), and one
 * glass list of the filtered beds; rows spring in and out in place on a filter change (after 60fps
 * "Revolut Number of Transactions Interaction", https://60fps.design/shots/revolut-number-of-transactions-interaction).
 * Tapping a row grows it into the bed's card (after Trackables' card-to-screen morph; spring 0.48 s at
 * damping 0.82) while the list fades back, the row's face crossfades out and the detail fades in
 * 120 ms later. Closing shrinks it back into the row (0.46 s at 0.84). Each blocker takes an owner in
 * one tap; the owner's badge pops onto the row. The week, the huddle and the tools sit below.
 */
const TEAL = "#0F6E66";
const OPEN = { duration: 480, dampingRatio: 0.82 }, CLOSE = { duration: 460, dampingRatio: 0.84 };
type Rect = { x: number; y: number; w: number; h: number };
const TONE: Record<Bed["status"], { label: string; ink: string }> = {
  fit: { label: "Fit to go", ink: TEAL },
  watch: { label: "Watch", ink: palette.amber },
  stable: { label: "Stable", ink: palette.muted },
  empty: { label: "Empty", ink: palette.muted },
  free: { label: "Freed", ink: TEAL },
};

export function WardScreen() {
  const { patients, encounters, selectPatient } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Live mode: every bed comes from the server (the fixture ward shows until it arrives). Amelia's
  // encounter is pulled too, so the discharge screen opened from bed 6 starts from the server's record.
  useServerEncounter(patients.find(p => p.id === DEMO_PATIENT));
  const { findings } = useFindings();
  const serverBeds = useServerBeds(findings);
  const beds = serverBeds ?? wardBeds(patients, encounters);
  const [owners, setOwners] = useState<Record<string, Owner | undefined>>({});
  const [briefed, setBriefed] = useState(false);
  const [open, setOpen] = useState<{ bed: string; from: Rect }>();
  const root = useRef<View>(null);
  const tiles = useRef<Record<string, View | null>>({});
  const p = useSharedValue(0);
  // Opened from My Day's legend the ward starts on that status; otherwise on Blocked when anything is.
  const params = useLocalSearchParams<{ filter?: string }>();
  const [picked, setPicked] = useState<WardFilter>();
  const filter = picked ?? asFilter(params.filter) ?? defaultFilter(beds);
  const shown = filterBeds(beds, filter);
  const motion = reducedMotion ? undefined : LAYOUT;
  // The page draws under the translucent header, so the open card starts below it.

  const openBed = (bed: Bed) => {
    const tile = tiles.current[bed.bed];
    if (!tile || !root.current) return;
    haptic("select");
    root.current.measureInWindow((rx, ry) => tile.measureInWindow((x, y, w, h) => {
      setOpen({ bed: bed.bed, from: { x: x - rx, y: y - ry, w, h } });
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
  const training = useTrainingStatus();
  const [assignError, setAssignError] = useState<{ id: string; owner: Owner; text: string }>();
  // Live: server beds carry the server's blocker IDs, so each owner is a real task on the server.
  // A refusal puts the previous owner back and says why under the blocker, with Retry.
  const assign = (id: string, owner: Owner) => {
    const before = owners[id];
    haptic("select"); setAssignError(undefined); setOwners(o => ({ ...o, [id]: before === owner ? undefined : owner }));
    if (serverBeds) void api.ward.assignOwner({ blockerId: id, owner }).catch(e => { setOwners(o => ({ ...o, [id]: before })); setAssignError({ id, owner, text: `Not assigned: ${errorText(e)}` }); });
  };
  // Live: owners already on the server (they are blocker-owner tasks) show on open, so a reload keeps them.
  useEffect(() => {
    if (!live) return;
    api.tasks.list().then(tasks => {
      const saved = tasks.filter(t => t.kind === "blocker-owner" && t.sourceId);
      setOwners(o => ({ ...o, ...Object.fromEntries(saved.map(t => [t.sourceId!, t.owner as Owner])) }));
    }).catch(() => {});
  }, [live]);

  const gridStyle = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 1], [1, 0.2]), transform: [{ scale: interpolate(p.value, [0, 1], [1, 0.97]) }] }));
  // Live mode: once opened, the brief is the server's over its own ward and owners; the local rule stays the fallback (and the collapsed preview).
  const [wardVersion, setWardVersion] = useState(0);
  useLiveChanges(["ward"], () => setWardVersion(v => v + 1));
  // Keyed on the beds and on the server's own ward announcements (an owner saved there), so it never briefs before a write lands.
  const server = useLiveHuddle(briefed && Boolean(serverBeds), `${beds.map(b => `${b.bed}:${b.blockers.map(x => x.id).join(",")}`).join("|")}#${wardVersion}`);
  const local = huddle(beds, owners);
  const lines = server.data?.lines ?? local;
  const audit = openItems(encounters, useSent());
  const current = open && beds.find(b => b.bed === open.bed);

  return <View ref={root} collapsable={false} style={{ flex: 1, backgroundColor: palette.canvas }}>
    <Animated.View style={[{ flex: 1 }, gridStyle]} pointerEvents={open ? "none" : "auto"}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 16 }}>
        <BedBar beds={beds} filter={filter} onFilter={setPicked} />

        {/* One glass list of the filtered beds; rows fade and slide in and out, the list re-lays on the layout spring. */}
        <Surface layout={motion} style={{ paddingHorizontal: 4, paddingVertical: 4 }}>
          {shown.length ? shown.map((bed, i) => { const row = bedRow(bed); return <Animated.View key={bed.bed} layout={motion}
            entering={reducedMotion ? undefined : riseIn({ delay: i * 30, distance: 8, duration: 260 })} exiting={reducedMotion ? undefined : FadeOutUp.duration(150)}
            style={{ borderTopWidth: i ? 1 : 0, borderColor: glass.hairline }}>
            <Pressable ref={v => { tiles.current[bed.bed] = v; }} collapsable={false} accessibilityRole="button" accessibilityState={{ disabled: !bed.name }}
              accessibilityLabel={`${bed.bed}, ${bed.name ?? "no patient"}, ${TONE[bed.status].label}, ${row.when}${row.flag ? `, ${row.flag}` : ""}`} accessibilityHint={bed.name ? "Opens the bed" : undefined}
              onPress={() => bed.name && openBed(bed)}
              style={({ pressed }) => ({ opacity: open?.bed === bed.bed ? 0 : 1, transform: [{ scale: pressed && bed.name && !reducedMotion ? 0.98 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
              <RowFace bed={bed} />
            </Pressable>
          </Animated.View>; })
          : <Animated.View key={`empty-${filter}`} entering={reducedMotion ? undefined : FadeIn.duration(200)} style={{ minHeight: 56, justifyContent: "center", paddingHorizontal: 12 }}>
            <Text style={{ ...type.subhead, color: palette.muted }}>{emptyLine(beds, filter)}</Text>
          </Animated.View>}
        </Surface>

        {/* The week's proof and the tools sit below the beds and move with the list as it re-lays. */}
        <Animated.View layout={motion} style={{ gap: 12 }}>
          <ThisWeek />

          {/* Huddle brief: one line and a small pill; the brief opens under it. */}
          <View>
            <View style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(36,91,204,0.1)" }}>
                <Icon name="waveform" size={12} color={palette.blue} />
              </View>
              <Text numberOfLines={1} style={{ ...type.subhead, flex: 1, color: palette.muted }}><Text style={{ fontWeight: "600", color: palette.ink }}>Huddle</Text> · {briefed ? "30 seconds for the team" : local[1]}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={briefed ? "Hide the huddle brief" : "Brief me for the huddle"} accessibilityState={{ expanded: briefed }} hitSlop={7} onPress={() => { haptic("select"); setBriefed(v => !v); }}
                style={{ height: 30, paddingHorizontal: 12, borderRadius: 15, justifyContent: "center", backgroundColor: briefed ? "rgba(20,28,40,0.06)" : palette.blue }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: briefed ? palette.ink : palette.white }}>{briefed ? "Hide" : "Brief me"}</Text>
              </Pressable>
            </View>
            {briefed && <Expand style={{ gap: 10, paddingLeft: 38, paddingTop: 4 }}>
              {server.loading && <Drafting label="Briefing the ward…" />}
              {!server.loading && lines.map((line, i) => <Animated.View key={i} entering={reducedMotion ? undefined : riseIn({ delay: i * 60, distance: 8, duration: 300 })} style={{ flexDirection: "row", gap: 10 }}>
                <Text style={{ ...type.footnote, fontWeight: "700", color: palette.blue, width: 14 }}>{i + 1}</Text>
                <MarkedText text={line} style={{ ...type.subhead, flex: 1, color: palette.ink }} />
              </Animated.View>)}
              <SampleLabel source={server.data?.source} />
              {server.error && <Text style={{ ...type.caption, color: palette.red }}>{server.error} · showing the ward's own count</Text>}
            </Expand>}
          </View>

          {/* Tools, side by side (one alone takes the width): coding audit for doctors and management, training data for management (live only). */}
          {(can("audit.list") || training.allowed) && <View style={{ flexDirection: "row", gap: 12 }}>
            {can("audit.list") && <ToolTile icon="doc.text.magnifyingglass" title="Coding audit" onPress={() => router.push("/audit")}
              tint={audit.length ? palette.amber : TEAL} fill={audit.length ? "rgba(196,120,20,0.12)" : "rgba(15,110,102,0.1)"}
              line={audit.length ? `${audit.length} notes · ${shortRM(totalRisk(audit))} at risk` : "All queries sent"} lineColor={audit.length ? palette.amber : TEAL}
              label={`Coding audit, ${audit.length} notes, ${shortRM(totalRisk(audit))} at risk`} />}
            {training.allowed && <ToolTile icon="shield.lefthalf.filled" title="Training data" onPress={() => router.push("/training")}
              tint={training.status?.counts.blocked ? palette.red : palette.blue} fill={training.status?.counts.blocked ? "rgba(162,62,62,0.1)" : "rgba(36,91,204,0.1)"}
              line={training.status ? trainingLine(training.status.counts) : "De-identified samples to review"} lineColor={palette.muted}
              label={`Training data${training.status ? `, ${trainingLine(training.status.counts)}` : ""}`} />}
          </View>}
          <FollowUpList findings={findings} />
        </Animated.View>
      </ScrollView>
    </Animated.View>

    {open && current && <BedCard bed={current} from={open.from} to={{ x: 12, y: insets.top + 52, w: width - 24, h: height - insets.top - 52 - insets.bottom - 12 }} p={p} owners={owners} onAssign={can("ward.assignOwner") ? assign : undefined} assignError={assignError} onClose={close}
      // The card closes behind the discharge screen, so coming back shows the ward (and the bed it freed), not a stale card.
      // Only a patient the app holds a visit for (Amelia) has a discharge screen to open.
      onDischarge={patients.some(x => x.id === current.patientId) ? () => { selectPatient(current.patientId!); router.push("/discharge"); p.set(0); setOpen(undefined); } : undefined} />}
  </View>;
}

/** A bed's list row (and the face the open card starts from): status dot, "Bed 2 · Nurul", when it frees up and what holds it. */
function RowFace({ bed }: { bed: Bed }) {
  const row = bedRow(bed);
  return <View style={{ minHeight: 56, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 12, opacity: bed.name ? 1 : 0.7 }}>
    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: KIND[row.kind] }} />
    <View style={{ flex: 1, gap: 1 }}>
      <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{row.title}</Text>
      <Text numberOfLines={1} style={{ ...type.caption, color: palette.muted }}>{row.when}{row.flag && <>{row.when ? " · " : ""}<Text style={{ fontWeight: "700", color: row.kind === "blocked" ? palette.red : TEAL }}>{row.flag}</Text></>}</Text>
    </View>
    {bed.name && <Icon name="chevron.right" size={12} color={palette.muted} />}
  </View>;
}

/** A half-width tool on the ward (full width when alone): icon, title, one line. */
function ToolTile({ icon, tint, fill, title, line, lineColor, label, onPress }: { icon: string; tint: string; fill: string; title: string; line: string; lineColor: string; label: string; onPress: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={({ pressed }) => ({ ...surfaceStyle, flex: 1, padding: 14, gap: 10, transform: [{ scale: pressed && !reducedMotion ? 0.98 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: fill }}><Icon name={icon} size={14} color={tint} /></View>
      <Icon name="chevron.right" size={11} color={palette.muted} />
    </View>
    <View style={{ gap: 1 }}>
      <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{title}</Text>
      <Text numberOfLines={2} style={{ ...type.caption, color: lineColor }}>{line}</Text>
    </View>
  </Pressable>;
}

function BedCard({ bed, from, to, p, owners, onAssign, assignError, onClose, onDischarge }: {
  bed: Bed; from: Rect; to: Rect; p: ReturnType<typeof useSharedValue<number>>; owners: Record<string, Owner | undefined>;
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
  const tone = TONE[bed.status];
  const sbar: [string, string][] = bed.sbar ? [["Situation", bed.sbar.s], ["Background", bed.sbar.b], ["Assessment", bed.sbar.a], ["Plan", bed.sbar.r]] : [];

  return <Animated.View style={[{ position: "absolute", overflow: "hidden", borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", backgroundColor: "rgba(250,251,253,0.98)", boxShadow: "0 18px 48px rgba(40,70,140,0.16)" }, frame]}>
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
          <Text style={{ ...type.overline, color: bed.blockers.length ? palette.red : TEAL }}>{bed.blockers.length ? `${bed.blockers.length} holding the discharge` : "Nothing holding the discharge"}</Text>
          {bed.blockers.map(b => { const owner = owners[b.id]; return <View key={b.id} style={{ gap: 10, paddingVertical: 12, borderTopWidth: 1, borderColor: "rgba(20,28,40,0.06)" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{b.label}</Text>
                <Text style={{ ...type.caption, color: palette.muted }}>{b.detail}</Text>
              </View>
              {owner && <Animated.View key={owner} entering={reducedMotion ? undefined : ZoomIn.springify().duration(320).dampingRatio(0.6)} style={{ height: 26, paddingHorizontal: 10, borderRadius: 13, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: palette.ink }}>
                <Icon name="person.fill" size={10} color={palette.white} />
                <Text style={{ fontSize: 12, fontWeight: "700", color: palette.white }}>{owner}</Text>
              </Animated.View>}
            </View>
            {onAssign && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {OWNERS.map(o => { const on = owner === o, suggested = !owner && SUGGESTED[b.kind] === o; return <Pressable key={o} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Assign ${b.label} to ${o}`} onPress={() => onAssign(b.id, o)} hitSlop={4}
                style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: "center", borderWidth: 1, borderColor: suggested ? "rgba(36,91,204,0.35)" : "transparent", backgroundColor: on ? palette.blue : "rgba(20,28,40,0.05)" }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: on ? palette.white : suggested ? palette.blue : palette.ink }}>{o}</Text>
              </Pressable>; })}
            </View>}
            {onAssign && assignError?.id === b.id && <ErrorLine text={assignError.text} onRetry={() => onAssign(b.id, assignError.owner)} />}
          </View>; })}
        </View>

        {onDischarge && <Pressable accessibilityRole="button" onPress={onDischarge}
          style={({ pressed }) => ({ height: 52, borderRadius: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: palette.ink, transform: [{ scale: pressed && !reducedMotion ? 0.97 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
          <Icon name="bed.double" size={15} color={palette.white} />
          <Text style={{ fontSize: 16, fontWeight: "600", color: palette.white }}>Open discharge</Text>
        </Pressable>}
      </ScrollView>
    </Animated.View>
  </Animated.View>;
}

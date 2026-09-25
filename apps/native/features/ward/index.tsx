import { router } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import Animated, { ZoomIn, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Icon, Surface, surfaceStyle, useAccessibleEffects } from "@/components/sona/ui";
import { haptic } from "@/features/clinical/medication-parts";
import { useEncounter } from "@/features/encounter/store";
import { openItems, shortRM, totalRisk, useSent } from "@/features/audit/model";
import { OWNERS, SUGGESTED, huddle, wardBeds, wardSummary, type Bed, type Owner } from "./model";

/*
 * Ward command view (after Trackables' card-to-screen morph): a grid of bed tiles; tapping one
 * grows it from its own slot into the bed's card (spring 0.48 s at damping 0.82) while the grid
 * fades back, the tile's face crossfades out and the detail fades in 120 ms later. Closing
 * shrinks it back into the slot (0.46 s at 0.84). Each blocker takes an owner in one tap; the
 * owner's badge pops onto the row.
 */
const TEAL = "#0F6E66";
const OPEN = { duration: 480, dampingRatio: 0.82 }, CLOSE = { duration: 460, dampingRatio: 0.84 };
type Rect = { x: number; y: number; w: number; h: number };
const TONE: Record<Bed["status"], { label: string; ink: string; fill: string }> = {
  fit: { label: "Fit to go", ink: TEAL, fill: "rgba(15,110,102,0.1)" },
  watch: { label: "Watch", ink: palette.amber, fill: "rgba(196,120,20,0.12)" },
  stable: { label: "Stable", ink: palette.muted, fill: "rgba(20,28,40,0.06)" },
  empty: { label: "Empty", ink: palette.muted, fill: "rgba(20,28,40,0.06)" },
  free: { label: "Freed", ink: TEAL, fill: "rgba(15,110,102,0.1)" },
};

export function WardScreen() {
  const { patients, encounters, selectPatient } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const beds = wardBeds(patients, encounters);
  const summary = wardSummary(beds);
  const [owners, setOwners] = useState<Record<string, Owner | undefined>>({});
  const [briefed, setBriefed] = useState(false);
  const [open, setOpen] = useState<{ bed: string; from: Rect }>();
  const root = useRef<View>(null);
  const tiles = useRef<Record<string, View | null>>({});
  const p = useSharedValue(0);
  const tileW = (width - 40 - 12) / 2;
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
  const assign = (id: string, owner: Owner) => { haptic("select"); setOwners(o => ({ ...o, [id]: o[id] === owner ? undefined : owner })); };

  const gridStyle = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 1], [1, 0.2]), transform: [{ scale: interpolate(p.value, [0, 1], [1, 0.97]) }] }));
  const lines = huddle(beds, owners);
  const audit = openItems(encounters, useSent());
  const current = open && beds.find(b => b.bed === open.bed);

  return <View ref={root} collapsable={false} style={{ flex: 1, backgroundColor: palette.canvas }}>
    <Animated.View style={[{ flex: 1 }, gridStyle]} pointerEvents={open ? "none" : "auto"}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 16 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {([[`${summary.beds}`, "beds"], [`${summary.fit}`, "fit to go"], [`${summary.blocked}`, "blocked"], [`~${summary.bedHours}`, "bed-hours"]] as const).map(([n, label], i) =>
            <View key={label} style={{ flex: 1, paddingVertical: 10, borderRadius: 16, borderCurve: "continuous", alignItems: "center", backgroundColor: i === 2 && summary.blocked ? "rgba(196,120,20,0.1)" : "rgba(20,28,40,0.04)" }}>
              <Text style={{ fontSize: 20, fontWeight: "700", color: i === 2 && summary.blocked ? palette.amber : palette.ink, fontVariant: ["tabular-nums"] }}>{n}</Text>
              <Text style={{ ...type.caption, color: palette.muted }}>{label}</Text>
            </View>)}
        </View>

        <Surface feature style={{ padding: 14, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.overline, color: palette.blue }}>Huddle brief</Text>
              <Text style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{briefed ? "30 seconds for the team" : lines[1]}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: briefed }} onPress={() => { haptic("select"); setBriefed(v => !v); }}
              style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: briefed ? "rgba(20,28,40,0.06)" : palette.blue }}>
              <Icon name={briefed ? "chevron.up" : "waveform"} size={12} color={briefed ? palette.ink : palette.white} />
              <Text style={{ fontSize: 14, fontWeight: "600", color: briefed ? palette.ink : palette.white }}>{briefed ? "Hide" : "Brief me"}</Text>
            </Pressable>
          </View>
          {briefed && lines.map((line, i) => <Animated.View key={i} entering={reducedMotion ? undefined : riseIn({ delay: i * 60, distance: 8, duration: 300 })} style={{ flexDirection: "row", gap: 10 }}>
            <Text style={{ ...type.footnote, fontWeight: "700", color: palette.blue, width: 14 }}>{i + 1}</Text>
            <Text selectable style={{ ...type.subhead, flex: 1, color: palette.ink }}>{line}</Text>
          </Animated.View>)}
        </Surface>

        {/* Coding audit: the notes whose vague wording puts money at risk, one tap from the ward. */}
        <Pressable accessibilityRole="button" accessibilityLabel={`Coding audit, ${audit.length} notes, ${shortRM(totalRisk(audit))} at risk`} onPress={() => router.push("/audit")}
          style={({ pressed }) => ({ ...surfaceStyle, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, transform: [{ scale: pressed && !reducedMotion ? 0.98 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
          <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: audit.length ? "rgba(196,120,20,0.12)" : "rgba(15,110,102,0.1)" }}>
            <Icon name="doc.text.magnifyingglass" size={15} color={audit.length ? palette.amber : TEAL} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>Coding audit</Text>
            <Text style={{ ...type.caption, color: audit.length ? palette.amber : TEAL }}>{audit.length ? `${audit.length} notes · ${shortRM(totalRisk(audit))} at risk` : "All queries sent"}</Text>
          </View>
          <Icon name="chevron.right" size={12} color={palette.muted} />
        </Pressable>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {beds.map(bed => <Pressable key={bed.bed} ref={v => { tiles.current[bed.bed] = v; }} collapsable={false} accessibilityRole="button"
            accessibilityLabel={`${bed.bed}, ${bed.name ?? "no patient"}, ${TONE[bed.status].label}, ${bed.blockers.length} blockers`} onPress={() => bed.name && openBed(bed)}
            style={({ pressed }) => ({ width: tileW, opacity: open?.bed === bed.bed ? 0 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.97 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
            <TileFace bed={bed} />
          </Pressable>)}
        </View>
      </ScrollView>
    </Animated.View>

    {open && current && <BedCard bed={current} from={open.from} to={{ x: 12, y: insets.top + 52, w: width - 24, h: height - insets.top - 52 - insets.bottom - 12 }} p={p} owners={owners} onAssign={assign} onClose={close}
      onDischarge={() => { if (!current.patientId) return; selectPatient(current.patientId); router.push("/discharge"); }} />}
  </View>;
}

function TileFace({ bed }: { bed: Bed }) {
  const tone = TONE[bed.status];
  return <View style={{ ...surfaceStyle, padding: 14, gap: 10, minHeight: 132, opacity: bed.name ? 1 : 0.7 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ ...type.overline, color: palette.muted }}>{bed.bed}</Text>
      <View style={{ paddingHorizontal: 8, height: 20, borderRadius: 10, justifyContent: "center", backgroundColor: tone.fill }}>
        <Text style={{ fontSize: 11, fontWeight: "700", color: tone.ink }}>{tone.label}</Text>
      </View>
    </View>
    {bed.name ? <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(36,91,204,0.1)" }}>
        <Text style={{ fontSize: 11, fontWeight: "700", color: palette.blue }}>{bed.initials}</Text>
      </View>
      <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "600", flex: 1, color: palette.ink }}>{bed.name.split(" ")[0]}</Text>
    </View> : <Text style={{ ...type.subhead, color: palette.muted }}>No patient</Text>}
    <View style={{ gap: 2 }}>
      <Text numberOfLines={1} style={{ ...type.caption, color: palette.muted }}>{bed.status === "fit" ? `Out ${bed.predicted.toLowerCase()}` : bed.predicted}</Text>
      {bed.status === "fit" && <Text style={{ ...type.caption, fontWeight: "700", color: bed.blockers.length ? palette.amber : TEAL }}>{bed.blockers.length ? `${bed.blockers.length} ${bed.blockers.length === 1 ? "blocker" : "blockers"}` : "Ready"}</Text>}
    </View>
  </View>;
}

function BedCard({ bed, from, to, p, owners, onAssign, onClose, onDischarge }: {
  bed: Bed; from: Rect; to: Rect; p: ReturnType<typeof useSharedValue<number>>; owners: Record<string, Owner | undefined>;
  onAssign: (id: string, owner: Owner) => void; onClose: () => void; onDischarge: () => void;
}) {
  const { reducedMotion } = useAccessibleEffects();
  const frame = useAnimatedStyle(() => {
    const t = p.value;
    return { left: from.x + (to.x - from.x) * t, top: from.y + (to.y - from.y) * t, width: from.w + (to.w - from.w) * t, height: from.h + (to.h - from.h) * t, borderRadius: 24 + 4 * t };
  });
  const face = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.3], [1, 0], "clamp") }));
  const detail = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.35, 1], [0, 1], "clamp"), transform: [{ translateY: interpolate(p.value, [0.35, 1], [12, 0], "clamp") }] }));
  const tone = TONE[bed.status];
  const sbar: [string, string][] = bed.sbar ? [["Situation", bed.sbar.s], ["Background", bed.sbar.b], ["Assessment", bed.sbar.a], ["Plan", bed.sbar.r]] : [];

  return <Animated.View style={[{ position: "absolute", overflow: "hidden", borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", backgroundColor: "rgba(250,251,253,0.98)", boxShadow: "0 18px 48px rgba(40,70,140,0.16)" }, frame]}>
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, width: from.w }, face]}><TileFace bed={bed} /></Animated.View>
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
            <Text selectable style={{ ...type.subhead, flex: 1, color: palette.ink }}>{value}</Text>
          </View>)}
        </View>

        <View style={{ gap: 4 }}>
          <Text style={{ ...type.overline, color: bed.blockers.length ? palette.amber : TEAL }}>{bed.blockers.length ? `${bed.blockers.length} holding the discharge` : "Nothing holding the discharge"}</Text>
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
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {OWNERS.map(o => { const on = owner === o, suggested = !owner && SUGGESTED[b.kind] === o; return <Pressable key={o} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Assign ${b.label} to ${o}`} onPress={() => onAssign(b.id, o)} hitSlop={4}
                style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: "center", borderWidth: 1, borderColor: suggested ? "rgba(36,91,204,0.35)" : "transparent", backgroundColor: on ? palette.blue : "rgba(20,28,40,0.05)" }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: on ? palette.white : suggested ? palette.blue : palette.ink }}>{o}</Text>
              </Pressable>; })}
            </View>
          </View>; })}
        </View>

        {bed.patientId && <Pressable accessibilityRole="button" onPress={onDischarge}
          style={({ pressed }) => ({ height: 52, borderRadius: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: palette.ink, transform: [{ scale: pressed && !reducedMotion ? 0.97 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
          <Icon name="bed.double" size={15} color={palette.white} />
          <Text style={{ fontSize: 16, fontWeight: "600", color: palette.white }}>Open discharge</Text>
        </Pressable>}
      </ScrollView>
    </Animated.View>
  </Animated.View>;
}

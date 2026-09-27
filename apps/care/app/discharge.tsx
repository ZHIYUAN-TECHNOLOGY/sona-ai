import { router } from "expo-router";
import { useRef, useState, type Ref } from "react";
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, LinearTransition, useAnimatedRef, useReducedMotion, useScrollOffset } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorText } from "@/features/errors";
import { CHANGE, changeSummary, homeLine, scheduleLine, type Discharged, type Group, type Med } from "@/features/discharge/lines";
import { useDischarge } from "@/features/discharge/row";
import { Pill, tintOf } from "@/features/doses";
import { dayLabel } from "@/features/follow-ups/lines";
import { daysHome } from "@/features/home";
import { DOCK_SPACE } from "@/lib/dock";
import { palette, type } from "@/lib/theme";
import { Card, Row, Section, surfaceStyle, Title } from "@/lib/ui";

/** Sections rise in on a 40 ms ease-out stagger the first time; still under Reduce Motion. */
const rise = (reduced: boolean, i: number) => reduced ? undefined : FadeInDown.duration(360).easing(Easing.out(Easing.cubic)).delay(i * 40);
/** The layout spring (380 ms, no bounce) for a card opening in place and everything after it reflowing. */
const reflow = (reduced: boolean) => reduced ? undefined : LinearTransition.springify().duration(380).dampingRatio(1);

const TAGS = {
  new: { label: "New", bg: palette.blueWash, fg: palette.blue },
  changed: { label: "Changed", bg: "#FFF0DE", fg: palette.amber },
  continue: { label: "Same", bg: "#F1EFF5", fg: palette.muted },
  stopped: { label: "Stopped", bg: "#F1EFF5", fg: palette.muted },
} as const;

/**
 * My medicines: the plan from the discharge day. What changed comes first (a chip per change, each
 * opening that medicine), then a grid of the medicines to take, each opening in place to its full line
 * and how to take it; stopped ones as one quiet line. Then the leaflet in their language, the warning
 * signs, and what comes next.
 */
export default function DischargeScreen() {
  const { data, error, isLoading } = useDischarge();
  const reduced = useReducedMotion();
  const scroll = useAnimatedRef<Animated.ScrollView>();
  const offset = useScrollOffset(scroll);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  /** Scrolls just enough to bring a view clear of the header and the dock (scrollIntoView "nearest"). */
  const reveal = (node: View | null | undefined) => node?.measureInWindow((_x, y, _w, h) => {
    const top = insets.top + 56, bottom = height - DOCK_SPACE;
    const shift = y + h > bottom ? Math.min(y + h - bottom, y - top) : y < top ? y - top : 0;
    if (shift) scroll.current?.scrollTo({ y: offset.get() + shift, animated: !reduced });
  });
  return <Animated.ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: DOCK_SPACE, gap: 16 }}>
    <Animated.View entering={rise(reduced, 0)}>
      {data?.status === "discharged"
        ? <Title greeting="Your plan from" accent={dayLabel(data.dischargedAt).replace(" ", ", ")} line={homeLine(daysHome(data.dischargedAt))} />
        : <Title>My medicines</Title>}
    </Animated.View>
    {isLoading && <ActivityIndicator color={palette.muted} />}
    {error && <Text style={{ ...type.body, color: palette.red }}>{errorText(error)}</Text>}
    {data?.status === "in-hospital" && <Card feature>
      <Text style={{ ...type.headline, color: palette.ink }}>You're still in hospital</Text>
      <Text style={{ ...type.body, color: palette.muted }}>Your medicines, leaflet and warning signs show here once you go home.</Text>
    </Card>}
    {data?.status === "discharged" && <Plan plan={data} reveal={reveal} />}
  </Animated.ScrollView>;
}

function Plan({ plan, reveal }: { plan: Discharged; reveal: (node: View | null | undefined) => void }) {
  const reduced = useReducedMotion(), layout = reflow(reduced);
  const [picked, setPicked] = useState<string>();
  const [open, setOpen] = useState<string>();
  const [flash, setFlash] = useState(false);
  const cards = useRef(new Map<string, View>());
  const stoppedRef = useRef<View>(null);
  const leaflet = plan.leaflets.find(l => l.language === (picked ?? plan.language)) ?? plan.leaflets[0]!;
  const meds = (["new", "changed", "continue"] as const).flatMap(group => plan.medicines[group].map(m => ({ ...m, group })));
  const { stopped } = plan.medicines;

  const show = (name: string) => { setOpen(name); requestAnimationFrame(() => reveal(cards.current.get(name))); };
  const jump = ({ group, first }: ReturnType<typeof changeSummary>[number]) => {
    if (group !== "stopped") return show(first);
    reveal(stoppedRef.current);
    setFlash(true);
    setTimeout(() => setFlash(false), 1200);
  };

  return <>
    <Animated.View entering={rise(reduced, 1)} layout={layout} style={{ gap: 12 }}>
      <Section light="Your" bold="medicines" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {changeSummary(plan.medicines).map(s => <Pressable key={s.group} accessibilityRole="button" accessibilityLabel={`${s.label}: ${plan.medicines[s.group].map(m => m.name).join(", ")}`} onPress={() => jump(s)}
          style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: "center", backgroundColor: TAGS[s.group].bg, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
          <Text style={{ fontSize: 13, fontWeight: "800", color: TAGS[s.group].fg }}>{s.label}</Text>
        </Pressable>)}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 }}>
        {meds.map(m => <MedCard key={m.name} med={m} open={open === m.name} layout={layout} reduced={reduced}
          ref={node => { if (node) cards.current.set(m.name, node); }}
          onPress={() => open === m.name ? setOpen(undefined) : show(m.name)} />)}
      </View>
      {!meds.length && <Text style={{ ...type.body, color: palette.muted }}>Nothing to take at home.</Text>}
      {stopped.length > 0 && <Animated.View layout={layout}>
        <View ref={stoppedRef} accessible accessibilityLabel={`Stopped: ${stopped.map(m => `${m.name}. ${m.line}`).join(". ")}`}
          style={{ paddingHorizontal: 6, paddingVertical: 8, borderRadius: 12, backgroundColor: flash ? TAGS.stopped.bg : "transparent" }}>
          <Text style={{ ...type.footnote, color: palette.muted }}>
            <Text style={{ fontWeight: "700", color: palette.ink }}>Stopped: </Text>
            {stopped.map((m, i) => <Text key={m.name}>{i ? " · " : ""}<Text style={{ textDecorationLine: "line-through" }}>{m.name}</Text> · {m.line}</Text>)}
          </Text>
        </View>
      </Animated.View>}
    </Animated.View>

    <Animated.View entering={rise(reduced, 2)} layout={layout}>
      <Card>
        <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>Your leaflet</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {plan.leaflets.map(l => {
            const on = l.language === leaflet.language;
            return <Pressable key={l.language} accessibilityRole="button" accessibilityLabel={l.name} accessibilityState={{ selected: on }} onPress={() => setPicked(l.language)}
              style={({ pressed }) => ({ minHeight: 44, minWidth: 56, paddingHorizontal: 16, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: on ? palette.blueWash : "rgba(20,28,40,0.05)", opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ ...type.footnote, fontWeight: "600", color: on ? palette.blue : palette.ink }}>{l.label}</Text>
            </Pressable>;
          })}
        </View>
        <Text style={{ ...type.body, color: palette.ink }}>{leaflet.text}</Text>
      </Card>
    </Animated.View>

    <Animated.View entering={rise(reduced, 3)} layout={layout}>
      <Card>
        <Text accessibilityRole="header" style={{ ...type.headline, color: palette.red }}>Call 999 or go to the emergency department if</Text>
        {plan.warningSigns.map(sign => <Text key={sign} style={{ ...type.body, color: palette.ink }}>•  {sign}</Text>)}
      </Card>
    </Animated.View>

    <Animated.View entering={rise(reduced, 4)} layout={layout}>
      <Card style={{ paddingVertical: 6 }}>
        {plan.followUp && <Row first title={plan.followUp.title} line={dayLabel(plan.followUp.date)} onPress={() => router.push("/follow-ups")} />}
        <Row first={!plan.followUp} title="Check-ins" line={`We'll message you ${plan.checkIns.map(c => dayLabel(c.date)).join(" and ")}`} onPress={() => router.push("/check-ins")} />
      </Card>
    </Animated.View>
  </>;
}

/**
 * One medicine in the grid (after the Lumi medicines grid): the drawn pill on its tint, name, schedule
 * and what the stay did to it. Opens in place to full width with its full line and how to take it.
 */
function MedCard({ med, open, layout, reduced, onPress, ref }: { med: Med & { group: Exclude<Group, "stopped"> }; open: boolean; layout: ReturnType<typeof reflow>; reduced: boolean; onPress: () => void; ref: Ref<View> }) {
  const tag = TAGS[med.group], schedule = scheduleLine(med);
  const details = [med.line, med.take && `How to take: ${med.take}`, CHANGE[med.group]].filter(Boolean);
  return <Animated.View layout={layout} style={{ width: open ? "100%" : "48%" }}>
    <Pressable ref={ref} accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onPress}
      accessibilityLabel={[med.name, schedule, tag.label, ...(open ? details : [])].join(". ")} accessibilityHint={open ? undefined : "Shows how to take it"}
      style={({ pressed }) => [surfaceStyle, { minHeight: open ? 0 : 176, padding: 16, gap: 6, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 6, marginBottom: 4 }}>
        <View style={{ width: 64, height: 64, borderRadius: 22, borderCurve: "continuous", backgroundColor: tintOf(med.name), alignItems: "center", justifyContent: "center" }}>
          <Pill name={med.name} size={52} />
        </View>
        <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: tag.bg }}>
          <Text style={{ fontSize: 10.5, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", color: tag.fg }}>{tag.label}</Text>
        </View>
      </View>
      <Text style={{ fontSize: 15.5, lineHeight: 20, fontWeight: "700", letterSpacing: -0.3, color: palette.ink }}>{med.name}</Text>
      <Text style={{ ...type.footnote, color: palette.muted }}>{schedule}</Text>
      {open && <Animated.View entering={reduced ? undefined : FadeIn.duration(240).delay(120)} style={{ gap: 6, paddingTop: 10, marginTop: 4, borderTopWidth: 1, borderColor: "rgba(40,24,70,0.06)" }}>
        <Text style={{ ...type.body, color: palette.ink }}>{med.line}</Text>
        {med.take && <Text style={{ ...type.body, color: palette.ink }}><Text style={{ fontWeight: "600" }}>How to take: </Text>{med.take}</Text>}
        <Text style={{ ...type.footnote, fontWeight: "600", color: tag.fg }}>{CHANGE[med.group]}</Text>
      </Animated.View>}
    </Pressable>
  </Animated.View>;
}

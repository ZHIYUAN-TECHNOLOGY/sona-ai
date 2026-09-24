import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedProps, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { EASE_OUT } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Icon, Surface, useAccessibleEffects } from "@/components/sona/ui";

const AnimatedPath = Animated.createAnimatedComponent(Path);

type Tone = "normal" | "watch" | "caution";
const TONE: Record<Tone, { label: string; color: string; wash: string }> = {
  normal: { label: "Normal", color: "#0F6E66", wash: "rgba(20,140,130,0.12)" },
  watch: { label: "Raised", color: "#8B5518", wash: "rgba(196,120,20,0.14)" },
  caution: { label: "To confirm", color: "#8B5518", wash: "rgba(196,120,20,0.14)" },
};
type Vital = { label: string; value: string; unit: string; icon: string; tint: string; tone: Tone; trace: string };

// Illustrative traces (not recorded waveforms): an ECG beat, a slow wave, a steady saturation line.
const TRACES: Record<string, string> = {
  pulse: "M0 20 L14 20 L18 20 L21 6 L24 32 L27 14 L30 20 L46 20 L50 20 L53 6 L56 32 L59 14 L62 20 L78 20 L82 20 L85 6 L88 32 L91 14 L94 20 L110 20",
  temp: "M0 26 C12 26 16 18 28 18 S44 24 56 20 S74 8 86 10 S102 14 110 12",
  spo2: "M0 14 C18 13 30 15 46 14 S78 13 92 14 S104 14 110 14",
};

function parse(label: string, value: string): Vital | undefined {
  const [num, ...rest] = value.split(" ");
  if (label === "SpO₂") return { label: "Blood oxygen", value: value.replace("%", ""), unit: "%", icon: "lungs", tint: "rgba(36,91,204,0.10)", tone: "normal", trace: TRACES.spo2! };
  if (label === "Temp") return { label: "Temperature", value: num!, unit: rest.join(" "), icon: "thermometer.medium", tint: "rgba(196,120,20,0.12)", tone: parseFloat(num!) >= 37.8 ? "watch" : "normal", trace: TRACES.temp! };
  if (label === "Pulse") return { label: "Heart rate", value: num!, unit: rest.join(" "), icon: "heart", tint: "rgba(210,70,90,0.10)", tone: parseFloat(num!) > 100 ? "watch" : "normal", trace: TRACES.pulse! };
  return undefined;
}

/** A trace that draws itself in once (stroke offset), after Health-style vital cards. */
function Trace({ d, color, delay }: { d: string; color: string; delay: number }) {
  const { reducedMotion } = useAccessibleEffects();
  const progress = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => { if (!reducedMotion) progress.set(withDelay(delay, withTiming(1, { duration: 900, easing: EASE_OUT }))); }, [reducedMotion, delay, progress]);
  const animated = useAnimatedProps(() => ({ strokeDashoffset: 260 * (1 - progress.value) }));
  return <Svg width={110} height={36} viewBox="0 0 110 36" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <AnimatedPath d={d} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray={260} animatedProps={animated} />
  </Svg>;
}

function Status({ tone }: { tone: Tone }) {
  const t = TONE[tone];
  return <View style={{ paddingHorizontal: 8, height: 20, borderRadius: 10, justifyContent: "center", backgroundColor: t.wash }}>
    <Text style={{ ...type.caption, fontWeight: "600", color: t.color }}>{t.label}</Text>
  </View>;
}

/**
 * Vitals as quiet rows in one glass surface: tinted icon, label, a large value with its unit,
 * a status pill and an illustrative trace. The allergy closes the list as a caution row.
 * Provenance sits once under the card instead of on every tile.
 */
export function VitalsCard({ vitals, allergy, onSource }: { vitals: { label: string; value: string }[]; allergy: string | null; onSource: () => void }) {
  const rows = vitals.map(v => parse(v.label, v.value)).filter(Boolean) as Vital[];
  return <View style={{ gap: 10 }}>
    <Surface style={{ paddingVertical: 4 }}>
      {rows.map((v, i) => <View key={v.label} accessible accessibilityLabel={`${v.label}, ${v.value} ${v.unit}, ${TONE[v.tone].label}`}
        style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: i ? 1 : 0, borderColor: "rgba(20,28,40,0.06)" }}>
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: v.tint, alignItems: "center", justifyContent: "center" }}><Icon name={v.icon} size={18} color={palette.ink} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.footnote, fontWeight: "500", color: palette.muted }}>{v.label}</Text>
          <Text style={{ fontSize: 26, lineHeight: 30, fontWeight: "600", letterSpacing: -0.6, color: palette.ink, fontVariant: ["tabular-nums"] }}>{v.value}<Text style={{ ...type.footnote, fontWeight: "500", color: palette.muted }}>{" "}{v.unit}</Text></Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <Status tone={v.tone} />
          <Trace d={v.trace} color={v.tone === "normal" ? "#3F7FE0" : "#C47814"} delay={i * 120} />
        </View>
      </View>)}
      <View accessible accessibilityLabel={`Allergy, ${allergy ?? "not documented"}, to confirm`} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: rows.length ? 1 : 0, borderColor: "rgba(20,28,40,0.06)" }}>
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: TONE.caution.wash, alignItems: "center", justifyContent: "center" }}><Icon name="allergens" size={18} color={TONE.caution.color} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.footnote, fontWeight: "500", color: palette.muted }}>Allergy</Text>
          <Text style={{ ...type.headline, color: palette.ink }}>{allergy ? allergy.split(" — ")[0] : "Not documented"}</Text>
        </View>
        <Status tone="caution" />
      </View>
    </Surface>
    <Pressable accessibilityRole="link" accessibilityLabel="Recorded observations source, 22 September, 09:26" onPress={onSource} hitSlop={8} style={{ alignSelf: "flex-start" }}>
      <Text style={{ ...type.caption, color: palette.muted }}>Synthetic observations · 22 Sep, 09:26 · <Text style={{ color: palette.blue }}>Source ↗</Text></Text>
    </Pressable>
  </View>;
}

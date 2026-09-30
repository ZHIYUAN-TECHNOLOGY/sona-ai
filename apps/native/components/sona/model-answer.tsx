import { router } from "expo-router";
import { useEffect, type ReactNode } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { riseIn } from "./motion";
import { Text } from "./text";
import { palette, type } from "./theme";
import { HalftoneGlint } from "./halftone-shimmer";
import { Icon, pillStyle, useAccessibleEffects } from "./ui";

/*
 * A model answer arriving from the server (live mode). While it drafts, soft bars breathe in place
 * (after Monogram's pulse-sweep response reveal, 60fps.design/shots/monogram-pulse-sweep-chat-response-reveal-interaction:
 * the ambient pulse says work is happening without a spinner); opacity 0.35 ↔ 0.8 over 900 ms each
 * way, each bar 120 ms behind the one above. When the answer lands, the bars go and its lines rise
 * 8 pt and fade in 70 ms apart on the ease-out (the upward, lightly staggered reveal of Monogram's
 * answer and of Slack's pinch-to-summarize, 60fps.design/shots/slack-pinch-to-summarize-interaction).
 * No height is animated: the response container keeps its plain layout. Reduce Motion: the bars
 * hold still and the lines appear at once.
 */
const WIDTHS = ["94%", "80%", "62%"] as const;

function Bar({ index, width, still }: { index: number; width: `${number}%`; still: boolean }) {
  const glow = useSharedValue(0.55);
  useEffect(() => {
    if (still) return;
    const ease = { duration: 900, easing: Easing.inOut(Easing.quad) };
    glow.set(withDelay(index * 120, withRepeat(withSequence(withTiming(0.8, ease), withTiming(0.35, ease)), -1)));
  }, [glow, index, still]);
  const style = useAnimatedStyle(() => ({ opacity: glow.value }));
  return <Animated.View style={[{ width, height: 12, borderRadius: 6, backgroundColor: "rgba(36,91,204,0.12)" }, style]} />;
}

/** The placeholder while the server drafts: a few breathing bars and what it is doing, announced once. */
export function Drafting({ label, lines = 3, style }: { label: string; lines?: number; style?: StyleProp<ViewStyle> }) {
  const { reducedMotion } = useAccessibleEffects();
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={[{ gap: 10 }, style]}>
    {WIDTHS.slice(0, lines).map((w, i) => <Bar key={w} index={i} width={w} still={reducedMotion} />)}
    <Text style={{ ...type.caption, color: palette.muted }}>{label}</Text>
  </View>;
}

/** One line of an arrived answer, rising in after the lines before it (`animate` false: already on screen, e.g. the authored fixture). */
export function Arrive({ index = 0, animate = true, children, style }: { index?: number; animate?: boolean; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { reducedMotion } = useAccessibleEffects();
  return <Animated.View entering={reducedMotion || !animate ? undefined : riseIn({ delay: index * 70, distance: 8, duration: 320 })} style={style}>{children}</Animated.View>;
}

/*
 * Honesty: two truths, two treatments. The DATA is synthetic everywhere, so that is said once
 * (DataPill, in the sidebar header). An answer no model gave is labelled where it appears
 * (SampleLabel), driven by the server's `source`, so the label goes by itself once a model answers.
 * Both open the same short sheet (app/about-data).
 */
const openAbout = () => router.push("/about-data");

/** The one "Synthetic data" signal: a quiet glass pill with a halftone accent; tap for what is fictional. */
export function DataPill({ onPress = openAbout }: { onPress?: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Synthetic data" accessibilityHint="What is fictional in this demo" onPress={onPress} hitSlop={10}
    style={({ pressed }) => [pillStyle, { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", minHeight: 24, paddingHorizontal: 10, borderRadius: 12, overflow: "hidden", opacity: pressed ? 0.6 : 1 }]}>
    <HalftoneGlint width={34} height={24} origin={[0, 12]} reach={[32, 16]} pitch={3} strength={0.9} style={{ top: 0, left: 0 }} />
    <Text style={{ ...type.caption, fontWeight: "600", color: palette.muted }}>Synthetic data</Text>
  </Pressable>;
}

/**
 * What a live answer's label goes by: the server's `source` once it answered, nothing while it drafts,
 * and "fixture" otherwise (demo mode, or a failed call), since the screen then shows its authored or rule-based answer.
 */
export const answerSource = (answer: { loading: boolean; data?: { source?: string } }) => answer.loading ? undefined : answer.data?.source ?? "fixture";

/**
 * The one label for an answer no model gave: "Sample · <what> model not switched on" (authored) or
 * "Rule-based" (fixed rules; with `what`, the model that replaces them). Shown only while `source` is
 * "fixture"; nothing once a model answered. Tap (the info glyph) for the about sheet. Pass `answer`
 * (a live-answer hook's result) instead of `source`, so demo mode is labelled as live mode is.
 */
export function SampleLabel({ source: given, answer, what, rule = false }: { source?: string; answer?: Parameters<typeof answerSource>[0]; what?: string; rule?: boolean }) {
  const source = answer ? answerSource(answer) : given;
  if (source !== "fixture") return null;
  const text = `${rule ? "Rule-based" : "Sample"}${what ? ` · ${what} model not switched on` : ""}`;
  return <Pressable accessibilityRole="button" accessibilityLabel={text} accessibilityHint="Why this is not a model answer" onPress={openAbout} hitSlop={8}
    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.6 : 1 })}>
    <Text style={{ ...type.caption, color: palette.muted, flexShrink: 1 }}>{text}</Text>
    <Icon name="info.circle" size={12} color={palette.muted} />
  </Pressable>;
}

/** The sheet both open: what is fictional, and what "Sample" and "Rule-based" mean. */
export function AboutDataSheet() {
  return <View style={{ paddingTop: 36, paddingBottom: 34, paddingHorizontal: 24, gap: 12 }}>
    <Text accessibilityRole="header" style={{ ...type.heading, color: palette.ink }}>Synthetic data</Text>
    <Text selectable style={{ ...type.body, color: palette.ink }}>Every patient, doctor, hospital and insurer in this demo is fictional. No real person's data is used.</Text>
    <Text selectable style={{ ...type.body, color: palette.muted }}>Answers marked "Sample" come from authored examples until the AI models are switched on. "Rule-based" means fixed rules worked it out, not a model.</Text>
  </View>;
}
